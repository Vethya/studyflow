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
    SchedulingInputTooLargeError,
    TaskPriority,
    assemble_schedule_problem,
    solve_with_overload,
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


def test_rejects_horizon_before_materializing_calendar() -> None:
    planning_start = datetime(2026, 1, 5, tzinfo=UTC)
    with pytest.raises(SchedulingInputTooLargeError, match="horizon"):
        assemble_schedule_problem(
            [_task(TASK_A_ID, planning_start + timedelta(days=367), 60)],
            [AvailabilityWindowDraft(0, time(9), time(10))],
            [],
            _preferences(),
            planning_start=planning_start,
        )


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
