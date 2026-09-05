from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

import pytest

from studyflow.estimation import (
    AdaptiveEstimateUnavailableError,
    AdaptiveEstimator,
    AdaptivePredictionRepository,
    CorrectionPrediction,
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


def test_median_correction_clamps_a_zero_minute_rounding_to_one() -> None:
    history = [
        HistoryRecord(
            task_id=UUID(int=index + 1),
            category=TaskCategory.OTHER,
            original_minutes=1_000,
            actual_minutes=1,
            completed_at=NOW + timedelta(minutes=index),
        )
        for index in range(5)
    ]

    prediction = median_correction(history, TaskCategory.OTHER, 1)

    assert prediction is not None
    assert prediction.correction_factor == Decimal("0.001")
    assert prediction.predicted_minutes == 1


def test_median_correction_clamps_overflow_without_capping_the_factor() -> None:
    overflow_minutes = 2_147_483_648
    history = [
        HistoryRecord(
            task_id=UUID(int=index + 1),
            category=TaskCategory.OTHER,
            original_minutes=1,
            actual_minutes=overflow_minutes,
            completed_at=NOW + timedelta(minutes=index),
        )
        for index in range(5)
    ]

    prediction = median_correction(history, TaskCategory.OTHER, 1)

    assert prediction is not None
    assert prediction.correction_factor == Decimal(overflow_minutes)
    assert prediction.predicted_minutes == 2_147_483_647


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


@dataclass
class InMemoryAdaptivePredictionRepository(AdaptivePredictionRepository):
    history_records: list[HistoryRecord] = field(default_factory=list)
    prediction_evaluations: list[PredictionEvaluation] = field(default_factory=list)
    saved_predictions: list[tuple[UUID, CorrectionPrediction, bool]] = field(default_factory=list)
    acknowledgments: dict[TaskCategory, Decimal] = field(default_factory=dict)

    async def history(self, account_id: UUID) -> list[HistoryRecord]:
        return self.history_records

    async def evaluations(self, account_id: UUID) -> list[PredictionEvaluation]:
        return self.prediction_evaluations

    async def save_prediction(
        self,
        account_id: UUID,
        task_id: UUID,
        prediction: CorrectionPrediction,
        *,
        exposed: bool,
    ) -> bool:
        self.saved_predictions.append((task_id, prediction, exposed))
        return True

    async def replace_prediction(
        self,
        account_id: UUID,
        task_id: UUID,
        prediction: CorrectionPrediction,
        *,
        exposed: bool,
    ) -> bool:
        return True

    async def remove_prediction(self, account_id: UUID, task_id: UUID) -> bool:
        return True

    async def acknowledgment(self, account_id: UUID, category: TaskCategory) -> Decimal | None:
        return self.acknowledgments.get(category)

    async def acknowledge(
        self,
        account_id: UUID,
        category: TaskCategory,
        correction_factor: Decimal,
        acknowledged_at: datetime,
    ) -> bool:
        self.acknowledgments[category] = correction_factor
        return True

    async def remove_acknowledgment(self, account_id: UUID, category: TaskCategory) -> bool:
        if category in self.acknowledgments:
            del self.acknowledgments[category]
            return True
        return False

    async def clear_acknowledgments(self, account_id: UUID) -> None:
        self.acknowledgments.clear()


@pytest.mark.anyio
async def test_capture_starts_shadow_predictions_with_the_sixth_task() -> None:
    repository = InMemoryAdaptivePredictionRepository(
        history_records=_history([Decimal("1.5")] * 5)
    )
    estimator = AdaptiveEstimator(repository, clock=lambda: NOW)
    account_id, task_id = UUID(int=100), UUID(int=101)

    preview = await estimator.preview(account_id, TaskCategory.OTHER, 60)
    captured = await estimator.capture_for_task(account_id, task_id, TaskCategory.OTHER, 60)

    assert preview.available is False
    assert preview.adaptive_minutes is None
    assert repository.saved_predictions == [
        (
            task_id,
            CorrectionPrediction(90, Decimal("1.5"), "category", 5),
            False,
        )
    ]
    assert captured.adaptive_minutes is None
    assert captured.planned_source == "original"


@pytest.mark.anyio
async def test_preview_exposes_qualified_category_estimate_and_defaults_to_adaptive() -> None:
    repository = InMemoryAdaptivePredictionRepository(
        history_records=_history([Decimal("1.5")] * 5, category=TaskCategory.READING),
        prediction_evaluations=[
            _evaluation(index, adaptive_minutes=101, actual_minutes=110) for index in range(5)
        ],
    )
    estimator = AdaptiveEstimator(repository, clock=lambda: NOW)

    preview = await estimator.preview(UUID(int=100), TaskCategory.READING, 60)

    assert preview.available is True
    assert preview.adaptive_minutes == 90
    assert preview.correction_factor == Decimal("1.5")
    assert preview.history_scope == "category"
    assert preview.history_count == 5
    assert preview.acknowledgment_required is False
    assert preview.planned_source == "adaptive"


@pytest.mark.anyio
async def test_preview_exposes_qualified_overall_estimate_when_category_history_is_sparse() -> None:
    repository = InMemoryAdaptivePredictionRepository(
        history_records=[
            *_history([Decimal("1.5")] * 5),
            *_history([Decimal("1.5")] * 4, category=TaskCategory.READING),
        ],
        prediction_evaluations=[
            _evaluation(index, adaptive_minutes=101, actual_minutes=110) for index in range(5)
        ],
    )
    estimator = AdaptiveEstimator(repository, clock=lambda: NOW)

    preview = await estimator.preview(UUID(int=100), TaskCategory.READING, 60)

    assert preview.available is True
    assert preview.history_scope == "overall"
    assert preview.history_count == 9


@pytest.mark.anyio
async def test_capture_honors_original_override_for_a_qualified_estimate() -> None:
    repository = InMemoryAdaptivePredictionRepository(
        history_records=_history([Decimal("1.5")] * 5),
        prediction_evaluations=[
            _evaluation(index, adaptive_minutes=101, actual_minutes=110) for index in range(5)
        ],
    )
    estimator = AdaptiveEstimator(repository, clock=lambda: NOW)

    captured = await estimator.capture_for_task(
        UUID(int=100),
        UUID(int=101),
        TaskCategory.OTHER,
        60,
        planned_source="original",
    )

    assert captured.adaptive_minutes == 90
    assert captured.planned_source == "original"
    assert repository.saved_predictions[0][2] is True


@pytest.mark.anyio
async def test_capture_rejects_adaptive_selection_when_an_estimate_is_unavailable() -> None:
    estimator = AdaptiveEstimator(InMemoryAdaptivePredictionRepository(), clock=lambda: NOW)

    with pytest.raises(AdaptiveEstimateUnavailableError):
        await estimator.capture_for_task(
            UUID(int=100),
            UUID(int=101),
            TaskCategory.OTHER,
            60,
            planned_source="adaptive",
        )


@pytest.mark.anyio
async def test_large_factor_requires_first_acknowledgment_then_defaults_to_adaptive() -> None:
    repository = InMemoryAdaptivePredictionRepository(
        history_records=_history([Decimal("2.5")] * 5),
        prediction_evaluations=[
            _evaluation(index, adaptive_minutes=101, actual_minutes=110) for index in range(5)
        ],
    )
    estimator = AdaptiveEstimator(repository, clock=lambda: NOW)
    account_id = UUID(int=100)

    before = await estimator.preview(account_id, TaskCategory.OTHER, 60)
    assert before.acknowledgment_required is True
    assert before.planned_source == "original"

    assert await estimator.acknowledge(account_id, TaskCategory.OTHER)
    after = await estimator.preview(account_id, TaskCategory.OTHER, 60)

    assert repository.acknowledgments[TaskCategory.OTHER] == Decimal("2.5")
    assert after.acknowledgment_required is False
    assert after.planned_source == "adaptive"


@pytest.mark.anyio
async def test_large_factor_repompts_after_a_twenty_five_percent_relative_change() -> None:
    repository = InMemoryAdaptivePredictionRepository(
        history_records=_history([Decimal("2")] * 5),
        prediction_evaluations=[
            _evaluation(index, adaptive_minutes=101, actual_minutes=110) for index in range(5)
        ],
        acknowledgments={TaskCategory.OTHER: Decimal("2")},
    )
    estimator = AdaptiveEstimator(repository, clock=lambda: NOW)
    account_id = UUID(int=100)

    repository.history_records = _history([Decimal("2.49")] * 5)
    below_threshold = await estimator.preview(account_id, TaskCategory.OTHER, 60)
    repository.history_records = _history([Decimal("2.5")] * 5)
    at_threshold = await estimator.preview(account_id, TaskCategory.OTHER, 60)

    assert below_threshold.acknowledgment_required is False
    assert at_threshold.acknowledgment_required is True


@pytest.mark.anyio
async def test_recalculate_preserves_acknowledgments_across_dequalification() -> None:
    repository = InMemoryAdaptivePredictionRepository(
        history_records=_history([Decimal("2.5")] * 4),  # Only 4 tasks -> temporarily unqualified
        prediction_evaluations=[
            _evaluation(index, adaptive_minutes=101, actual_minutes=110) for index in range(4)
        ],
        acknowledgments={
            TaskCategory.OTHER: Decimal("2.5"),  # Unchanged factor -> preserved
            TaskCategory.READING: Decimal("2.5"),  # No reading history, overall 2.5 -> preserved
        },
    )
    estimator = AdaptiveEstimator(repository, clock=lambda: NOW)
    account_id = UUID(int=100)

    status = await estimator.recalculate_after_deletion(account_id)

    assert status.is_qualified is False
    assert status.completed_predictions_count == 4
    assert status.eligible_history_count == 4
    # Unchanged factors are preserved across temporary dequalification
    assert repository.acknowledgments == {
        TaskCategory.OTHER: Decimal("2.5"),
        TaskCategory.READING: Decimal("2.5"),
    }

    # When 5th task restores qualification with the same factor, acknowledgment is still valid
    repository.history_records = _history([Decimal("2.5")] * 5)
    repository.prediction_evaluations = [
        _evaluation(index, adaptive_minutes=101, actual_minutes=110) for index in range(5)
    ]
    preview = await estimator.preview(account_id, TaskCategory.OTHER, 60)
    assert preview.available is True
    assert preview.acknowledgment_required is False
    assert preview.planned_source == "adaptive"


@pytest.mark.anyio
async def test_recalculate_after_deletion_reconciles_drifted_or_bounded_acknowledgments() -> None:
    repository = InMemoryAdaptivePredictionRepository(
        history_records=_history([Decimal("1.2")] * 5, category=TaskCategory.READING)
        + _history([Decimal("3.0")] * 5, category=TaskCategory.ASSIGNMENT),
        prediction_evaluations=[
            _evaluation(index, adaptive_minutes=101, actual_minutes=110) for index in range(5)
        ],
        acknowledgments={
            # READING is now 1.2 (within normal bounds 0.5..2.0) -> should be removed
            TaskCategory.READING: Decimal("2.5"),
            # ASSIGNMENT factor is 3.0 (drifted >= 25% from 2.0) -> should be removed
            TaskCategory.ASSIGNMENT: Decimal("2.0"),
            # PROJECT has no category history, overall 2.1 (drifted >= 25% from 3.0) -> removed
            TaskCategory.PROJECT: Decimal("3.0"),
            # OTHER has no category history, overall median is 2.1 (drifted < 25% from 2.1) -> kept
            TaskCategory.OTHER: Decimal("2.1"),
        },
    )
    estimator = AdaptiveEstimator(repository, clock=lambda: NOW)
    account_id = UUID(int=100)

    status = await estimator.recalculate_after_deletion(account_id)

    assert status.is_qualified is True
    assert repository.acknowledgments == {TaskCategory.OTHER: Decimal("2.1")}
