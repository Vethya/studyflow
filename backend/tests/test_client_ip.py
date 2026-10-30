from dataclasses import dataclass, field

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr

from studyflow.api.client_ip import (
    FRONTEND_CLIENT_IP_HEADER,
    FRONTEND_PROXY_SECRET_HEADER,
    UNKNOWN_CLIENT_IP,
    resolve_client_ip,
    resolve_frontend_proxy_client_ip,
)
from studyflow.app import create_app
from studyflow.auth.login import InvalidCredentialsError, LoginCommand, LoginResult
from studyflow.auth.rate_limits import DatabaseRegistrationRateLimiter
from studyflow.auth.registration import DeferredTasks, RegistrationCommand
from studyflow.database import Base, Database
from studyflow.settings import Settings

RENDER_CHAIN = "198.51.100.7, 104.16.0.1, 10.0.0.1"
"""The real client, the Cloudflare edge, then Render's internal proxy, as observed on Render."""

VERCEL_EGRESS_CHAIN = "76.76.21.21, 104.16.0.1, 10.0.0.1"
"""A Vercel egress address, the Cloudflare edge, then Render's internal proxy."""

PROXY_SECRET = "s" * 40


@pytest.mark.parametrize(
    ("forwarded_for", "trusted_proxy_hops", "expected"),
    [
        ([], 0, "10.0.0.5"),
        (["203.0.113.99"], 0, "10.0.0.5"),
        (["203.0.113.99, 198.51.100.7"], 1, "198.51.100.7"),
        ([RENDER_CHAIN], 3, "198.51.100.7"),
        ([f"203.0.113.99, {RENDER_CHAIN}"], 3, "198.51.100.7"),
        ([f"203.0.113.99, 203.0.113.98, {RENDER_CHAIN}"], 3, "198.51.100.7"),
        (["203.0.113.99", RENDER_CHAIN], 3, "198.51.100.7"),
        (["104.16.0.1"], 2, "10.0.0.5"),
        ([], 2, "10.0.0.5"),
        (["not-an-ip, 104.16.0.1"], 2, "10.0.0.5"),
        (["198.51.100.7:4321, 104.16.0.1"], 2, "10.0.0.5"),
        (["2001:DB8::1, 104.16.0.1"], 2, "2001:db8::1"),
        (["::ffff:198.51.100.7, 104.16.0.1"], 2, "198.51.100.7"),
    ],
)
def test_resolve_client_ip_uses_only_entries_appended_by_trusted_proxies(
    forwarded_for: list[str],
    trusted_proxy_hops: int,
    expected: str,
) -> None:
    assert resolve_client_ip("10.0.0.5", forwarded_for, trusted_proxy_hops) == expected


def test_render_chain_needs_three_trusted_hops() -> None:
    """Two hops would key every caller on a rotating Cloudflare edge address."""
    forwarded_for = [f"203.0.113.99, {RENDER_CHAIN}"]

    assert resolve_client_ip("10.0.0.5", forwarded_for, 3) == "198.51.100.7"
    assert resolve_client_ip("10.0.0.5", forwarded_for, 2) == "104.16.0.1"


def test_resolve_client_ip_keeps_unknown_peers_distinguishable() -> None:
    assert resolve_client_ip(None, [], 0) == UNKNOWN_CLIENT_IP
    assert resolve_client_ip(None, ["104.16.0.1"], 2) == UNKNOWN_CLIENT_IP
    assert resolve_client_ip("testclient", [], 0) == "testclient"


@dataclass
class FailingLoginStub:
    async def login(self, command: LoginCommand) -> LoginResult:
        raise InvalidCredentialsError()


@dataclass
class RecordingLoginRateLimit:
    client_ips: list[str] = field(default_factory=list)

    async def check(self, client_ip: str, email: str) -> str:
        self.client_ips.append(client_ip)
        return "login_inflight:test"

    async def record_failure(self, client_ip: str, email: str, reservation_id: str) -> None:
        return None

    async def reset_failures(self, client_ip: str, email: str, reservation_id: str) -> None:
        return None

    async def release(self, client_ip: str, email: str, reservation_id: str) -> None:
        return None


