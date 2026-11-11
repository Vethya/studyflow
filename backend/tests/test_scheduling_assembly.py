from datetime import UTC, datetime, time, timedelta
from uuid import UUID

import pytest

from studyflow.accounts.preferences import StudyPreferences
from studyflow.availability.unavailable import UnavailablePeriodDraft
from studyflow.availability.windows import AvailabilityWindowDraft
from studyflow.scheduling import (
    AvailabilityTimezoneConfirmationRequiredError,
    KernelStatus,
    MinuteWindow,
    PlanningDay,
    SchedulingInputError,
    SchedulingInputTooLargeError,
    TaskPriority,
    assemble_schedule_problem,
    solve_with_overload,
)
from studyflow.scheduling.scenarios import (
    ScenarioAvailabilityWindow,
    ScenarioBlockedPeriod,
)
from studyflow.tasks.service import (
    AcademicTaskRecord,
    TaskCategory,
    TaskStatus,
)
from studyflow.tasks.service import (
    TaskPriority as AcademicTaskPriority,
)

ACCOUNT_ID = UUID("00000000-0000-0000-0000-000000000001")
TASK_A_ID = UUID("00000000-0000-0000-0000-00000000000a")
TASK_B_ID = UUID("00000000-0000-0000-0000-00000000000b")


def _minute(value: datetime) -> int:
    delta = value - datetime(1970, 1, 1, tzinfo=UTC)
    return delta.days * 1_440 + delta.seconds // 60


def _task(
    task_id: UUID,
    deadline: datetime,
    duration: int,
    *,
    priority: AcademicTaskPriority = AcademicTaskPriority.MEDIUM,
    status: TaskStatus = TaskStatus.NOT_STARTED,
) -> AcademicTaskRecord:
    created_at = datetime(2026, 1, 1, tzinfo=UTC)
    return AcademicTaskRecord(
        id=task_id,
        account_id=ACCOUNT_ID,
        title=f"Task {task_id}",
        category=TaskCategory.ASSIGNMENT,
        priority=priority,
        course=None,
        notes=None,
        deadline_at=deadline,
        original_estimate_minutes=duration,
        planned_duration_minutes=duration,
        created_at=created_at,
        updated_at=created_at,
        status=status,
    )


def _preferences(*, confirmation_required: bool = False) -> StudyPreferences:
    return StudyPreferences("UTC", 60, 10, confirmation_required)


def test_assembles_tasks_calendar_and_preferences_into_solver_input() -> None:
    planning_start = datetime(2026, 1, 5, 8, tzinfo=UTC)
    first_deadline = datetime(2026, 1, 5, 14, tzinfo=UTC)
    last_deadline = datetime(2026, 1, 6, 12, tzinfo=UTC)
    problem = assemble_schedule_problem(
        [
            _task(TASK_B_ID, last_deadline, 45, priority=AcademicTaskPriority.LOW),
            _task(TASK_A_ID, first_deadline, 130, priority=AcademicTaskPriority.HIGH),
        ],
        [
            AvailabilityWindowDraft(0, time(9), time(17)),
            AvailabilityWindowDraft(1, time(9), time(17)),
        ],
        [
            UnavailablePeriodDraft(
                datetime(2026, 1, 5, 10, tzinfo=UTC),
                datetime(2026, 1, 5, 11, tzinfo=UTC),
            )
        ],
        _preferences(),
        planning_start=planning_start,
    )

    expected_windows = (
        MinuteWindow(
            _minute(datetime(2026, 1, 5, 9, tzinfo=UTC)),
            _minute(datetime(2026, 1, 5, 10, tzinfo=UTC)),
        ),
        MinuteWindow(
            _minute(datetime(2026, 1, 5, 11, tzinfo=UTC)),
            _minute(datetime(2026, 1, 5, 17, tzinfo=UTC)),
        ),
        MinuteWindow(_minute(datetime(2026, 1, 6, 9, tzinfo=UTC)), _minute(last_deadline)),
    )
    assert [session.duration_minutes for session in problem.sessions] == [60, 60, 10, 45]
    assert [session.task_id for session in problem.sessions] == [str(TASK_A_ID)] * 3 + [
        str(TASK_B_ID)
    ]
    assert [session.priority for session in problem.sessions] == [TaskPriority.HIGH] * 3 + [
        TaskPriority.LOW
    ]
    assert [session.deadline_minute for session in problem.sessions] == [
        _minute(first_deadline),
        _minute(first_deadline),
        _minute(first_deadline),
        _minute(last_deadline),
    ]
    assert all(session.allowed_windows == expected_windows for session in problem.sessions)
    assert problem.planning_start_minute == _minute(planning_start)
    assert problem.minimum_break_minutes == 10
    assert problem.planning_days == (
        PlanningDay(0, _minute(planning_start), _minute(datetime(2026, 1, 6, tzinfo=UTC))),
        PlanningDay(1, _minute(datetime(2026, 1, 6, tzinfo=UTC)), _minute(last_deadline)),
    )


