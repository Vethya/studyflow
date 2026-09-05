from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from studyflow.progress import EffortProgressRecord, calculate_effort_progress
from studyflow.scheduling.outcomes import (
    SessionOutcomeKind,
    StudySessionDetails,
    StudySessionOutcomeRecord,
)
from studyflow.scheduling.proposals import StudySessionRecord
from studyflow.tasks.service import (
    AcademicTaskRecord,
    TaskCategory,
    TaskPriority,
    TaskStatus,
)

NOW = datetime(2026, 9, 5, 12, 0, 0, tzinfo=UTC)
ACCOUNT_ID = uuid4()


def make_task(
    *,
    task_id: UUID | None = None,
    title: str = "Algorithms Homework",
    planned_duration_minutes: int = 120,
    status: TaskStatus = TaskStatus.NOT_STARTED,
) -> AcademicTaskRecord:
    task_id = task_id or uuid4()
    return AcademicTaskRecord(
        id=task_id,
        account_id=ACCOUNT_ID,
        title=title,
        category=TaskCategory.ASSIGNMENT,
        priority=TaskPriority.HIGH,
        course="CS101",
        notes=None,
        deadline_at=NOW + timedelta(days=7),
        original_estimate_minutes=planned_duration_minutes,
        planned_duration_minutes=planned_duration_minutes,
        created_at=NOW - timedelta(days=1),
        updated_at=NOW - timedelta(days=1),
        status=status,
    )


def make_session(
    task_id: UUID,
    *,
    starts_at: datetime,
    duration_minutes: int = 60,
    outcome: StudySessionOutcomeRecord | None = None,
) -> StudySessionDetails:
    session_id = uuid4()
    return StudySessionDetails(
        session=StudySessionRecord(
            id=session_id,
            account_id=ACCOUNT_ID,
            task_id=task_id,
            proposal_id=None,
            starts_at=starts_at,
            ends_at=starts_at + timedelta(minutes=duration_minutes),
            planned_duration_minutes=duration_minutes,
        ),
        outcome=outcome,
    )


def test_calculate_effort_progress_no_sessions() -> None:
    task = make_task(planned_duration_minutes=90)
    progress = calculate_effort_progress([task], [], {}, now=NOW)

    assert progress == [
        EffortProgressRecord(
            task_id=task.id,
            task_title=task.title,
            actual_duration_minutes=0,
            estimated_remaining_minutes=90,
            effort_percent=0,
            sessions_completed=0,
            sessions_upcoming=0,
            status=TaskStatus.NOT_STARTED,
        )
    ]


def test_calculate_effort_progress_with_completed_and_delayed_sessions() -> None:
    task = make_task(planned_duration_minutes=120)
    completed_outcome = StudySessionOutcomeRecord(
        session_id=uuid4(),
        kind=SessionOutcomeKind.COMPLETED,
        actual_minutes=45,
        remaining_minutes=75,
        recorded_at=NOW - timedelta(hours=3),
        rescheduled_at=None,
    )
    delayed_outcome = StudySessionOutcomeRecord(
        session_id=uuid4(),
        kind=SessionOutcomeKind.DELAYED,
        actual_minutes=30,
        remaining_minutes=45,
        recorded_at=NOW - timedelta(hours=1),
        rescheduled_at=None,
    )
    missed_outcome = StudySessionOutcomeRecord(
        session_id=uuid4(),
        kind=SessionOutcomeKind.MISSED,
        actual_minutes=0,
        remaining_minutes=120,
        recorded_at=NOW - timedelta(hours=5),
        rescheduled_at=None,
    )

    sessions = [
        make_session(task.id, starts_at=NOW - timedelta(hours=4), outcome=completed_outcome),
        make_session(task.id, starts_at=NOW - timedelta(hours=2), outcome=delayed_outcome),
        make_session(task.id, starts_at=NOW - timedelta(hours=6), outcome=missed_outcome),
    ]

    # schedule_adjustments accounts for 75 minutes of work recorded
    schedule_adjustments = {task.id: 75}
    progress = calculate_effort_progress([task], sessions, schedule_adjustments, now=NOW)

    assert len(progress) == 1
    record = progress[0]
    # actual = 45 + 30 = 75
    assert record.actual_duration_minutes == 75
    # remaining = 120 - 75 = 45
    assert record.estimated_remaining_minutes == 45
    # denominator = 75 + 45 = 120. (75 * 100 + 60) // 120 = 7560 // 120 = 63%
    assert record.effort_percent == 63
    # only COMPLETED increments completed count
    assert record.sessions_completed == 1
    assert record.sessions_upcoming == 0


