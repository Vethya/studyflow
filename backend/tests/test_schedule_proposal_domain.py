"""Unit tests for schedule proposal domain models and invariants."""

from datetime import UTC, datetime, timedelta, timezone
from uuid import uuid4

import pytest

from studyflow.scheduling import (
    NewProposedSession,
    NewScheduleProposal,
    NewTaskAllocation,
    ProposalKind,
    ProposalStatus,
)


def test_new_proposed_session_validates_utc_and_interval() -> None:
    task_id = uuid4()
    utc_start = datetime(2026, 8, 25, 10, 0, tzinfo=UTC)
    utc_end = datetime(2026, 8, 25, 11, 0, tzinfo=UTC)
    non_utc_start = datetime(2026, 8, 25, 10, 0, tzinfo=timezone(timedelta(hours=2)))

    # Non-UTC timezone
    with pytest.raises(ValueError, match="starts_at must be an aware UTC instant"):
        NewProposedSession(task_id, non_utc_start, utc_end, 60)

    # Ends at <= starts at
    with pytest.raises(ValueError, match="ends_at must be after starts_at"):
        NewProposedSession(task_id, utc_end, utc_start, 60)

    # Non-positive duration
    with pytest.raises(ValueError, match="planned_duration_minutes must be positive"):
        NewProposedSession(task_id, utc_start, utc_end, 0)

    # Negative duration
    with pytest.raises(ValueError, match="planned_duration_minutes must not be negative"):
        NewProposedSession(task_id, utc_start, utc_end, -10)

    # Non-integer duration
    with pytest.raises(TypeError, match="planned_duration_minutes must be an integer"):
        NewProposedSession(task_id, utc_start, utc_end, "60")  # type: ignore[arg-type]

    # Non-exact minute boundaries (seconds or microseconds)
    with pytest.raises(ValueError, match="Proposed sessions must use exact minute boundaries"):
        NewProposedSession(
            task_id,
            datetime(2026, 8, 25, 10, 0, 5, tzinfo=UTC),
            utc_end,
            60,
        )
    with pytest.raises(ValueError, match="Proposed sessions must use exact minute boundaries"):
        NewProposedSession(
            task_id,
            utc_start,
            datetime(2026, 8, 25, 11, 0, 0, 100, tzinfo=UTC),
            60,
        )

    # Duration does not match interval
    with pytest.raises(ValueError, match="planned_duration_minutes must match"):
        NewProposedSession(task_id, utc_start, utc_end, 45)


def test_new_task_allocation_validates_utc_nonnegative_and_sum() -> None:
    task_id = uuid4()
    deadline = datetime(2026, 8, 26, 12, 0, tzinfo=UTC)
    non_utc_deadline = datetime(2026, 8, 26, 12, 0, tzinfo=timezone(timedelta(hours=1)))

    with pytest.raises(ValueError, match="deadline_at must be an aware UTC instant"):
        NewTaskAllocation(task_id, non_utc_deadline, 60, 60, 0, 120, 60, 0)

    with pytest.raises(TypeError, match="required_minutes must be an integer"):
        NewTaskAllocation(task_id, deadline, "60", 60, 0, 120, 60, 0)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="required_minutes must not be negative"):
        NewTaskAllocation(task_id, deadline, -10, 60, 0, 120, 60, 0)

    # Sum check: required_minutes != scheduled + unscheduled
    with pytest.raises(
        ValueError, match="required_minutes must equal scheduled plus unscheduled minutes"
    ):
        NewTaskAllocation(task_id, deadline, 60, 30, 10, 120, 60, 0)


