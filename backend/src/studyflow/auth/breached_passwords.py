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
        for line in response.text.splitlines():
            candidate_suffix, separator, count = line.partition(":")
            if separator and candidate_suffix.strip().upper() == suffix and int(count.strip()) > 0:
                return True
        return False