def test_calculate_effort_progress_upcoming_sessions() -> None:
    task = make_task(planned_duration_minutes=60)
    future_session = make_session(task.id, starts_at=NOW + timedelta(hours=2), outcome=None)
    past_session = make_session(task.id, starts_at=NOW - timedelta(hours=1), outcome=None)

    progress = calculate_effort_progress([task], [future_session, past_session], {}, now=NOW)

    assert len(progress) == 1
    # Only the future session counts as upcoming
    assert progress[0].sessions_upcoming == 1
    assert progress[0].sessions_completed == 0
    assert progress[0].actual_duration_minutes == 0


def test_calculate_effort_progress_completed_task() -> None:
    task = make_task(
        planned_duration_minutes=100,
        status=TaskStatus.COMPLETED,
    )
    completed_outcome = StudySessionOutcomeRecord(
        session_id=uuid4(),
        kind=SessionOutcomeKind.COMPLETED,
        actual_minutes=90,
        remaining_minutes=0,
        recorded_at=NOW - timedelta(hours=1),
        rescheduled_at=None,
    )
    session = make_session(task.id, starts_at=NOW - timedelta(hours=2), outcome=completed_outcome)

    progress = calculate_effort_progress([task], [session], {}, now=NOW)

    assert len(progress) == 1
    record = progress[0]
    assert record.status is TaskStatus.COMPLETED
    assert record.estimated_remaining_minutes == 0
    # denominator = 90 + 0 = 90. (90 * 100 + 45) // 90 = 100%
    assert record.effort_percent == 100
    assert record.sessions_completed == 1


def test_calculate_effort_progress_zero_denominator() -> None:
    task = make_task(
        planned_duration_minutes=0,
        status=TaskStatus.COMPLETED,
    )
    progress = calculate_effort_progress([task], [], {}, now=NOW)

    assert len(progress) == 1
    assert progress[0].effort_percent == 0
    assert progress[0].actual_duration_minutes == 0
    assert progress[0].estimated_remaining_minutes == 0


def test_calculate_effort_progress_schedule_adjustments_exceeding_planned() -> None:
    task = make_task(planned_duration_minutes=60, status=TaskStatus.IN_PROGRESS)
    # Adjustment exceeds planned duration -> remaining clamped to 0
    schedule_adjustments = {task.id: 80}

    progress = calculate_effort_progress([task], [], schedule_adjustments, now=NOW)

    assert len(progress) == 1
    assert progress[0].estimated_remaining_minutes == 0


def test_calculate_effort_progress_rounding() -> None:
    # Test half-up integer rounding: (actual * 100 + denom // 2) // denom
    task1 = make_task(planned_duration_minutes=2)  # actual=1, remaining=2 -> 33%
    task2 = make_task(planned_duration_minutes=1)  # actual=2, remaining=1 -> 67%

    outcome1 = StudySessionOutcomeRecord(
        session_id=uuid4(),
        kind=SessionOutcomeKind.COMPLETED,
        actual_minutes=1,
        remaining_minutes=2,
        recorded_at=NOW,
        rescheduled_at=None,
    )
    outcome2 = StudySessionOutcomeRecord(
        session_id=uuid4(),
        kind=SessionOutcomeKind.COMPLETED,
        actual_minutes=2,
        remaining_minutes=1,
        recorded_at=NOW,
        rescheduled_at=None,
    )

    s1 = make_session(task1.id, starts_at=NOW - timedelta(hours=1), outcome=outcome1)
    s2 = make_session(task2.id, starts_at=NOW - timedelta(hours=1), outcome=outcome2)

    progress = calculate_effort_progress([task1, task2], [s1, s2], {}, now=NOW)
    assert progress[0].effort_percent == 33
    assert progress[1].effort_percent == 67
