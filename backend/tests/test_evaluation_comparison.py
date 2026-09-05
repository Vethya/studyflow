"""Tests for static-vs-adaptive technical comparison tooling (§24.6)."""

from datetime import UTC, datetime
from uuid import uuid4

from studyflow.evaluation.comparison import (
    PredictionEvaluation,
    check_hard_constraint_violations,
    compare_static_vs_adaptive,
    compute_estimation_metrics,
    compute_schedule_stability,
)
from studyflow.scheduling.contracts import (
    FeasibilityProblem,
    KernelStatus,
    MinuteWindow,
    ScheduledSession,
    SessionDemand,
    TaskPriority,
)


def test_compute_schedule_stability_metrics() -> None:
    prev_sessions = (
        ScheduledSession("s1", "t1", start_minute=0, end_minute=60),
        ScheduledSession("s2", "t1", start_minute=70, end_minute=130),
        ScheduledSession("s3", "t2", start_minute=140, end_minute=200),
    )
    # s1 unchanged, s2 moved by 10 min, s3 removed, s4 added
    new_sessions = (
        ScheduledSession("s1", "t1", start_minute=0, end_minute=60),
        ScheduledSession("s2", "t1", start_minute=80, end_minute=140),
        ScheduledSession("s4", "t3", start_minute=210, end_minute=270),
    )

    metrics = compute_schedule_stability(
        previous_sessions=prev_sessions,
        new_sessions=new_sessions,
        minutes_left_unscheduled=45,
    )

    assert metrics.sessions_moved == 1
    assert metrics.total_absolute_minutes_shifted == 10
    assert metrics.sessions_added == 1
    assert metrics.sessions_removed == 1
    assert metrics.minutes_left_unscheduled == 45


def test_compute_estimation_metrics_calculates_mae_and_signed_bias() -> None:
    now = datetime.now(UTC)
    evaluations = [
        PredictionEvaluation(
            task_id=uuid4(),
            original_minutes=100,
            adaptive_minutes=120,
            actual_minutes=130,
            completed_at=now,
        ),
        PredictionEvaluation(
            task_id=uuid4(),
            original_minutes=60,
            adaptive_minutes=80,
            actual_minutes=80,
            completed_at=now,
        ),
        PredictionEvaluation(
            task_id=uuid4(),
            original_minutes=200,
            adaptive_minutes=180,
            actual_minutes=170,
            completed_at=now,
        ),
    ]

    # actual: [130, 80, 170]
    # orig errors: |100-130|=30, |60-80|=20, |200-170|=30 -> sum=80, MAE=80/3 = 26.666...
    # adapt errors: |120-130|=10, |80-80|=0, |180-170|=10 -> sum=20, MAE=20/3 = 6.666...
    # orig signed errors: 100-130=-30, 60-80=-20, 200-170=+30 -> sum=-20, bias=-20/3 = -6.666...
    # adapt signed errors: 120-130=-10, 80-80=0, 180-170=+10 -> sum=0, bias=0.0

    metrics = compute_estimation_metrics(evaluations)
    assert metrics.sample_count == 3
    assert abs(metrics.original_mae - (80 / 3)) < 1e-5
    assert abs(metrics.adaptive_mae - (20 / 3)) < 1e-5
    assert abs(metrics.original_signed_bias - (-20 / 3)) < 1e-5
    assert abs(metrics.adaptive_signed_bias - 0.0) < 1e-5
    assert metrics.mae_reduction_percentage == 75.0


def test_compute_estimation_metrics_empty() -> None:
    metrics = compute_estimation_metrics([])
    assert metrics.sample_count == 0
    assert metrics.original_mae == 0.0
    assert metrics.adaptive_mae == 0.0
    assert metrics.original_signed_bias == 0.0


def test_check_hard_constraint_violations() -> None:
    problem = FeasibilityProblem(
        sessions=(
            SessionDemand(
                session_id="s1",
                task_id="t1",
                duration_minutes=60,
                deadline_minute=120,
                allowed_windows=(MinuteWindow(0, 120),),
                priority=TaskPriority.HIGH,
            ),
            SessionDemand(
                session_id="s2",
                task_id="t1",
                duration_minutes=60,
                deadline_minute=200,
                allowed_windows=(MinuteWindow(0, 200),),
                priority=TaskPriority.HIGH,
            ),
        ),
        planning_start_minute=0,
        minimum_break_minutes=10,
    )

    # Valid non-overlapping with 10 min break
    valid_sessions = (
        ScheduledSession("s1", "t1", start_minute=0, end_minute=60),
        ScheduledSession("s2", "t1", start_minute=70, end_minute=130),
    )
    assert check_hard_constraint_violations(valid_sessions, problem) == 0

    # Overlapping sessions
    invalid_sessions = (
        ScheduledSession("s1", "t1", start_minute=0, end_minute=60),
        ScheduledSession("s2", "t1", start_minute=65, end_minute=125),  # only 5 min break
    )
    assert check_hard_constraint_violations(invalid_sessions, problem) == 1


def test_compare_static_vs_adaptive_end_to_end() -> None:
    problem = FeasibilityProblem(
        sessions=(
            SessionDemand(
                session_id="s1",
                task_id="t1",
                duration_minutes=60,
                deadline_minute=300,
                allowed_windows=(MinuteWindow(0, 300),),
                priority=TaskPriority.MEDIUM,
            ),
        ),
        planning_start_minute=0,
        minimum_break_minutes=10,
    )
    adapted_problem = FeasibilityProblem(
        sessions=(
            SessionDemand(
                session_id="s1",
                task_id="t1",
                duration_minutes=90,
                deadline_minute=300,
                allowed_windows=(MinuteWindow(0, 300),),
                priority=TaskPriority.MEDIUM,
            ),
        ),
        planning_start_minute=0,
        minimum_break_minutes=10,
    )

    result = compare_static_vs_adaptive(problem, adapted_problem)
    assert result.static_run.status is KernelStatus.FEASIBLE
    assert result.adaptive_run.status is KernelStatus.FEASIBLE
    assert result.static_run.hard_constraint_violations == 0
    assert result.adaptive_run.hard_constraint_violations == 0
