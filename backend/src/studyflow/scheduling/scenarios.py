"""Validated, non-persistent scheduling scenario overrides."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID


class ScenarioValidationError(ValueError):
    """Raised when a hypothetical scheduling input is invalid."""


def _utc_minute(value: datetime, name: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ScenarioValidationError(f"{name} must be timezone-aware")
    if value.second or value.microsecond:
        raise ScenarioValidationError(f"{name} must use an exact minute boundary")
    return value.astimezone(UTC)


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="minutes").replace("+00:00", "Z")


def _parse_datetime(value: object, name: str) -> datetime:
    if not isinstance(value, str):
        raise ScenarioValidationError(f"{name} must be an ISO-8601 datetime")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ScenarioValidationError(f"{name} must be an ISO-8601 datetime") from error
    return _utc_minute(parsed, name)


@dataclass(frozen=True, slots=True)
class ScenarioAvailabilityWindow:
    starts_at: datetime
    ends_at: datetime

    def __post_init__(self) -> None:
        starts_at = _utc_minute(self.starts_at, "temporary availability starts_at")
        ends_at = _utc_minute(self.ends_at, "temporary availability ends_at")
        if ends_at <= starts_at:
            raise ScenarioValidationError("temporary availability ends_at must be after starts_at")
        if ends_at - starts_at > timedelta(days=1):
            raise ScenarioValidationError("temporary availability cannot exceed one day")


@dataclass(frozen=True, slots=True)
class ScenarioBlockedPeriod:
    starts_at: datetime
    ends_at: datetime
    reason: str | None = None

    def __post_init__(self) -> None:
        starts_at = _utc_minute(self.starts_at, "temporary blocked period starts_at")
        ends_at = _utc_minute(self.ends_at, "temporary blocked period ends_at")
        if ends_at <= starts_at:
            raise ScenarioValidationError(
                "temporary blocked period ends_at must be after starts_at"
            )
        if self.reason is not None and len(self.reason) > 200:
            raise ScenarioValidationError(
                "temporary blocked period reason cannot exceed 200 characters"
            )


@dataclass(frozen=True, slots=True)
class ScenarioDeadlineOverride:
    task_id: UUID
    deadline_at: datetime

    def __post_init__(self) -> None:
        _utc_minute(self.deadline_at, "deadline override deadline_at")


@dataclass(frozen=True, slots=True)
class ScheduleScenario:
    """A bounded hypothetical input applied only to one solver run."""

    temporary_availability: tuple[ScenarioAvailabilityWindow, ...] = ()
    temporary_blocked_periods: tuple[ScenarioBlockedPeriod, ...] = ()
    deadline_overrides: tuple[ScenarioDeadlineOverride, ...] = ()

    def __post_init__(self) -> None:
        if len(self.temporary_availability) > 32:
            raise ScenarioValidationError(
                "A scenario cannot contain more than 32 availability windows"
            )
        if len(self.temporary_blocked_periods) > 32:
            raise ScenarioValidationError("A scenario cannot contain more than 32 blocked periods")
        if len(self.deadline_overrides) > 64:
            raise ScenarioValidationError(
                "A scenario cannot contain more than 64 deadline overrides"
            )
        task_ids = [override.task_id for override in self.deadline_overrides]
        if len(task_ids) != len(set(task_ids)):
            raise ScenarioValidationError("A task can have only one deadline override")

    @property
    def is_empty(self) -> bool:
        return not (
            self.temporary_availability or self.temporary_blocked_periods or self.deadline_overrides
        )

    def normalized(self) -> "ScheduleScenario":
        return ScheduleScenario(
            temporary_availability=tuple(
                ScenarioAvailabilityWindow(
                    _utc_minute(item.starts_at, "temporary availability starts_at"),
                    _utc_minute(item.ends_at, "temporary availability ends_at"),
                )
                for item in self.temporary_availability
            ),
            temporary_blocked_periods=tuple(
                ScenarioBlockedPeriod(
                    _utc_minute(item.starts_at, "temporary blocked period starts_at"),
                    _utc_minute(item.ends_at, "temporary blocked period ends_at"),
                    item.reason.strip() if item.reason and item.reason.strip() else None,
                )
                for item in self.temporary_blocked_periods
            ),
            deadline_overrides=tuple(
                ScenarioDeadlineOverride(
                    item.task_id,
                    _utc_minute(item.deadline_at, "deadline override deadline_at"),
                )
                for item in self.deadline_overrides
            ),
        )

    def as_payload(self) -> dict[str, object]:
        scenario = self.normalized()
        return {
            "temporary_availability": [
                {"starts_at": _iso(item.starts_at), "ends_at": _iso(item.ends_at)}
                for item in scenario.temporary_availability
            ],
            "temporary_blocked_periods": [
                {
                    "starts_at": _iso(item.starts_at),
                    "ends_at": _iso(item.ends_at),
                    "reason": item.reason,
                }
                for item in scenario.temporary_blocked_periods
            ],
            "deadline_overrides": [
                {"task_id": str(item.task_id), "deadline_at": _iso(item.deadline_at)}
                for item in scenario.deadline_overrides
            ],
        }

    @classmethod
    def from_payload(cls, payload: Mapping[str, object]) -> "ScheduleScenario":
        def ranges(name: str) -> tuple[ScenarioAvailabilityWindow, ...]:
            values = payload.get(name, [])
            if not isinstance(values, list):
                raise ScenarioValidationError(f"{name} must be a list")
            result = []
            for index, item in enumerate(values):
                if not isinstance(item, Mapping):
                    raise ScenarioValidationError(f"{name}[{index}] must be an object")
                result.append(
                    ScenarioAvailabilityWindow(
                        _parse_datetime(item.get("starts_at"), f"{name}[{index}].starts_at"),
                        _parse_datetime(item.get("ends_at"), f"{name}[{index}].ends_at"),
                    )
                )
            return tuple(result)

        blocked_values = payload.get("temporary_blocked_periods", [])
        if not isinstance(blocked_values, list):
            raise ScenarioValidationError("temporary_blocked_periods must be a list")
        blocked = []
        for index, item in enumerate(blocked_values):
            if not isinstance(item, Mapping):
                raise ScenarioValidationError(
                    f"temporary_blocked_periods[{index}] must be an object"
                )
            reason = item.get("reason")
            if reason is not None and not isinstance(reason, str):
                raise ScenarioValidationError(
                    f"temporary_blocked_periods[{index}].reason must be a string"
                )
            blocked.append(
                ScenarioBlockedPeriod(
                    _parse_datetime(
                        item.get("starts_at"), f"temporary_blocked_periods[{index}].starts_at"
                    ),
                    _parse_datetime(
                        item.get("ends_at"), f"temporary_blocked_periods[{index}].ends_at"
                    ),
                    reason,
                )
            )

        override_values = payload.get("deadline_overrides", [])
        if not isinstance(override_values, list):
            raise ScenarioValidationError("deadline_overrides must be a list")
        overrides = []
        for index, item in enumerate(override_values):
            if not isinstance(item, Mapping):
                raise ScenarioValidationError(f"deadline_overrides[{index}] must be an object")
            task_id = item.get("task_id")
            if not isinstance(task_id, str):
                raise ScenarioValidationError(f"deadline_overrides[{index}].task_id must be a UUID")
            try:
                parsed_task_id = UUID(task_id)
            except ValueError as error:
                raise ScenarioValidationError(
                    f"deadline_overrides[{index}].task_id must be a UUID"
                ) from error
            overrides.append(
                ScenarioDeadlineOverride(
                    parsed_task_id,
                    _parse_datetime(
                        item.get("deadline_at"), f"deadline_overrides[{index}].deadline_at"
                    ),
                )
            )

        return cls(
            temporary_availability=ranges("temporary_availability"),
            temporary_blocked_periods=tuple(blocked),
            deadline_overrides=tuple(overrides),
        ).normalized()