@pytest.mark.anyio
async def test_spoofed_forwarded_for_does_not_change_the_login_rate_limit_key() -> None:
    rate_limit = RecordingLoginRateLimit()
    transport = ASGITransport(
        app=create_app(
            Settings(trusted_proxy_hops=3),
            login=FailingLoginStub(),
            login_rate_limiter=rate_limit,
        )
    )
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        for spoofed_ip in ("203.0.113.1", "203.0.113.2", "203.0.113.3"):
            response = await client.post(
                "/api/v1/auth/login",
                json={"email": "student@example.com", "password": "wrong password"},
                headers={"X-Forwarded-For": f"{spoofed_ip}, {RENDER_CHAIN}"},
            )
            assert response.status_code == 401

    assert rate_limit.client_ips == ["198.51.100.7"] * 3


@pytest.mark.anyio
async def test_forwarded_for_is_ignored_without_trusted_proxies() -> None:
    rate_limit = RecordingLoginRateLimit()
    transport = ASGITransport(
        app=create_app(Settings(), login=FailingLoginStub(), login_rate_limiter=rate_limit)
    )
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await client.post(
            "/api/v1/auth/login",
            json={"email": "student@example.com", "password": "wrong password"},
            headers={"X-Forwarded-For": "203.0.113.1"},
        )

    assert rate_limit.client_ips == ["127.0.0.1"]


@dataclass
class RegistrationStub:
    commands: list[RegistrationCommand] = field(default_factory=list)

    async def register(self, command: RegistrationCommand, deferred_tasks: DeferredTasks) -> None:
        self.commands.append(command)

    async def complete(self, signup_token: str, name: str, password: str, timezone: str) -> bool:
        return True


@pytest.mark.anyio
async def test_rotating_spoofed_forwarded_for_cannot_bypass_the_registration_ip_limit() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
        registration = RegistrationStub()
        transport = ASGITransport(
            app=create_app(
                Settings(trusted_proxy_hops=3),
                registration=registration,
                registration_rate_limiter=DatabaseRegistrationRateLimiter(database),
            )
        )
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            statuses = [
                (
                    await client.post(
                        "/api/v1/auth/register",
                        json={"email": f"student{attempt}@example.com"},
                        headers={"X-Forwarded-For": f"203.0.113.{attempt}, {RENDER_CHAIN}"},
                    )
                ).status_code
                for attempt in range(6)
            ]
    finally:
        await database.stop()

    assert statuses == [202] * 5 + [429]
    assert len(registration.commands) == 5


@pytest.mark.parametrize(
    ("forwarded_client_ip", "presented_secret", "expected_secret", "expected"),
    [
        (["198.51.100.7"], [PROXY_SECRET], PROXY_SECRET, "198.51.100.7"),
        ([" 2001:DB8::1 "], [PROXY_SECRET], PROXY_SECRET, "2001:db8::1"),
        (["::ffff:198.51.100.7"], [PROXY_SECRET], PROXY_SECRET, "198.51.100.7"),
        (["198.51.100.7"], [PROXY_SECRET], None, None),
        (["198.51.100.7"], [], PROXY_SECRET, None),
        (["198.51.100.7"], ["wrong" * 8], PROXY_SECRET, None),
        (["198.51.100.7"], [PROXY_SECRET[:-1]], PROXY_SECRET, None),
        (["198.51.100.7"], [PROXY_SECRET, PROXY_SECRET], PROXY_SECRET, None),
        ([], [PROXY_SECRET], PROXY_SECRET, None),
        (["198.51.100.7", "203.0.113.9"], [PROXY_SECRET], PROXY_SECRET, None),
        (["198.51.100.7, 203.0.113.9"], [PROXY_SECRET], PROXY_SECRET, None),
        (["not-an-ip"], [PROXY_SECRET], PROXY_SECRET, None),
    ],
)
def test_frontend_proxy_client_ip_requires_the_shared_secret(
    forwarded_client_ip: list[str],
    presented_secret: list[str],
    expected_secret: str | None,
    expected: str | None,
) -> None:
    secret = None if expected_secret is None else SecretStr(expected_secret)

    assert (
        resolve_frontend_proxy_client_ip(forwarded_client_ip, presented_secret, secret) == expected
    )


