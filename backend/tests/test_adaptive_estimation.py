from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from studyflow.estimation import (
    HistoryRecord,
    PredictionEvaluation,
    median_correction,
    qualifies,
)
from studyflow.tasks.service import TaskCategory

NOW = datetime(2026, 9, 3, 12, tzinfo=UTC)


def _history(
    ratios: list[Decimal],
    *,
    category: TaskCategory = TaskCategory.OTHER,
    starts_at: datetime = NOW,
) -> list[HistoryRecord]:
    return [
        HistoryRecord(
            task_id=UUID(int=index + 1),
            category=category,
            original_minutes=100,
            actual_minutes=int(ratio * 100),
            completed_at=starts_at + timedelta(minutes=index),
        )
        for index, ratio in enumerate(ratios)
    ]


def _evaluation(
    index: int,
    *,
    original_minutes: int = 100,
    adaptive_minutes: int = 90,
    actual_minutes: int | None = 100,
    completed_at: datetime | None = NOW,
) -> PredictionEvaluation:
    return PredictionEvaluation(
        task_id=UUID(int=index + 1),
        original_minutes=original_minutes,
        adaptive_minutes=adaptive_minutes,
        actual_minutes=actual_minutes,
        completed_at=completed_at + timedelta(minutes=index) if completed_at is not None else None,
    )


def test_median_correction_requires_five_history_records() -> None:
    prediction = median_correction(
        _history([Decimal("1"), Decimal("1"), Decimal("1.5"), Decimal("2")]),
        TaskCategory.OTHER,
        60,
    )

    assert prediction is None


def test_median_correction_uses_latest_twenty_eligible_records() -> None:
    history = _history([Decimal("10")] * 5 + [Decimal("1")] * 20)

    prediction = median_correction(history, TaskCategory.OTHER, 60)

    assert prediction is not None
    assert prediction.correction_factor == Decimal("1")
    assert prediction.history_count == 20


def test_median_correction_uses_category_history_after_five_records() -> None:
    history = _history([Decimal("4")] * 5)
    history.extend(_history([Decimal("1.5")] * 5, category=TaskCategory.READING))

    prediction = median_correction(history, TaskCategory.READING, 60)

    assert prediction is not None
    assert prediction.correction_factor == Decimal("1.5")
    assert prediction.history_scope == "category"
    assert prediction.history_count == 5


def test_median_correction_falls_back_to_overall_history_when_category_is_sparse() -> None:
    history = _history([Decimal("1"), Decimal("1"), Decimal("1.5"), Decimal("2"), Decimal("4")])
    history.extend(_history([Decimal("10")] * 4, category=TaskCategory.READING))

    prediction = median_correction(history, TaskCategory.READING, 60)

    assert prediction is not None
    assert prediction.correction_factor == Decimal("4")
    assert prediction.history_scope == "overall"
    assert prediction.history_count == 9


def test_median_correction_uses_odd_and_even_medians() -> None:
    odd = median_correction(
        _history([Decimal("1"), Decimal("1"), Decimal("1.5"), Decimal("2"), Decimal("4")]),
        TaskCategory.OTHER,
        60,
    )
    even = median_correction(
        _history(
            [Decimal("1"), Decimal("1"), Decimal("1.5"), Decimal("2"), Decimal("4"), Decimal("4")]
        ),
        TaskCategory.OTHER,
        60,
    )

    assert odd is not None and odd.correction_factor == Decimal("1.5")
    assert even is not None and even.correction_factor == Decimal("1.75")


def test_median_correction_rounds_predicted_minutes_half_up() -> None:
    prediction = median_correction(_history([Decimal("1.5")] * 5), TaskCategory.OTHER, 61)

    assert prediction is not None
    assert prediction.predicted_minutes == 92


def test_median_correction_preserves_exact_half_up_rounding_for_repeating_ratios() -> None:
    history = [
        HistoryRecord(
            task_id=UUID(int=index + 1),
            category=TaskCategory.OTHER,
            original_minutes=28,
            actual_minutes=1,
            completed_at=NOW + timedelta(minutes=index),
        )
        for index in range(5)
    ]

    prediction = median_correction(history, TaskCategory.OTHER, 14)

    assert prediction is not None
    assert prediction.predicted_minutes == 1


def test_median_correction_keeps_uncapped_factors() -> None:
    prediction = median_correction(_history([Decimal("4")] * 5), TaskCategory.OTHER, 60)

    assert prediction is not None
    assert prediction.correction_factor == Decimal("4")
    assert prediction.predicted_minutes == 240


def test_median_correction_orders_completion_ties_by_task_id() -> None:
    history = [
        HistoryRecord(UUID(int=1), TaskCategory.OTHER, 100, 1_000, NOW),
        *[
            HistoryRecord(UUID(int=index), TaskCategory.OTHER, 100, 100, NOW)
            for index in range(2, 12)
        ],
        *[
            HistoryRecord(UUID(int=index), TaskCategory.OTHER, 100, 200, NOW)
            for index in range(12, 22)
        ],
    ]

    prediction = median_correction(history, TaskCategory.OTHER, 60)

    assert prediction is not None
    assert prediction.correction_factor == Decimal("1.5")
    assert prediction.history_count == 20


def test_qualification_activates_with_five_predictions_at_ten_percent_mae_improvement() -> None:
    predictions = [
        _evaluation(index, adaptive_minutes=101, actual_minutes=110) for index in range(5)
    ]

    assert qualifies(predictions)


def test_qualification_activates_at_exact_ten_percent_with_repeating_maes() -> None:
    predictions = [
        *[
            _evaluation(index, original_minutes=900, adaptive_minutes=910, actual_minutes=1_000)
            for index in range(5)
        ],
        _evaluation(5, original_minutes=880, adaptive_minutes=892, actual_minutes=1_000),
    ]

    assert qualifies(predictions)


def test_qualification_rejects_improvement_below_ten_percent() -> None:
    predictions = [
        _evaluation(index, adaptive_minutes=109, actual_minutes=200) for index in range(5)
    ]

    assert not qualifies(predictions)


def test_qualification_rejects_zero_original_mae() -> None:
    predictions = [
        _evaluation(index, adaptive_minutes=90, actual_minutes=100) for index in range(5)
    ]

    assert not qualifies(predictions)


def test_qualification_ignores_incomplete_and_nonpositive_actual_predictions() -> None:
    predictions = [
        *[_evaluation(index, adaptive_minutes=101, actual_minutes=110) for index in range(4)],
        _evaluation(5, adaptive_minutes=90, actual_minutes=None, completed_at=None),
        _evaluation(6, adaptive_minutes=90, actual_minutes=0),
    ]

    assert not qualifies(predictions)


def test_qualification_uses_latest_ten_completed_predictions() -> None:
    predictions = [
        *[_evaluation(index, adaptive_minutes=200, actual_minutes=110) for index in range(5)],
        *[_evaluation(index, adaptive_minutes=101, actual_minutes=110) for index in range(5, 15)],
    ]

    assert qualifies(predictions)


def test_qualification_dequalifies_after_recent_predictions_lose_advantage() -> None:
    predictions = [
        *[_evaluation(index, adaptive_minutes=101, actual_minutes=110) for index in range(5)],
        *[_evaluation(index, adaptive_minutes=100, actual_minutes=110) for index in range(5, 15)],
    ]

    assert not qualifies(predictions)
