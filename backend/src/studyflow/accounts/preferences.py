"""Study-preference application boundary."""

from dataclasses import dataclass
from typing import Protocol
from uuid import UUID


@dataclass(frozen=True, slots=True)
class StudyPreferences:
    timezone: str
    preferred_session_length_minutes: int
    minimum_break_minutes: int
    availability_confirmation_required: bool


class StudyPreferencesRepository(Protocol):
    async def get(self, account_id: UUID) -> StudyPreferences | None: ...

    async def update(
        self,
        account_id: UUID,
        timezone: str,
        preferred_session_length_minutes: int,
        minimum_break_minutes: int,
    ) -> StudyPreferences | None: ...


class AccountPreferences(Protocol):
    async def get(self, account_id: UUID) -> StudyPreferences | None: ...

    async def update(
        self,
        account_id: UUID,
        timezone: str,
        preferred_session_length_minutes: int,
        minimum_break_minutes: int,
    ) -> StudyPreferences | None: ...


class StudyPreferencesService:
    def __init__(self, repository: StudyPreferencesRepository) -> None:
        self._repository = repository

    async def get(self, account_id: UUID) -> StudyPreferences | None:
        return await self._repository.get(account_id)

    async def update(
        self,
        account_id: UUID,
        timezone: str,
        preferred_session_length_minutes: int,
        minimum_break_minutes: int,
    ) -> StudyPreferences | None:
        return await self._repository.update(
            account_id,
            timezone,
            preferred_session_length_minutes,
            minimum_break_minutes,
        )
