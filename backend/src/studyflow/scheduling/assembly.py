"""Assemble persisted study data into a normalized solver problem."""

from collections.abc import Sequence
from datetime import UTC, datetime

from studyflow.accounts.preferences import StudyPreferences
from studyflow.availability.unavailable import UnavailablePeriod, UnavailablePeriodDraft
from studyflow.availability.windows import AvailabilityWindow, AvailabilityWindowDraft
from studyflow.scheduling.calendar import expand_calendar
from studyflow.scheduling.contracts import (
    FeasibilityProblem,
    MinuteWindow,
    PlanningDay,
    SessionDemand,
    TaskPriority,
)
from studyflow.scheduling.splitting import split_task_sessions
from studyflow.tasks.service import AcademicTaskRecord, TaskStatus

MAX_FAIRNESS_PLANNING_DAYS = 366
MAX_ASSEMBLED_SESSIONS = 10_000
MAX_ASSEMBLED_WINDOWS = 10_000

_UTC_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
_MICROSECONDS_PER_MINUTE = 60_000_000


class SchedulingInputError(ValueError):
    """Raised when persisted study data cannot form a bounded solver input."""


class AvailabilityTimezoneConfirmationRequiredError(SchedulingInputError):
    """Raised while recurring availability still belongs to an old timezone."""


class SchedulingInputTooLargeError(SchedulingInputError):
    """Raised before an impractically large tuple-based problem is materialized."""


def _minute_bounds(value: datetime) -> tuple[int, int]:
    if value.tzinfo is None or value.utcoffset() is None:
        raise SchedulingInputError("Scheduling instants must be timezone-aware")
    delta = value.astimezone(UTC) - _UTC_EPOCH
    microseconds = delta.days * 86_400 * 1_000_000 + delta.seconds * 1_000_000 + delta.microseconds
    floor, remainder = divmod(microseconds, _MICROSECONDS_PER_MINUTE)
    return floor, floor + bool(remainder)


def _eligible_tasks(
    tasks: Sequence[AcademicTaskRecord], planning_start_utc: datetime
) -> tuple[AcademicTaskRecord, ...]:
    eligible: list[AcademicTaskRecord] = []
    for task in tasks:
        if task.deadline_at.tzinfo is None or task.deadline_at.utcoffset() is None:
            raise SchedulingInputError("Task deadlines must be timezone-aware")
        if task.status is TaskStatus.COMPLETED or task.deadline_at <= planning_start_utc:
            continue
        eligible.append(task)
    return tuple(sorted(eligible, key=lambda task: (task.deadline_at, task.id)))


def assemble_schedule_problem(
    tasks: Sequence[AcademicTaskRecord],
    availability_windows: Sequence[AvailabilityWindow | AvailabilityWindowDraft],
    unavailable_periods: Sequence[UnavailablePeriod | UnavailablePeriodDraft],
    preferences: StudyPreferences,
    *,
    planning_start: datetime,
    max_solve_seconds: float = 4.0,
) -> FeasibilityProblem:
    """Build one in-memory scheduling problem from current account data."""

    if preferences.availability_confirmation_required:
        raise AvailabilityTimezoneConfirmationRequiredError(
            "Confirm recurring availability after changing timezone"
        )
    _, planning_start_minute = _minute_bounds(planning_start)
    planning_start_utc = planning_start.astimezone(UTC)
    eligible_tasks = _eligible_tasks(tasks, planning_start_utc)
    if not eligible_tasks:
        return FeasibilityProblem(
            (),
            planning_start_minute=planning_start_minute,
            minimum_break_minutes=preferences.minimum_break_minutes,
            max_solve_seconds=max_solve_seconds,
        )

    horizon_end = max(task.deadline_at.astimezone(UTC) for task in eligible_tasks)
    splits = tuple(
        split_task_sessions(
            str(task.id),
            task.planned_duration_minutes,
            preferences.preferred_session_length_minutes,
        )
        for task in eligible_tasks
    )
    session_count = sum(split.session_count for split in splits)
    if session_count > MAX_ASSEMBLED_SESSIONS:
        raise SchedulingInputTooLargeError(
            f"Schedule cannot exceed {MAX_ASSEMBLED_SESSIONS} sessions"
        )

    horizon_end_minute, _ = _minute_bounds(horizon_end)
    if horizon_end_minute <= planning_start_minute:
        concrete_windows: tuple[MinuteWindow, ...] = ()
        planning_days: tuple[PlanningDay, ...] = ()
    else:
        calendar = expand_calendar(
            availability_windows,
            unavailable_periods,
            timezone_name=preferences.timezone,
            planning_start=planning_start_utc,
            horizon_end=horizon_end,
        )
        if calendar.windows.window_count > MAX_ASSEMBLED_WINDOWS:
            raise SchedulingInputTooLargeError(
                f"Schedule cannot exceed {MAX_ASSEMBLED_WINDOWS} availability windows"
            )

        concrete_windows = calendar.windows.materialize()
        planning_days = (
            calendar.planning_days.materialize()
            if calendar.planning_days.day_count <= MAX_FAIRNESS_PLANNING_DAYS
            else ()
        )
    sessions: list[SessionDemand] = []
    for task, split in zip(eligible_tasks, splits, strict=True):
        deadline_minute, _ = _minute_bounds(task.deadline_at)
        priority = TaskPriority(task.priority.value)
        sessions.extend(
            SessionDemand(
                session_id=draft.session_id,
                task_id=draft.task_id,
                duration_minutes=draft.duration_minutes,
                deadline_minute=deadline_minute,
                allowed_windows=concrete_windows,
                priority=priority,
            )
            for draft in split
        )

    return FeasibilityProblem(
        tuple(sessions),
        planning_start_minute=planning_start_minute,
        minimum_break_minutes=preferences.minimum_break_minutes,
        max_solve_seconds=max_solve_seconds,
        planning_days=planning_days,
    )
