"""Per-account study reminder preferences."""

from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

DEFAULT_BEFORE_SESSION_MINUTES = 30
# Dispatch runs every 30 minutes, so a shorter lead could fall between two runs.
MIN_BEFORE_SESSION_MINUTES = 30
MAX_BEFORE_SESSION_MINUTES = 120


def is_valid_before_session_minutes(value: int) -> bool:
    return value == 0 or MIN_BEFORE_SESSION_MINUTES <= value <= MAX_BEFORE_SESSION_MINUTES


@dataclass(frozen=True, slots=True)
class ReminderPreferences:
    email_enabled: bool = False
    before_session_minutes: int = DEFAULT_BEFORE_SESSION_MINUTES
    after_session: bool = True


@dataclass(frozen=True, slots=True)
class ReminderPreferencesState:
    preferences: ReminderPreferences
    email_verified: bool


class ReminderPreferencesRepository(Protocol):
    async def get(self, account_id: UUID) -> ReminderPreferencesState | None: ...

    async def update(
        self, account_id: UUID, preferences: ReminderPreferences
    ) -> ReminderPreferencesState | None: ...


class ReminderSettings(Protocol):
    async def get(self, account_id: UUID) -> ReminderPreferencesState | None: ...

    async def update(
        self, account_id: UUID, preferences: ReminderPreferences
    ) -> ReminderPreferencesState | None: ...


class ReminderPreferencesService:
    def __init__(self, repository: ReminderPreferencesRepository) -> None:
        self._repository = repository

    async def get(self, account_id: UUID) -> ReminderPreferencesState | None:
        return await self._repository.get(account_id)

    async def update(
        self, account_id: UUID, preferences: ReminderPreferences
    ) -> ReminderPreferencesState | None:
        if not is_valid_before_session_minutes(preferences.before_session_minutes):
            raise ValueError("before_session_minutes must be 0 or between 30 and 120")
        return await self._repository.update(account_id, preferences)
