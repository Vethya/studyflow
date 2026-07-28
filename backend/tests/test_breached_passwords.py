import httpx
import pytest

from studyflow.auth.breached_passwords import PwnedPasswordsClient


@pytest.mark.anyio
async def test_breached_password_lookup_sends_only_a_sha1_prefix() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == "https://api.pwnedpasswords.com/range/5BAA6"
        assert request.headers["Add-Padding"] == "true"
        assert request.content == b""
        return httpx.Response(200, text="1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493\r\n")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        checker = PwnedPasswordsClient(client)

        assert await checker.is_breached("password") is True


@pytest.mark.anyio
async def test_padding_entries_with_zero_occurrences_are_not_breaches() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="1E4C9B93F3F0682250B6CF8331B7EE68FD8:0\r\n")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        checker = PwnedPasswordsClient(client)

        assert await checker.is_breached("password") is False


@pytest.mark.anyio
async def test_non_matching_hash_suffix_is_not_breached() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:42\r\n")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        assert await PwnedPasswordsClient(client).is_breached("password") is False


@pytest.mark.anyio
async def test_upstream_failure_is_not_treated_as_a_safe_password() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(httpx.HTTPStatusError):
            await PwnedPasswordsClient(client).is_breached("password")


@pytest.mark.anyio
async def test_upstream_timeout_is_not_treated_as_a_safe_password() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(httpx.ReadTimeout):
            await PwnedPasswordsClient(client).is_breached("password")