def test_excludes_completed_and_expired_tasks() -> None:
    planning_start = datetime(2026, 1, 5, 8, tzinfo=UTC)
    problem = assemble_schedule_problem(
        [
            _task(TASK_A_ID, planning_start - timedelta(minutes=1), 60),
            _task(
                TASK_B_ID,
                planning_start + timedelta(days=1),
                60,
                status=TaskStatus.COMPLETED,
            ),
        ],
        [],
        [],
        _preferences(),
        planning_start=planning_start,
    )

    assert problem.sessions == ()
    assert problem.planning_days == ()


def test_requires_availability_timezone_confirmation() -> None:
    with pytest.raises(AvailabilityTimezoneConfirmationRequiredError, match="Confirm"):
        assemble_schedule_problem(
            [],
            [],
            [],
            _preferences(confirmation_required=True),
            planning_start=datetime(2026, 1, 5, tzinfo=UTC),
        )


def test_no_availability_keeps_work_for_overload_reporting() -> None:
    planning_start = datetime(2026, 1, 5, tzinfo=UTC)
    problem = assemble_schedule_problem(
        [_task(TASK_A_ID, planning_start + timedelta(days=1), 60)],
        [],
        [],
        _preferences(),
        planning_start=planning_start,
    )

    assert len(problem.sessions) == 1
    assert problem.sessions[0].allowed_windows == ()


def test_subminute_horizon_becomes_normal_overload_input() -> None:
    planning_start = datetime(2026, 1, 5, 8, 0, 45, tzinfo=UTC)
    problem = assemble_schedule_problem(
        [_task(TASK_A_ID, planning_start + timedelta(seconds=5), 60)],
        [AvailabilityWindowDraft(0, time(8), time(9))],
        [],
        _preferences(),
        planning_start=planning_start,
    )

    assert len(problem.sessions) == 1
    assert problem.sessions[0].allowed_windows == ()
    assert problem.planning_days == ()
    assert solve_with_overload(problem).status is KernelStatus.OVERLOAD


def test_distant_task_omits_fairness_days_without_rejecting_schedule() -> None:
    planning_start = datetime(2026, 1, 5, tzinfo=UTC)
    problem = assemble_schedule_problem(
        [_task(TASK_A_ID, planning_start + timedelta(days=367), 60)],
        [AvailabilityWindowDraft(0, time(9), time(10))],
        [],
        _preferences(),
        planning_start=planning_start,
    )

    assert len(problem.sessions) == 1
    assert problem.planning_days == ()
    assert solve_with_overload(problem).status is KernelStatus.FEASIBLE


def test_rejects_too_many_sessions_before_calendar_expansion() -> None:
    planning_start = datetime(2026, 1, 5, tzinfo=UTC)
    with pytest.raises(SchedulingInputTooLargeError, match="sessions"):
        assemble_schedule_problem(
            [_task(TASK_A_ID, planning_start + timedelta(days=1), 100_010)],
            [],
            [],
            StudyPreferences("UTC", 10, 10, False),
            planning_start=planning_start,
        )


def test_assembly_validates_timezone_awareness() -> None:
    naive_planning_start = datetime(2026, 1, 5, 8, 0)
    with pytest.raises(SchedulingInputError, match="timezone-aware"):
        assemble_schedule_problem(
            [_task(TASK_A_ID, datetime(2026, 1, 6, tzinfo=UTC), 60)],
            [],
            [],
            _preferences(),
            planning_start=naive_planning_start,
        )

    planning_start = datetime(2026, 1, 5, 8, 0, tzinfo=UTC)
    naive_task = _task(TASK_A_ID, datetime(2026, 1, 6, 8, 0), 60)
    with pytest.raises(SchedulingInputError, match="Task deadlines must be timezone-aware"):
        assemble_schedule_problem(
            [naive_task],
            [],
            [],
            _preferences(),
            planning_start=planning_start,
        )


