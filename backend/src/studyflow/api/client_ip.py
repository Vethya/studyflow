"""Client address resolution for abuse-control keys behind reverse proxies."""

from hmac import compare_digest
from ipaddress import IPv6Address, ip_address
from typing import cast

from fastapi import Request
from pydantic import SecretStr

from studyflow.settings import Settings

UNKNOWN_CLIENT_IP = "unknown"
FRONTEND_CLIENT_IP_HEADER = "x-studyflow-client-ip"
"""End-user address forwarded by the StudyFlow frontend proxy."""
FRONTEND_PROXY_SECRET_HEADER = "x-studyflow-proxy-secret"  # noqa: S105
"""Shared secret proving that ``FRONTEND_CLIENT_IP_HEADER`` was set by the frontend proxy."""


def resolve_client_ip(
    peer_host: str | None,
    forwarded_for: list[str],
    trusted_proxy_hops: int,
) -> str:
    """Return the client address recorded by the outermost trusted proxy.

    Every proxy appends the address that connected to it to ``X-Forwarded-For``, so only the
    right-most ``trusted_proxy_hops`` entries were written by infrastructure in front of the API.
    Entries further left are supplied by the client and are never used. The entry
    ``trusted_proxy_hops`` positions from the right is the address that connected to the
    outermost trusted proxy. Without trusted proxies, or when the header is missing, shorter than
    the trusted chain, or malformed at that position, the TCP peer address is used instead, so a
    client can never choose its own rate-limit key.
    """
    if trusted_proxy_hops > 0:
        entries = [entry.strip() for value in forwarded_for for entry in value.split(",")]
        if len(entries) >= trusted_proxy_hops:
            forwarded_ip = _normalize_ip(entries[-trusted_proxy_hops])
            if forwarded_ip is not None:
                return forwarded_ip
    if peer_host is None:
        return UNKNOWN_CLIENT_IP
    return _normalize_ip(peer_host) or peer_host


def resolve_frontend_proxy_client_ip(
    forwarded_client_ip: list[str],
    presented_secret: list[str],
    expected_secret: SecretStr | None,
) -> str | None:
    """Return the end-user address forwarded by the frontend proxy, if it is authenticated.

    Browser traffic reaches the API through the frontend's server-side proxy, so the proxy hops
    only identify the frontend's egress address, which unrelated users share. The frontend sends
    the end-user address it verified, together with a shared secret. The address is used only
    when exactly one secret header matches the configured secret (compared in constant time) and
    exactly one well-formed address is supplied. Anything else returns ``None`` and the caller
    falls back to the proxy hops, so a client that does not know the secret cannot choose its own
    rate-limit key.
    """
    if expected_secret is None or len(presented_secret) != 1 or len(forwarded_client_ip) != 1:
        return None
    if not compare_digest(
        presented_secret[0].encode(),
        expected_secret.get_secret_value().encode(),
    ):
        return None
    return _normalize_ip(forwarded_client_ip[0].strip())


def request_client_ip(request: Request) -> str:
    """Resolve the abuse-control client address for a request.

    An authenticated end-user address from the frontend proxy wins; otherwise the address is
    derived from the configured proxy hops.
    """
    settings = cast(Settings, request.app.state.settings)
    frontend_client_ip = resolve_frontend_proxy_client_ip(
        request.headers.getlist(FRONTEND_CLIENT_IP_HEADER),
        request.headers.getlist(FRONTEND_PROXY_SECRET_HEADER),
        settings.frontend_proxy_secret,
    )
    if frontend_client_ip is not None:
        return frontend_client_ip
    peer_host = request.client.host if request.client is not None else None
    return resolve_client_ip(
        peer_host,
        request.headers.getlist("x-forwarded-for"),
        settings.trusted_proxy_hops,
    )


def _normalize_ip(value: str) -> str | None:
    try:
        address = ip_address(value)
    except ValueError:
        return None
    if isinstance(address, IPv6Address) and address.ipv4_mapped is not None:
        return str(address.ipv4_mapped)
    return str(address)
