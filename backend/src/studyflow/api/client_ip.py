"""Client address resolution for abuse-control keys behind reverse proxies."""

from ipaddress import IPv6Address, ip_address
from typing import cast

from fastapi import Request

from studyflow.settings import Settings

UNKNOWN_CLIENT_IP = "unknown"


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


def request_client_ip(request: Request) -> str:
    """Resolve the abuse-control client address for a request using the configured proxy hops."""
    settings = cast(Settings, request.app.state.settings)
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