def test_assembly_applies_scenario_availability_and_blocked_periods() -> None:
    planning_start = datetime(2026, 1, 5, 8, 0, tzinfo=UTC)
    deadline = planning_start + timedelta(days=1)
    task = _task(TASK_A_ID, deadline, 60)

    # Base window: Mon 09:00 - 12:00
    base_window = AvailabilityWindowDraft(0, time(9), time(12))

    # Scenario availability: Mon 13:00 - 15:00, plus an out-of-bounds period
    temp_window = ScenarioAvailabilityWindow(
        starts_at=datetime(2026, 1, 5, 13, 0, tzinfo=UTC),
        ends_at=datetime(2026, 1, 5, 15, 0, tzinfo=UTC),
    )
    temp_window_out_of_bounds = ScenarioAvailabilityWindow(
        starts_at=datetime(2026, 1, 1, 10, 0, tzinfo=UTC),
        ends_at=datetime(2026, 1, 1, 11, 0, tzinfo=UTC),
    )

    # Temporary blocked period: cuts base window into 09:00-10:00 and 11:00-12:00
    # plus an out-of-bounds period (before planning start)
    temp_blocked = ScenarioBlockedPeriod(
        starts_at=datetime(2026, 1, 5, 10, 0, tzinfo=UTC),
        ends_at=datetime(2026, 1, 5, 11, 0, tzinfo=UTC),
    )
    temp_blocked_out_of_bounds = ScenarioBlockedPeriod(
        starts_at=datetime(2026, 1, 1, 15, 0, tzinfo=UTC),
        ends_at=datetime(2026, 1, 1, 16, 0, tzinfo=UTC),
    )

    problem = assemble_schedule_problem(
        [task],
        [base_window],
        [],
        _preferences(),
        planning_start=planning_start,
        temporary_availability=[temp_window, temp_window_out_of_bounds],
        temporary_blocked_periods=[temp_blocked, temp_blocked_out_of_bounds],
    )

    assert len(problem.sessions) == 1
    session = problem.sessions[0]
    # Allowed windows should have: 09:00-10:00, 11:00-12:00, 13:00-15:00
    assert len(session.allowed_windows) == 3
    w0, w1, w2 = session.allowed_windows
    assert w0.start == _minute(datetime(2026, 1, 5, 9, 0, tzinfo=UTC))
    assert w0.end == _minute(datetime(2026, 1, 5, 10, 0, tzinfo=UTC))
    assert w1.start == _minute(datetime(2026, 1, 5, 11, 0, tzinfo=UTC))
    assert w1.end == _minute(datetime(2026, 1, 5, 12, 0, tzinfo=UTC))
    assert w2.start == _minute(datetime(2026, 1, 5, 13, 0, tzinfo=UTC))
    assert w2.end == _minute(datetime(2026, 1, 5, 15, 0, tzinfo=UTC))


def test_assembly_interval_helpers_direct() -> None:
    from studyflow.scheduling import assembly

    # _merge_intervals with empty, inverted, overlapping intervals
    intervals = [(10, 5), (1, 5), (4, 8), (12, 15)]
    merged = assembly._merge_intervals(intervals)
    assert merged == [(1, 8), (12, 15)]

    # _subtract with before, after, exact start match, partial overlap
    available = [(10, 20), (30, 40)]
    blocked = [
        (5, 8),  # completely before (10, 20)
        (10, 12),  # exact start match: branches 72->74
        (15, 18),  # splits remaining (12, 20) into (12, 15) and (18, 20)
        (35, 45),  # overlaps end of (30, 40) -> leaves (30, 35)
        (50, 60),  # completely after
    ]

    subtracted = assembly._subtract(available, blocked)
    assert subtracted == [(12, 15), (18, 20), (30, 35)]


def test_assembly_rejects_too_many_windows(monkeypatch: pytest.MonkeyPatch) -> None:
    from studyflow.scheduling import assembly

    planning_start = datetime(2026, 1, 5, 8, 0, tzinfo=UTC)
    deadline = planning_start + timedelta(days=2)
    task = _task(TASK_A_ID, deadline, 60)
    window = AvailabilityWindowDraft(0, time(9), time(12))

    monkeypatch.setattr(assembly, "MAX_ASSEMBLED_WINDOWS", 0)
    # 1. Rejection from base calendar windows
    with pytest.raises(SchedulingInputTooLargeError, match="availability windows"):
        assemble_schedule_problem(
            [task],
            [window],
            [],
            _preferences(),
            planning_start=planning_start,
        )

    # 2. Rejection from scenario availability when base windows is 0
    temp_window = ScenarioAvailabilityWindow(
        starts_at=datetime(2026, 1, 5, 9, 0, tzinfo=UTC),
        ends_at=datetime(2026, 1, 5, 10, 0, tzinfo=UTC),
    )
    with pytest.raises(SchedulingInputTooLargeError, match="availability windows"):
        assemble_schedule_problem(
            [task],
            [],
            [],
            _preferences(),
            planning_start=planning_start,
            temporary_availability=[temp_window],
        )