def test_new_schedule_proposal_validates_kinds_status_fingerprint_and_reasons() -> None:
    task_id = uuid4()
    session = NewProposedSession(
        task_id,
        datetime(2026, 8, 25, 10, 0, tzinfo=UTC),
        datetime(2026, 8, 25, 11, 0, tzinfo=UTC),
        60,
    )
    allocation = NewTaskAllocation(
        task_id,
        datetime(2026, 8, 26, 12, 0, tzinfo=UTC),
        60,
        60,
        0,
        120,
        60,
        0,
    )
    valid_fingerprint = "a" * 64

    # Invalid kind type
    with pytest.raises(TypeError, match="kind must be a ProposalKind"):
        NewScheduleProposal(
            "generation",  # type: ignore[arg-type]
            None,
            ProposalStatus.FEASIBLE,
            valid_fingerprint,
            (session,),
            (allocation,),
        )

    # Invalid status type
    with pytest.raises(TypeError, match="status must be a ProposalStatus"):
        NewScheduleProposal(
            ProposalKind.GENERATION,
            None,
            "feasible",  # type: ignore[arg-type]
            valid_fingerprint,
            (session,),
            (allocation,),
        )

    # Fingerprint length != 64
    with pytest.raises(ValueError, match="input_fingerprint must contain 64 characters"):
        NewScheduleProposal(
            ProposalKind.GENERATION,
            None,
            ProposalStatus.FEASIBLE,
            "short",
            (session,),
            (allocation,),
        )

    # Generation proposal cannot have revision reason
    with pytest.raises(
        ValueError, match="Initial generation proposals cannot have a revision reason"
    ):
        NewScheduleProposal(
            ProposalKind.GENERATION,
            "Some reason",
            ProposalStatus.FEASIBLE,
            valid_fingerprint,
            (session,),
            (allocation,),
        )

    # Revision proposal requires revision reason
    with pytest.raises(ValueError, match="Revision proposals require a revision reason"):
        NewScheduleProposal(
            ProposalKind.REVISION,
            None,
            ProposalStatus.FEASIBLE,
            valid_fingerprint,
            (session,),
            (allocation,),
        )
    with pytest.raises(ValueError, match="Revision proposals require a revision reason"):
        NewScheduleProposal(
            ProposalKind.REVISION,
            "   ",
            ProposalStatus.FEASIBLE,
            valid_fingerprint,
            (session,),
            (allocation,),
        )

    # Revision reason > 500 chars
    with pytest.raises(ValueError, match="revision_reason cannot exceed 500 characters"):
        NewScheduleProposal(
            ProposalKind.REVISION,
            "x" * 501,
            ProposalStatus.FEASIBLE,
            valid_fingerprint,
            (session,),
            (allocation,),
        )

    # Duplicate task allocations
    with pytest.raises(ValueError, match="Proposal task allocations must be unique by task"):
        NewScheduleProposal(
            ProposalKind.GENERATION,
            None,
            ProposalStatus.FEASIBLE,
            valid_fingerprint,
            (session,),
            (allocation, allocation),
        )

    # Proposed session without allocation
    other_task_id = uuid4()
    orphan_session = NewProposedSession(
        other_task_id,
        datetime(2026, 8, 25, 12, 0, tzinfo=UTC),
        datetime(2026, 8, 25, 13, 0, tzinfo=UTC),
        60,
    )
    with pytest.raises(ValueError, match="Every proposed session must have a task allocation"):
        NewScheduleProposal(
            ProposalKind.GENERATION,
            None,
            ProposalStatus.FEASIBLE,
            valid_fingerprint,
            (orphan_session,),
            (allocation,),
        )

    # Allocation scheduled minutes mismatch with session minutes
    wrong_minutes_allocation = NewTaskAllocation(
        task_id,
        datetime(2026, 8, 26, 12, 0, tzinfo=UTC),
        60,
        30,
        30,
        120,
        60,
        0,
    )
    with pytest.raises(
        ValueError,
        match="Allocation scheduled_minutes must equal proposed session minutes for its task",
    ):
        NewScheduleProposal(
            ProposalKind.GENERATION,
            None,
            ProposalStatus.FEASIBLE,
            valid_fingerprint,
            (session,),
            (wrong_minutes_allocation,),
        )
