from dataclasses import dataclass
from uuid import UUID

import pytest

from studyflow.accounts.profile import AccountProfile, AccountProfileService


@dataclass
class ProfileRepositoryStub:
    profile: AccountProfile | None
    updated: tuple[UUID, str] | None = None

    async def get(self, account_id: UUID) -> AccountProfile | None:
        return self.profile

    async def update_name(self, account_id: UUID, name: str) -> AccountProfile | None:
        self.updated = (account_id, name)
        return self.profile


@pytest.mark.anyio
async def test_account_profile_service_scopes_reads_and_updates_to_account() -> None:
    account_id = UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3")
    profile = AccountProfile(account_id, "student@example.com", "New Name")
    repository = ProfileRepositoryStub(profile)
    service = AccountProfileService(repository)

    assert await service.get(account_id) == profile
    assert await service.update_name(account_id, "New Name") == profile
    assert repository.updated == (account_id, "New Name")
