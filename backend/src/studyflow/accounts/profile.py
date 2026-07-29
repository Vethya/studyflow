"""Account profile application boundary."""

from dataclasses import dataclass
from typing import Protocol
from uuid import UUID


@dataclass(frozen=True, slots=True)
class AccountProfile:
    id: UUID
    email: str
    name: str


class AccountProfileRepository(Protocol):
    async def get(self, account_id: UUID) -> AccountProfile | None: ...

    async def update_name(self, account_id: UUID, name: str) -> AccountProfile | None: ...


class AccountProfiles(Protocol):
    async def get(self, account_id: UUID) -> AccountProfile | None: ...

    async def update_name(self, account_id: UUID, name: str) -> AccountProfile | None: ...


class AccountProfileService:
    def __init__(self, repository: AccountProfileRepository) -> None:
        self._repository = repository

    async def get(self, account_id: UUID) -> AccountProfile | None:
        return await self._repository.get(account_id)

    async def update_name(self, account_id: UUID, name: str) -> AccountProfile | None:
        return await self._repository.update_name(account_id, name)
