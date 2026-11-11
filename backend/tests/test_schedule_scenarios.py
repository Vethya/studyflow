from datetime import UTC, datetime, timedelta, timezone
from uuid import UUID

import pytest

from studyflow.scheduling.scenarios import (
    ScenarioAvailabilityWindow,
    ScenarioBlockedPeriod,
    ScenarioDeadlineOverride,
    ScenarioValidationError,
    ScheduleScenario,
)

NOW = datetime(2026, 9, 4, 10, tzinfo=UTC)
TASK_ID = UUID(int=1)


def test_scenario_round_trip_normalizes_offsets_and_reasons_without_mutating_inputs() -> None:
    local = NOW.astimezone(timezone(timedelta(hours=7)))
    scenario = ScheduleScenario(
        temporary_availability=(ScenarioAvailabilityWindow(local, local + timedelta(hours=1)),),
        temporary_blocked_periods=(
            ScenarioBlockedPeriod(local, local + timedelta(minutes=15), "  Lunch  "),
            ScenarioBlockedPeriod(local, local + timedelta(minutes=15), "  "),
        ),
        deadline_overrides=(ScenarioDeadlineOverride(TASK_ID, local),),
    )
    payload = scenario.as_payload()
    assert payload == {
        "temporary_availability": [
            {"starts_at": "2026-09-04T10:00Z", "ends_at": "2026-09-04T11:00Z"}
        ],
        "temporary_blocked_periods": [
            {"starts_at": "2026-09-04T10:00Z", "ends_at": "2026-09-04T10:15Z", "reason": "Lunch"},
            {"starts_at": "2026-09-04T10:00Z", "ends_at": "2026-09-04T10:15Z", "reason": None},
        ],
        "deadline_overrides": [{"task_id": str(TASK_ID), "deadline_at": "2026-09-04T10:00Z"}],
    }
    assert ScheduleScenario.from_payload(payload) == scenario.normalized()
    assert scenario.temporary_blocked_periods[0].reason == "  Lunch  "
    assert not scenario.is_empty
    assert ScheduleScenario.from_payload({}).is_empty


@pytest.mark.parametrize(
    "payload",
    [
        {"temporary_availability": "invalid"},
        {"temporary_availability": [1]},
        {"temporary_availability": [{"starts_at": 1}]},
        {"temporary_availability": [{"starts_at": "nonsense"}]},
        {"temporary_availability": [{"starts_at": "2026-09-04T10:00"}]},
        {"temporary_availability": [{"starts_at": "2026-09-04T10:00:01Z"}]},
        {"temporary_blocked_periods": "invalid"},
        {"temporary_blocked_periods": [1]},
        {"temporary_blocked_periods": [{"reason": 1}]},
        {"deadline_overrides": "invalid"},
        {"deadline_overrides": [1]},
        {"deadline_overrides": [{"task_id": 1}]},
        {"deadline_overrides": [{"task_id": "not-a-uuid"}]},
    ],
)
def test_scenario_rejects_malformed_payload_instead_of_silently_dropping_it(
    payload: dict[str, object],
) -> None:
    with pytest.raises(ScenarioValidationError):
        ScheduleScenario.from_payload(payload)


@pytest.mark.parametrize("duration", [timedelta(0), timedelta(minutes=-1), timedelta(days=2)])
def test_temporary_availability_requires_positive_duration_at_most_one_day(
    duration: timedelta,
) -> None:
    with pytest.raises(ScenarioValidationError):
        ScenarioAvailabilityWindow(NOW, NOW + duration)


def test_blocked_period_rejects_reversed_range_and_oversized_reason() -> None:
    with pytest.raises(ScenarioValidationError):
        ScenarioBlockedPeriod(NOW, NOW)
    with pytest.raises(ScenarioValidationError):
        ScenarioBlockedPeriod(NOW, NOW + timedelta(hours=1), "x" * 201)


def test_scenarios_enforce_resource_limits_and_unique_task_overrides() -> None:
    window = ScenarioAvailabilityWindow(NOW, NOW + timedelta(hours=1))
    blocked = ScenarioBlockedPeriod(NOW, NOW + timedelta(hours=1))
    overrides = tuple(ScenarioDeadlineOverride(UUID(int=i), NOW) for i in range(65))
    with pytest.raises(ScenarioValidationError):
        ScheduleScenario(temporary_availability=(window,) * 33)
    with pytest.raises(ScenarioValidationError):
        ScheduleScenario(temporary_blocked_periods=(blocked,) * 33)
    with pytest.raises(ScenarioValidationError):
        ScheduleScenario(deadline_overrides=overrides)
    with pytest.raises(ScenarioValidationError):
        ScheduleScenario(deadline_overrides=(overrides[0], overrides[0]))
    assert len(ScheduleScenario(deadline_overrides=overrides[:64]).deadline_overrides) == 64
