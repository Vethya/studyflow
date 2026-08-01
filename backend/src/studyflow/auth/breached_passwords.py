"""Breached-password checking through the Pwned Passwords range API."""

import hashlib
from typing import Protocol

import httpx

PWNED_PASSWORDS_RANGE_URL = "https://api.pwnedpasswords.com/range/{prefix}"


class BreachedPasswordChecker(Protocol):
    async def is_breached(self, password: str) -> bool: ...


class PwnedPasswordsClient:
    """Use k-anonymity so a complete password hash never leaves StudyFlow."""

    def __init__(self, client: httpx.AsyncClient) -> None:
        self._client = client

    async def is_breached(self, password: str) -> bool:
        digest = hashlib.sha1(password.encode(), usedforsecurity=False).hexdigest().upper()
        prefix, suffix = digest[:5], digest[5:]
        response = await self._client.get(
            PWNED_PASSWORDS_RANGE_URL.format(prefix=prefix),
            headers={"Add-Padding": "true"},
        )
        response.raise_for_status()
        lines = [line for line in response.text.splitlines() if line]
        if not lines:
            raise httpx.DecodingError("Empty Pwned Passwords response", request=response.request)
        breached = False
        for line in lines:
            candidate_suffix, separator, count = line.partition(":")
            normalized_suffix = candidate_suffix.strip().upper()
            try:
                occurrence_count = int(count.strip())
            except ValueError as error:
                raise httpx.DecodingError(
                    "Malformed Pwned Passwords response", request=response.request
                ) from error
            if (
                not separator
                or len(normalized_suffix) != 35
                or any(character not in "0123456789ABCDEF" for character in normalized_suffix)
                or occurrence_count < 0
            ):
                raise httpx.DecodingError(
                    "Malformed Pwned Passwords response", request=response.request
                )
            breached = breached or (normalized_suffix == suffix and occurrence_count > 0)
        return breached