@pytest.mark.anyio
async def test_authenticated_frontend_proxy_requests_use_the_end_user_address() -> None:
    rate_limit = RecordingLoginRateLimit()
    transport = ASGITransport(
        app=create_app(
            Settings(trusted_proxy_hops=3, frontend_proxy_secret=SecretStr(PROXY_SECRET)),
            login=FailingLoginStub(),
            login_rate_limiter=rate_limit,
        )
    )
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        for end_user_ip in ("198.51.100.1", "198.51.100.2"):
            await client.post(
                "/api/v1/auth/login",
                json={"email": "student@example.com", "password": "wrong password"},
                headers={
                    "X-Forwarded-For": VERCEL_EGRESS_CHAIN,
                    FRONTEND_CLIENT_IP_HEADER: end_user_ip,
                    FRONTEND_PROXY_SECRET_HEADER: PROXY_SECRET,
                },
            )

    assert rate_limit.client_ips == ["198.51.100.1", "198.51.100.2"]


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("configured_secret", "presented_headers"),
    [
        (PROXY_SECRET, {FRONTEND_CLIENT_IP_HEADER: "203.0.113.1"}),
        (
            PROXY_SECRET,
            {FRONTEND_CLIENT_IP_HEADER: "203.0.113.1", FRONTEND_PROXY_SECRET_HEADER: "x" * 40},
        ),
        (
            None,
            {FRONTEND_CLIENT_IP_HEADER: "203.0.113.1", FRONTEND_PROXY_SECRET_HEADER: PROXY_SECRET},
        ),
    ],
)
async def test_unauthenticated_frontend_client_ip_headers_are_ignored(
    configured_secret: str | None,
    presented_headers: dict[str, str],
) -> None:
    rate_limit = RecordingLoginRateLimit()
    secret = None if configured_secret is None else SecretStr(configured_secret)
    transport = ASGITransport(
        app=create_app(
            Settings(trusted_proxy_hops=3, frontend_proxy_secret=secret),
            login=FailingLoginStub(),
            login_rate_limiter=rate_limit,
        )
    )
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await client.post(
            "/api/v1/auth/login",
            json={"email": "student@example.com", "password": "wrong password"},
            headers={"X-Forwarded-For": RENDER_CHAIN, **presented_headers},
        )

    assert rate_limit.client_ips == ["198.51.100.7"]


@pytest.mark.anyio
async def test_users_behind_one_frontend_egress_address_do_not_share_registration_limits() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
        registration = RegistrationStub()
        transport = ASGITransport(
            app=create_app(
                Settings(trusted_proxy_hops=3, frontend_proxy_secret=SecretStr(PROXY_SECRET)),
                registration=registration,
                registration_rate_limiter=DatabaseRegistrationRateLimiter(database),
            )
        )

        async def register(client: AsyncClient, attempt: int, end_user_ip: str) -> int:
            response = await client.post(
                "/api/v1/auth/register",
                json={"email": f"student{attempt}@example.com"},
                headers={
                    "X-Forwarded-For": VERCEL_EGRESS_CHAIN,
                    FRONTEND_CLIENT_IP_HEADER: end_user_ip,
                    FRONTEND_PROXY_SECRET_HEADER: PROXY_SECRET,
                },
            )
            return response.status_code

        async with AsyncClient(transport=transport, base_url="http://test") as client:
            noisy_user = [await register(client, attempt, "198.51.100.66") for attempt in range(6)]
            other_users = [
                await register(client, 100 + attempt, f"198.51.100.{attempt}")
                for attempt in range(1, 6)
            ]
    finally:
        await database.stop()

    assert noisy_user == [202] * 5 + [429]
    assert other_users == [202] * 5
