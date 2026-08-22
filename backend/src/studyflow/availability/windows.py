"""Recurring weekly availability and canonical merging."""

from dataclasses import dataclass
from datetime import time
from typing import Protocol
from uuid import UUID

MINUTES_PER_DAY = 24 * 60
MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY


@dataclass(frozen=True, slots=True)
class AvailabilityWindowDraft:
    weekday: int
    start_time: time
    end_time: time


@dataclass(frozen=True, slots=True)
class AvailabilityWindow:
    id: UUID
    weekday: int
    start_time: time
    end_time: time
    crosses_midnight: bool


def _minutes(value: time) -> int:
    return value.hour * 60 + value.minute


def merge_windows(windows: list[AvailabilityWindowDraft]) -> list[AvailabilityWindowDraft]:
    intervals: list[tuple[int, int]] = []
    for window in windows:
        if not 0 <= window.weekday <= 6:
            raise ValueError("Weekday must be between 0 and 6")
        if any(
            value.second or value.microsecond or value.tzinfo is not None
            for value in (window.start_time, window.end_time)
        ):
            raise ValueError("Availability times must be local minute values")
        start = window.weekday * MINUTES_PER_DAY + _minutes(window.start_time)
        end_minutes = _minutes(window.end_time)
        end = window.weekday * MINUTES_PER_DAY + end_minutes
        if end <= start:
            end += MINUTES_PER_DAY
        intervals.append((start, end))
    merged: list[list[int]] = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    if (
        len(merged) > 1
        and merged[-1][1] >= MINUTES_PER_WEEK
        and merged[-1][1] >= merged[0][0] + MINUTES_PER_WEEK
    ):
        merged[-1][1] = max(merged[-1][1], merged[0][1] + MINUTES_PER_WEEK)
        merged.pop(0)
    result: list[AvailabilityWindowDraft] = []
    for start, end in merged:
        if end - start > MINUTES_PER_DAY:
            raise ValueError("A merged availability window cannot exceed 24 hours")
        start_minute = start % MINUTES_PER_DAY
        end_minute = end % MINUTES_PER_DAY
        result.append(
            AvailabilityWindowDraft(
                weekday=(start // MINUTES_PER_DAY) % 7,
                start_time=time(start_minute // 60, start_minute % 60),
                end_time=time(end_minute // 60, end_minute % 60),
            )
        )
    return result


class AvailabilityWindowRepository(Protocol):
    async def list_windows(self, account_id: UUID) -> list[AvailabilityWindow]: ...
    async def replace(
        self, account_id: UUID, windows: list[AvailabilityWindowDraft]
    ) -> list[AvailabilityWindow]: ...
    async def confirm_timezone(self, account_id: UUID) -> bool: ...


class AvailabilityWindows(Protocol):
    async def list_windows(self, account_id: UUID) -> list[AvailabilityWindow]: ...
    async def replace(
        self, account_id: UUID, windows: list[AvailabilityWindowDraft]
    ) -> list[AvailabilityWindow]: ...
    async def confirm_timezone(self, account_id: UUID) -> bool: ...


class AvailabilityWindowService:
    def __init__(self, repository: AvailabilityWindowRepository) -> None:
        self._repository = repository

    async def list_windows(self, account_id: UUID) -> list[AvailabilityWindow]:
        return await self._repository.list_windows(account_id)

    async def replace(
        self, account_id: UUID, windows: list[AvailabilityWindowDraft]
    ) -> list[AvailabilityWindow]:
        return await self._repository.replace(account_id, merge_windows(windows))

    async def confirm_timezone(self, account_id: UUID) -> bool:
        return await self._repository.confirm_timezone(account_id)
