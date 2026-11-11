from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from fractions import Fraction
from uuid import UUID

import pytest

from studyflow.estimation import (
    AdaptiveEstimateUnavailableError,
    AdaptiveEstimator,
    AdaptivePredictionCaptureError,
    AdaptivePredictionRepository,
    CorrectionPrediction,
    EstimateBasis,
    HistoryRecord,
    PredictionEvaluation,
    adaptive_correction,
    category_correction_factor,
    estimation_accuracy,
    qualifies,
    size_bucket,
)
from studyflow.estimation.model import MAX_PREDICTED_MINUTES, _weighted_quantile
from studyflow.tasks.service import TaskCategory

NOW = datetime(2026, 9, 3, 12, tzinfo=UTC)


def _history(
    ratios: list[Decimal],
    *,
    category: TaskCategory = TaskCategory.OTHER,
    original_minutes: int = 100,
    start: int = 0,
    provisional: bool = False,
) -> list[HistoryRecord]:
    return [
        HistoryRecord(
            task_id=UUID(int=start + index + 1),
            category=category,
            original_minutes=original_minutes,
            actual_minutes=int(ratio * original_minutes),
            completed_at=NOW + timedelta(minutes=start + index),
            provisional=provisional,
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


def _qualifying_evaluations() -> list[PredictionEvaluation]:
    return [_evaluation(index, adaptive_minutes=101, actual_minutes=110) for index in range(5)]


def test_correction_requires_two_completed_records() -> None:
    assert adaptive_correction(_history([Decimal("1.5")]), TaskCategory.OTHER, 60) is None
    assert (
        adaptive_correction(
            _history([Decimal("1.5")]) + _history([Decimal("2")] * 3, start=1, provisional=True),
            TaskCategory.OTHER,
            60,
        )
        is None
    )

    prediction = adaptive_correction(_history([Decimal("1.5")] * 2), TaskCategory.OTHER, 60)

    assert prediction is not None
    assert prediction.correction_factor == Decimal("1.317784")
    assert prediction.predicted_minutes == 79
    assert prediction.history_count == 2


def test_correction_shrinks_toward_neutral_and_converges_with_more_history() -> None:
    sparse = adaptive_correction(_history([Decimal("1.5")] * 5), TaskCategory.OTHER, 60)
    rich = adaptive_correction(_history([Decimal("1.5")] * 20), TaskCategory.OTHER, 60)

    # Each of the overall, size, and category levels keeps 5 / (n + 5) of its parent,
    # so uniform 1.5 ratios give 1 + 0.5 * (1 - (5 / (n + 5)) ** 3).
    assert sparse is not None and sparse.correction_factor == Decimal("1.4375")
    assert sparse.predicted_minutes == 86
    assert rich is not None and rich.correction_factor == Decimal("1.496")
    assert rich.predicted_minutes == 90


def test_correction_clamps_record_ratios_and_caps_the_prediction() -> None:
    history = _history([Decimal("10")] * 20)

    prediction = adaptive_correction(history, TaskCategory.OTHER, 60)

    assert prediction is not None
    assert prediction.correction_factor == Decimal("3")
    assert prediction.predicted_minutes == 180
    assert prediction.low_minutes == 180
    assert prediction.high_minutes == 180


def test_correction_floors_the_prediction_at_a_third_and_one_minute() -> None:
    history = [
        HistoryRecord(UUID(int=index + 1), TaskCategory.OTHER, 1_000, 1, NOW + timedelta(index))
        for index in range(20)
    ]

    sixty = adaptive_correction(history, TaskCategory.OTHER, 60)
    one = adaptive_correction(history, TaskCategory.OTHER, 1)

    assert sixty is not None and sixty.correction_factor == Decimal("0.333333")
    assert sixty.predicted_minutes == 20
    assert one is not None and one.predicted_minutes == 1


def test_correction_clamps_overflow_to_the_integer_limit() -> None:
    prediction = adaptive_correction(
        _history([Decimal("4")] * 20), TaskCategory.OTHER, 1_000_000_000
    )

    assert prediction is not None
    assert prediction.predicted_minutes == MAX_PREDICTED_MINUTES


def test_correction_rounds_predicted_minutes_half_up() -> None:
    prediction = adaptive_correction(_history([Decimal("1.5")] * 5), TaskCategory.OTHER, 72)

    # 72 * 23 / 16 = 103.5
    assert prediction is not None
    assert prediction.predicted_minutes == 104


def test_correction_weights_recent_records_more_heavily() -> None:
    history = _history([Decimal("2")] * 12) + _history([Decimal("1")] * 8, start=20)

    prediction = adaptive_correction(history, TaskCategory.OTHER, 60)

    # Unweighted, the twelve older 2.0 ratios would be the median.
    assert prediction is not None
    assert prediction.correction_factor == Decimal("1")
    assert prediction.predicted_minutes == 60
    assert prediction.high_minutes == 120


def test_correction_reads_only_the_newest_fifty_records() -> None:
    history = _history([Decimal("4")] * 10) + _history([Decimal("1")] * 50, start=10)

    prediction = adaptive_correction(history, TaskCategory.OTHER, 60)

    assert prediction is not None
    assert prediction.history_count == 50
    assert prediction.correction_factor == Decimal("1")


def test_correction_blends_category_over_overall_history() -> None:
    history = _history([Decimal("1.5")] * 5) + _history(
        [Decimal("2")] * 5, category=TaskCategory.READING, start=10
    )

    prediction = adaptive_correction(history, TaskCategory.READING, 100)

    assert prediction == CorrectionPrediction(
        predicted_minutes=194,
        correction_factor=Decimal("1.944444"),
        history_scope="category",
        history_count=10,
        low_minutes=172,
        high_minutes=194,
        basis=EstimateBasis(
            dominant_scope="category",
            size_bucket="medium",
            completed_records=10,
            provisional_records=0,
            category_records=5,
            size_records=10,
        ),
    )


def test_correction_uses_size_buckets_when_category_has_no_history() -> None:
    history = _history(
        [Decimal("2")] * 5, category=TaskCategory.READING, original_minutes=30
    ) + _history([Decimal("1")] * 5, category=TaskCategory.READING, original_minutes=300, start=10)

    small = adaptive_correction(history, TaskCategory.OTHER, 30)
    large = adaptive_correction(history, TaskCategory.OTHER, 300)

    assert small is not None and large is not None
    assert small.correction_factor == Decimal("1.5")
    assert large.correction_factor == Decimal("1")
    assert small.basis is not None and small.basis.dominant_scope == "size"
    assert small.basis.size_bucket == "small"
    assert small.history_scope == "overall"
    assert large.basis is not None and large.basis.size_bucket == "large"


def test_correction_reports_overall_basis_without_category_or_size_history() -> None:
    prediction = adaptive_correction(_history([Decimal("1.5")] * 10), TaskCategory.READING, 30)

    assert prediction is not None
    assert prediction.history_scope == "overall"
    assert prediction.basis == EstimateBasis(
        dominant_scope="overall",
        size_bucket="small",
        completed_records=10,
        provisional_records=0,
        category_records=0,
        size_records=0,
    )


def test_size_buckets_use_original_minute_boundaries() -> None:
    assert [size_bucket(minutes) for minutes in (1, 59, 60, 240, 241)] == [
        "small",
        "small",
        "medium",
        "medium",
        "large",
    ]


def test_provisional_records_count_at_half_weight() -> None:
    completed = _history([Decimal("1")] * 2)
    with_provisional = adaptive_correction(
        completed + _history([Decimal("3")], start=5, provisional=True),
        TaskCategory.OTHER,
        100,
    )
    with_completed = adaptive_correction(
        completed + _history([Decimal("3")], start=5), TaskCategory.OTHER, 100
    )

    assert with_provisional is not None and with_completed is not None
    assert with_provisional.basis is not None
    assert with_provisional.basis.provisional_records == 1
    assert with_provisional.basis.completed_records == 2
    assert with_provisional.high_minutes == 100
    assert with_completed.high_minutes == 251


def test_correction_range_brackets_the_point_estimate() -> None:
    history = _history([Decimal("1"), Decimal("1"), Decimal("1.5"), Decimal("2"), Decimal("4")])

    prediction = adaptive_correction(history, TaskCategory.OTHER, 100)

    assert prediction is not None
    assert (prediction.low_minutes, prediction.predicted_minutes, prediction.high_minutes) == (
        100,
        144,
        188,
    )


def test_correction_orders_completion_ties_by_task_id() -> None:
    history = [
        HistoryRecord(UUID(int=index), TaskCategory.OTHER, 100, 100 + 10 * (index % 3), NOW)
        for index in range(1, 12)
    ]

    forward = adaptive_correction(history, TaskCategory.OTHER, 60)
    backward = adaptive_correction(list(reversed(history)), TaskCategory.OTHER, 60)

    assert forward is not None
    assert forward == backward


def test_category_factor_ignores_task_size() -> None:
    history = _history([Decimal("1.2")] * 5, category=TaskCategory.READING) + _history(
        [Decimal("3")] * 5, category=TaskCategory.ASSIGNMENT, start=10
    )

    assert category_correction_factor(history, TaskCategory.READING) == Decimal("1.766667")
    assert category_correction_factor(history, TaskCategory.ASSIGNMENT) == Decimal("2.666667")
    assert category_correction_factor(history, TaskCategory.OTHER) == Decimal("2.333333")
    assert category_correction_factor(history[:1], TaskCategory.OTHER) is None


def test_weighted_quantile_averages_neighbours_on_an_exact_weight_boundary() -> None:
    points = [(Fraction(1), Fraction(1)), (Fraction(2), Fraction(1)), (Fraction(4), Fraction(2))]

    assert _weighted_quantile(points, Fraction(1, 4)) == Fraction(3, 2)
    assert _weighted_quantile(points, Fraction(1, 2)) == Fraction(3)
    assert _weighted_quantile(points, Fraction(3, 4)) == Fraction(4)
    assert _weighted_quantile(points[:1], Fraction(1, 2)) == Fraction(1)


def test_qualification_activates_with_five_predictions_at_ten_percent_improvement() -> None:
    assert qualifies(_qualifying_evaluations())


def test_qualification_weights_recent_predictions_more_heavily() -> None:
    predictions = [
        *[_evaluation(index, adaptive_minutes=129, actual_minutes=110) for index in range(5)],
        *[_evaluation(index, adaptive_minutes=110, actual_minutes=110) for index in range(5, 10)],
    ]

    # Unweighted, adaptive error 95 would exceed 90 percent of the original error 100.
    assert qualifies(predictions)
    assert not qualifies(
        [
            *[_evaluation(index, adaptive_minutes=110, actual_minutes=110) for index in range(5)],
            *[
                _evaluation(index, adaptive_minutes=129, actual_minutes=110)
                for index in range(5, 10)
            ],
        ]
    )


def test_qualification_rejects_improvement_below_ten_percent() -> None:
    predictions = [
        _evaluation(index, adaptive_minutes=109, actual_minutes=200) for index in range(5)
    ]

    assert not qualifies(predictions)


def test_qualification_rejects_zero_original_error() -> None:
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


def test_estimation_accuracy_compares_original_and_adaptive_error() -> None:
    predictions = [
        _evaluation(0, original_minutes=100, adaptive_minutes=120, actual_minutes=130),
        _evaluation(1, original_minutes=60, adaptive_minutes=80, actual_minutes=80),
        _evaluation(2, original_minutes=200, adaptive_minutes=180, actual_minutes=170),
        _evaluation(3, actual_minutes=None, completed_at=None),
    ]

    accuracy = estimation_accuracy(predictions)

    assert accuracy is not None
    assert accuracy.sample_size == 3
    assert accuracy.original_mean_absolute_error_minutes == Decimal("26.7")
    assert accuracy.adaptive_mean_absolute_error_minutes == Decimal("6.7")
    assert accuracy.improvement_percent == Decimal("75.0")
    assert accuracy.adaptive_qualified is False


def test_estimation_accuracy_needs_three_samples_and_reports_worse_or_undefined_change() -> None:
    assert estimation_accuracy(_qualifying_evaluations()[:2]) is None

    worse = estimation_accuracy(
        [_evaluation(index, adaptive_minutes=130, actual_minutes=110) for index in range(3)]
    )
    exact = estimation_accuracy(
        [_evaluation(index, adaptive_minutes=90, actual_minutes=100) for index in range(3)]
    )
    qualified = estimation_accuracy(_qualifying_evaluations())

    assert worse is not None and worse.improvement_percent == Decimal("-100.0")
    assert exact is not None and exact.improvement_percent is None
    assert qualified is not None and qualified.adaptive_qualified is True
    assert qualified.improvement_percent == Decimal("10.0")


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
async def test_capture_records_shadow_predictions_before_qualification() -> None:
    repository = InMemoryAdaptivePredictionRepository(
        history_records=_history([Decimal("1.5")] * 5)
    )
    estimator = AdaptiveEstimator(repository, clock=lambda: NOW)
    account_id, task_id = UUID(int=100), UUID(int=101)

    preview = await estimator.preview(account_id, TaskCategory.OTHER, 60)
    captured = await estimator.capture_for_task(account_id, task_id, TaskCategory.OTHER, 60)

    assert preview.available is False
    assert preview.adaptive_minutes is None
    assert preview.low_minutes is None and preview.basis is None
    assert repository.saved_predictions == [
        (
            task_id,
            CorrectionPrediction(
                86,
                Decimal("1.4375"),
                "category",
                5,
                low_minutes=86,
                high_minutes=86,
                basis=EstimateBasis("category", "medium", 5, 0, 5, 5),
            ),
            False,
        )
    ]
    assert captured.adaptive_minutes is None
    assert captured.planned_source == "original"


@pytest.mark.anyio
async def test_preview_exposes_qualified_category_estimate_and_defaults_to_adaptive() -> None:
    repository = InMemoryAdaptivePredictionRepository(
        history_records=_history([Decimal("1.5")] * 5, category=TaskCategory.READING),
        prediction_evaluations=_qualifying_evaluations(),
    )
    estimator = AdaptiveEstimator(repository, clock=lambda: NOW)

    preview = await estimator.preview(UUID(int=100), TaskCategory.READING, 60)

    assert preview.available is True
    assert preview.adaptive_minutes == 86
    assert preview.low_minutes == 86
    assert preview.high_minutes == 86
    assert preview.correction_factor == Decimal("1.4375")
    assert preview.history_scope == "category"
    assert preview.history_count == 5
    assert preview.basis == EstimateBasis("category", "medium", 5, 0, 5, 5)
    assert preview.acknowledgment_required is False
    assert preview.planned_source == "adaptive"


@pytest.mark.anyio
async def test_preview_exposes_qualified_overall_estimate_without_category_or_size_history() -> (
    None
):
    repository = InMemoryAdaptivePredictionRepository(
        history_records=_history([Decimal("1.5")] * 10),
        prediction_evaluations=_qualifying_evaluations(),
    )
    estimator = AdaptiveEstimator(repository, clock=lambda: NOW)

    preview = await estimator.preview(UUID(int=100), TaskCategory.READING, 30)

    assert preview.available is True
    assert preview.history_scope == "overall"
    assert preview.history_count == 10
    assert preview.basis is not None and preview.basis.dominant_scope == "overall"


@pytest.mark.anyio
async def test_capture_honors_original_override_for_a_qualified_estimate() -> None:
    repository = InMemoryAdaptivePredictionRepository(
        history_records=_history([Decimal("1.5")] * 5),
        prediction_evaluations=_qualifying_evaluations(),
    )
    estimator = AdaptiveEstimator(repository, clock=lambda: NOW)

    captured = await estimator.capture_for_task(
        UUID(int=100),
        UUID(int=101),
        TaskCategory.OTHER,
        60,
        planned_source="original",
    )

    assert captured.adaptive_minutes == 86
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
        prediction_evaluations=_qualifying_evaluations(),
    )
    estimator = AdaptiveEstimator(repository, clock=lambda: NOW)
    account_id = UUID(int=100)

    before = await estimator.preview(account_id, TaskCategory.OTHER, 60)
    assert before.acknowledgment_required is True
    assert before.planned_source == "original"

    assert await estimator.acknowledge(account_id, TaskCategory.OTHER)
    after = await estimator.preview(account_id, TaskCategory.OTHER, 60)
    other_size = await estimator.preview(account_id, TaskCategory.OTHER, 30)

    # The acknowledgment stores the size-independent category factor.
    assert repository.acknowledgments[TaskCategory.OTHER] == Decimal("2.125")
    assert after.acknowledgment_required is False
    assert after.planned_source == "adaptive"
    assert other_size.acknowledgment_required is False


@pytest.mark.anyio
async def test_large_factor_reprompts_after_a_twenty_five_percent_relative_change() -> None:
    repository = InMemoryAdaptivePredictionRepository(
        prediction_evaluations=_qualifying_evaluations(),
        acknowledgments={TaskCategory.OTHER: Decimal("2")},
    )
    estimator = AdaptiveEstimator(repository, clock=lambda: NOW)
    account_id = UUID(int=100)

    repository.history_records = _history([Decimal("2.98")] * 5)
    below_threshold = await estimator.preview(account_id, TaskCategory.OTHER, 60)
    repository.history_records = _history([Decimal("3")] * 5)
    at_threshold = await estimator.preview(account_id, TaskCategory.OTHER, 60)

    assert below_threshold.acknowledgment_required is False
    assert at_threshold.acknowledgment_required is True


@pytest.mark.anyio
async def test_recalculate_preserves_acknowledgments_across_dequalification() -> None:
    # One completed record cannot produce a factor, so reconciliation is deferred and the
    # acknowledgments survive the temporary dequalification.
    repository = InMemoryAdaptivePredictionRepository(
        history_records=[
            *_history([Decimal("4.0")]),
            *_history([Decimal("1.0")] * 2, start=5, provisional=True),
        ],
        prediction_evaluations=_qualifying_evaluations()[:4],
        acknowledgments={
            TaskCategory.OTHER: Decimal("2.125"),
            TaskCategory.READING: Decimal("2.125"),
        },
    )
    estimator = AdaptiveEstimator(repository, clock=lambda: NOW)
    account_id = UUID(int=100)

    status = await estimator.recalculate_after_deletion(account_id)

    assert status.is_qualified is False
    assert status.completed_predictions_count == 4
    assert status.eligible_history_count == 1
    assert repository.acknowledgments == {
        TaskCategory.OTHER: Decimal("2.125"),
        TaskCategory.READING: Decimal("2.125"),
    }

    repository.history_records = _history([Decimal("2.5")] * 5)
    repository.prediction_evaluations = _qualifying_evaluations()
    preview = await estimator.preview(account_id, TaskCategory.OTHER, 60)
    assert preview.available is True
    assert preview.acknowledgment_required is False
    assert preview.planned_source == "adaptive"


@pytest.mark.anyio
async def test_recalculate_after_deletion_reconciles_drifted_or_bounded_acknowledgments() -> None:
    repository = InMemoryAdaptivePredictionRepository(
        history_records=_history([Decimal("1.2")] * 5, category=TaskCategory.READING)
        + _history([Decimal("3.0")] * 5, category=TaskCategory.ASSIGNMENT, start=10),
        prediction_evaluations=_qualifying_evaluations(),
        acknowledgments={
            # READING is now 1.766667 (within normal bounds 0.5..2.0) -> removed
            TaskCategory.READING: Decimal("2.5"),
            # ASSIGNMENT is now 2.666667 (drifted >= 25% from 2.0) -> removed
            TaskCategory.ASSIGNMENT: Decimal("2.0"),
            # PROJECT has no category history; overall 2.333333 drifted >= 25% from 3.2
            TaskCategory.PROJECT: Decimal("3.2"),
            # OTHER has no category history; overall 2.333333 drifted < 25% from 2.3 -> kept
            TaskCategory.OTHER: Decimal("2.3"),
        },
    )
    estimator = AdaptiveEstimator(repository, clock=lambda: NOW)
    account_id = UUID(int=100)

    status = await estimator.recalculate_after_deletion(account_id)

    assert status.is_qualified is True
    assert status.eligible_history_count == 10
    assert repository.acknowledgments == {TaskCategory.OTHER: Decimal("2.3")}


@pytest.mark.anyio
async def test_accuracy_summarises_the_repository_evaluations() -> None:
    repository = InMemoryAdaptivePredictionRepository(
        prediction_evaluations=_qualifying_evaluations()
    )
    estimator = AdaptiveEstimator(repository, clock=lambda: NOW)

    accuracy = await estimator.accuracy(UUID(int=100))
    empty = await AdaptiveEstimator(InMemoryAdaptivePredictionRepository()).accuracy(UUID(int=1))

    assert accuracy is not None
    assert accuracy.sample_size == 5
    assert accuracy.original_mean_absolute_error_minutes == Decimal("10.0")
    assert accuracy.adaptive_mean_absolute_error_minutes == Decimal("9.0")
    assert accuracy.adaptive_qualified is True
    assert empty is None


@pytest.mark.anyio
async def test_adaptive_estimation_service_edge_cases() -> None:
    # acknowledge() when history is empty raises AdaptiveEstimateUnavailableError
    empty_repo = InMemoryAdaptivePredictionRepository()
    estimator = AdaptiveEstimator(empty_repo, clock=lambda: NOW)
    account_id = UUID(int=1)
    with pytest.raises(AdaptiveEstimateUnavailableError):
        await estimator.acknowledge(account_id, TaskCategory.READING)

    # capture_for_task when prediction is None, replace=True, remove_prediction returns False
    class FailingRemoveRepo(InMemoryAdaptivePredictionRepository):
        async def remove_prediction(self, acc_id: UUID, t_id: UUID) -> bool:
            return False

    failing_remove = FailingRemoveRepo()
    estimator_remove = AdaptiveEstimator(failing_remove, clock=lambda: NOW)
    with pytest.raises(AdaptivePredictionCaptureError):
        await estimator_remove.capture_for_task(
            account_id,
            UUID(int=2),
            TaskCategory.READING,
            60,
            replace=True,
        )

    # capture_for_task when prediction is not None and save returns False
    class FailingSaveRepo(InMemoryAdaptivePredictionRepository):
        async def save_prediction(
            self, acc_id: UUID, t_id: UUID, prediction: CorrectionPrediction, *, exposed: bool
        ) -> bool:
            return False

    failing_save = FailingSaveRepo(
        history_records=_history([Decimal("1.25")] * 5),
        prediction_evaluations=[
            _evaluation(i, adaptive_minutes=95, actual_minutes=95) for i in range(5)
        ],
    )
    estimator_save = AdaptiveEstimator(failing_save, clock=lambda: NOW)
    with pytest.raises(AdaptivePredictionCaptureError):
        await estimator_save.capture_for_task(
            account_id,
            UUID(int=3),
            TaskCategory.READING,
            60,
            replace=False,
        )

    assert await estimator_save.is_qualified(account_id) is True
    assert await estimator.is_qualified(account_id) is False

    # capture_for_task when prediction is None and not replace
    preview_none = await estimator.capture_for_task(
        account_id,
        UUID(int=4),
        TaskCategory.READING,
        60,
        replace=False,
    )
    assert preview_none is not None and preview_none.planned_source == "original"
