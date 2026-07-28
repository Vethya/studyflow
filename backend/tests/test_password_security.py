import threading

import pytest

import studyflow.auth.passwords as password_module
from studyflow.auth.passwords import (
    BreachedPasswordError,
    PasswordPolicyError,
    PasswordService,
)


class BreachedPasswordStub:
    async def is_breached(self, password: str) -> bool:
        return True


class UnexpectedBreachLookupStub:
    async def is_breached(self, password: str) -> bool:
        raise AssertionError("Breach lookup must not run for a locally invalid password")


class SafePasswordStub:
    async def is_breached(self, password: str) -> bool:
        return False


@pytest.mark.anyio
async def test_password_hashes_with_argon2id_and_verifies() -> None:
    service = PasswordService(SafePasswordStub())
    candidate = "correct horse battery staple 🔐"

    password_hash = await service.hash_password(candidate)

    assert password_hash.startswith("$argon2id$")
    assert "$m=19456,t=2,p=1$" in password_hash
    assert await service.verify_password(candidate, password_hash) is True
    assert await service.verify_password("different password", password_hash) is False


@pytest.mark.anyio
async def test_password_rejects_fewer_than_twelve_characters() -> None:
    with pytest.raises(PasswordPolicyError, match="at least 12 characters"):
        await PasswordService(SafePasswordStub()).hash_password("short pass!")


@pytest.mark.anyio
async def test_password_rejects_more_than_128_characters() -> None:
    with pytest.raises(PasswordPolicyError, match="at most 128 characters"):
        await PasswordService(SafePasswordStub()).hash_password("a" * 129)


@pytest.mark.anyio
async def test_registration_rejects_a_known_breached_password() -> None:
    service = PasswordService(BreachedPasswordStub())

    with pytest.raises(BreachedPasswordError, match="appears in a known breach"):
        await service.hash_password("correct horse battery staple")


@pytest.mark.anyio
async def test_registration_applies_local_policy_before_breach_lookup() -> None:
    service = PasswordService(UnexpectedBreachLookupStub())

    with pytest.raises(PasswordPolicyError, match="at least 12 characters"):
        await service.hash_password("too short")


@pytest.mark.anyio
async def test_argon2_hashing_runs_outside_the_event_loop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    event_loop_thread = threading.get_ident()
    hashing_threads: list[int] = []

    def record_hash(self: object, password: str) -> str:
        hashing_threads.append(threading.get_ident())
        return "$argon2id$test-hash"

    monkeypatch.setattr(password_module._PasswordHasher, "hash_password", record_hash)

    await PasswordService(SafePasswordStub()).hash_password("correct horse battery staple")

    assert hashing_threads
    assert hashing_threads[0] != event_loop_thread


@pytest.mark.anyio
async def test_argon2_verification_runs_outside_the_event_loop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    event_loop_thread = threading.get_ident()
    verification_threads: list[int] = []

    def record_verification(self: object, password: str, password_hash: str) -> bool:
        verification_threads.append(threading.get_ident())
        return True

    monkeypatch.setattr(
        password_module._PasswordHasher,
        "verify_password",
        record_verification,
    )

    verified = await PasswordService(SafePasswordStub()).verify_password(
        "correct horse battery staple",
        "$argon2id$test-hash",
    )

    assert verified is True
    assert verification_threads[0] != event_loop_thread
