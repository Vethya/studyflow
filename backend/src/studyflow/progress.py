"""Effort Progress calculation."""

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from studyflow.scheduling.outcomes import SessionOutcomeKind, StudySessionDetails
from studyflow.tasks.service import AcademicTaskRecord, TaskStatus


@dataclass(frozen=True, slots=True)
class EffortProgressRecord:
    task_id: UUID
    task_title: str
    actual_duration_minutes: int
    estimated_remaining_minutes: int
    effort_percent: int
    sessions_completed: int
    sessions_upcoming: int
    status: TaskStatus


def calculate_effort_progress(
    tasks: Sequence[AcademicTaskRecord],
    sessions: Sequence[StudySessionDetails],
    schedule_adjustments: Mapping[UUID, int],
    *,
    now: datetime,
) -> list[EffortProgressRecord]:
    """Calculate the current effort progress for each task.

    ``schedule_adjustments`` includes recorded outcomes for accepted and
    invalidated sessions. This keeps remaining work correct when a future
    session is invalidated during overdue or availability reconciliation.
    """

    actual_by_task: defaultdict[UUID, int] = defaultdict(int)
    completed_by_task: defaultdict[UUID, int] = defaultdict(int)
    upcoming_by_task: defaultdict[UUID, int] = defaultdict(int)

    for details in sessions:
        task_id = details.session.task_id
        outcome = details.outcome
        if outcome is None:
            if details.session.starts_at > now:
                upcoming_by_task[task_id] += 1
            continue
        if outcome.kind in (SessionOutcomeKind.COMPLETED, SessionOutcomeKind.DELAYED):
            actual_by_task[task_id] += outcome.actual_minutes
        if outcome.kind is SessionOutcomeKind.COMPLETED:
            completed_by_task[task_id] += 1

    progress: list[EffortProgressRecord] = []
    for task in tasks:
        actual = actual_by_task[task.id]
        remaining = (
            0
            if task.status is TaskStatus.COMPLETED
            else max(task.planned_duration_minutes - schedule_adjustments.get(task.id, 0), 0)
        )
        denominator = actual + remaining
        effort_percent = 0 if denominator == 0 else (actual * 100 + denominator // 2) // denominator
        progress.append(
            EffortProgressRecord(
                task_id=task.id,
                task_title=task.title,
                actual_duration_minutes=actual,
                estimated_remaining_minutes=remaining,
                effort_percent=effort_percent,
                sessions_completed=completed_by_task[task.id],
                sessions_upcoming=upcoming_by_task[task.id],
                status=task.status,
            )
        )
    return progress
