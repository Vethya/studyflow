"""Tests for trusted-proxy client IP resolution."""

import pytest

from studyflow.api.client_ip import UNKNOWN_CLIENT_IP, resolve_client_ip

RENDER_CHAIN = "198.51.100.7, 104.16.0.1"
"""The real client as appended by Cloudflare, then the Cloudflare edge appended by Render."""


@pytest.mark.parametrize(
    ("forwarded_for", "trusted_proxy_hops", "expected"),
    [
        ([], 0, "10.0.0.5"),
        (["203.0.113.99"], 0, "10.0.0.5"),
        (["203.0.113.99, 198.51.100.7"], 1, "198.51.100.7"),
        ([RENDER_CHAIN], 2, "198.51.100.7"),
        ([f"203.0.113.99, {RENDER_CHAIN}"], 2, "198.51.100.7"),
        ([f"203.0.113.99, 203.0.113.98, {RENDER_CHAIN}"], 2, "198.51.100.7"),
        (["203.0.113.99", RENDER_CHAIN], 2, "198.51.100.7"),
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


def test_resolve_client_ip_keeps_unknown_peers_distinguishable() -> None:
    assert resolve_client_ip(None, [], 0) == UNKNOWN_CLIENT_IP
    assert resolve_client_ip(None, ["104.16.0.1"], 2) == UNKNOWN_CLIENT_IP
    assert resolve_client_ip("testclient", [], 0) == "testclient"
