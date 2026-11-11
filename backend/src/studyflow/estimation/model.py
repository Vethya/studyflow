"""Pure contracts and calculations for adaptive task estimates.

The adaptive estimate scales a student's original estimate by a correction ratio learned
from their own completed (and partly completed) tasks. All arithmetic is exact
(``Fraction``) until the final half-up rounding to whole minutes.

Algorithm summary:

1. Each eligible record contributes ``actual / original`` clamped to
   ``[RATIO_FLOOR, RATIO_CEILING]`` so one extreme task cannot dominate.
2. Only the newest ``HISTORY_LIMIT`` records are read. The newest record has recency weight
   1 and each older rank is multiplied by ``RECENCY_DECAY`` (14/15, a half-life of about
   ten records). Provisional records from in-progress tasks are additionally weighted by
   ``PROVISIONAL_WEIGHT``.
3. Each scope (overall, task-size bucket, category) yields recency-weighted 25th, 50th, and
   75th percentile ratios. Scopes are blended from general to specific with shrinkage
   ``(n * scope_ratio + SHRINKAGE_STRENGTH * parent) / (n + SHRINKAGE_STRENGTH)``, where
   ``n`` is the scope's evidence (completed records count 1, provisional records count
   ``PROVISIONAL_WEIGHT``). The hierarchy is neutral 1.0 -> overall -> size -> category.
4. The blended ratio is clamped to ``[PREDICTION_FLOOR_FACTOR, PREDICTION_CEILING_FACTOR]``
   and multiplied by the original estimate. Results are rounded half-up and kept within
   ``[MIN_PREDICTED_MINUTES, MAX_PREDICTED_MINUTES]``.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction
from itertools import pairwise
from typing import Literal
from uuid import UUID

from studyflow.tasks.service import TaskCategory

MIN_PREDICTED_MINUTES = 1
MAX_PREDICTED_MINUTES = 2_147_483_647

RATIO_FLOOR = Fraction(1, 4)
RATIO_CEILING = Fraction(4)
PREDICTION_FLOOR_FACTOR = Fraction(1, 3)
PREDICTION_CEILING_FACTOR = Fraction(3)
SHRINKAGE_STRENGTH = Fraction(5)
RECENCY_DECAY = Fraction(14, 15)
HISTORY_LIMIT = 50
PROVISIONAL_WEIGHT = Fraction(1, 2)
MIN_COMPLETED_RECORDS = 2
SMALL_TASK_LIMIT_MINUTES = 60
LARGE_TASK_LIMIT_MINUTES = 240

MIN_QUALIFYING_PREDICTIONS = 5
QUALIFYING_WINDOW = 10
QUALIFYING_ERROR_RATIO = Fraction(9, 10)
MIN_ACCURACY_SAMPLES = 3

FACTOR_QUANTUM = Decimal("0.000001")

HistoryScope = Literal["category", "overall"]
BasisScope = Literal["category", "size", "overall"]
SizeBucket = Literal["small", "medium", "large"]


@dataclass(frozen=True, slots=True)
class HistoryRecord:
    """One task outcome that may contribute to a correction ratio.

    Completed tasks use their confirmed actual minutes. Provisional records describe an
    in-progress task whose student reported a Delayed outcome: ``actual_minutes`` is the
    work so far plus the revised remaining work, and ``completed_at`` is the time of the
    latest Delayed outcome.
    """

    task_id: UUID
    category: TaskCategory
    original_minutes: int
    actual_minutes: int
    completed_at: datetime
    provisional: bool = False


@dataclass(frozen=True, slots=True)
class EstimateBasis:
    """Where an adaptive estimate's evidence came from."""

    dominant_scope: BasisScope
    size_bucket: SizeBucket
    completed_records: int
    provisional_records: int
    category_records: int
    size_records: int


@dataclass(frozen=True, slots=True)
class CorrectionPrediction:
    """The transparent correction calculated from task history.

    ``history_scope`` and ``history_count`` are persisted with each prediction snapshot;
    ``history_scope`` is ``category`` when category evidence dominates and ``overall``
    otherwise, because the stored column predates size buckets.
    """

    predicted_minutes: int
    correction_factor: Decimal
    history_scope: HistoryScope
    history_count: int
    low_minutes: int | None = None
    high_minutes: int | None = None
    basis: EstimateBasis | None = None


@dataclass(frozen=True, slots=True)
class PredictionEvaluation:
    """A saved prediction joined to a task's later completion outcome."""

    task_id: UUID
    original_minutes: int
    adaptive_minutes: int
    actual_minutes: int | None
    completed_at: datetime | None


@dataclass(frozen=True, slots=True)
class EstimationAccuracy:
    """Original-estimate error compared with adaptive-snapshot error on completed tasks."""

    sample_size: int
    original_mean_absolute_error_minutes: Decimal
    adaptive_mean_absolute_error_minutes: Decimal
    improvement_percent: Decimal | None
    adaptive_qualified: bool


@dataclass(frozen=True, slots=True)
class _ScopeStatistics:
    evidence: Fraction
    low: Fraction
    median: Fraction
    high: Fraction


def size_bucket(original_minutes: int) -> SizeBucket:
    """Classify a task by its original estimate: under 1 hour, 1-4 hours, or longer."""
    if original_minutes < SMALL_TASK_LIMIT_MINUTES:
        return "small"
    if original_minutes <= LARGE_TASK_LIMIT_MINUTES:
        return "medium"
    return "large"


def adaptive_correction(
    history: Sequence[HistoryRecord], category: TaskCategory, original_minutes: int
) -> CorrectionPrediction | None:
    """Predict a duration and likely range from blended, recency-weighted history."""
    window = _history_window(history)
    if window is None:
        return None
    bucket = size_bucket(original_minutes)
    overall = _statistics(window)
    size = _statistics([item for item in window if size_bucket(item[0].original_minutes) == bucket])
    category_stats = _statistics([item for item in window if item[0].category is category])

    levels = [overall, size, category_stats]
    low = _blend_hierarchy(levels, lambda stats: stats.low)
    median = _blend_hierarchy(levels, lambda stats: stats.median)
    high = _blend_hierarchy(levels, lambda stats: stats.high)
    point_ratio = _clamp_prediction_ratio(median)
    category_share = _alpha(category_stats)
    size_share = (1 - category_share) * _alpha(size)
    overall_share = (1 - category_share) * (1 - _alpha(size)) * _alpha(overall)
    dominant: BasisScope = "category"
    best = category_share
    if size_share > best:
        dominant, best = "size", size_share
    if overall_share > best:
        dominant = "overall"

    completed = sum(1 for record, _ in window if not record.provisional)
    return CorrectionPrediction(
        predicted_minutes=_minutes(original_minutes, point_ratio),
        correction_factor=_factor(point_ratio),
        history_scope="category" if dominant == "category" else "overall",
        history_count=len(window),
        low_minutes=_minutes(original_minutes, _clamp_prediction_ratio(low)),
        high_minutes=_minutes(original_minutes, _clamp_prediction_ratio(high)),
        basis=EstimateBasis(
            dominant_scope=dominant,
            size_bucket=bucket,
            completed_records=completed,
            provisional_records=len(window) - completed,
            category_records=sum(1 for record, _ in window if record.category is category),
            size_records=sum(
                1 for record, _ in window if size_bucket(record.original_minutes) == bucket
            ),
        ),
    )


def category_correction_factor(
    history: Sequence[HistoryRecord], category: TaskCategory
) -> Decimal | None:
    """Return the size-independent category factor used for large-factor acknowledgments."""
    window = _history_window(history)
    if window is None:
        return None
    category_stats = _statistics([item for item in window if item[0].category is category])
    ratio = _blend_hierarchy([_statistics(window), category_stats], lambda stats: stats.median)
    return _factor(_clamp_prediction_ratio(ratio))


def qualifies(predictions: Sequence[PredictionEvaluation]) -> bool:
    """Return whether recent adaptive snapshots beat original estimates by ten percent.

    The newest ``QUALIFYING_WINDOW`` completed snapshots are weighted with the same recency
    decay as the estimate itself, so recent accuracy matters most.
    """
    selected = _completed_newest_first(predictions)[:QUALIFYING_WINDOW]
    if len(selected) < MIN_QUALIFYING_PREDICTIONS:
        return False

    original_error = Fraction(0)
    adaptive_error = Fraction(0)
    for rank, (prediction, actual_minutes) in enumerate(selected):
        weight = RECENCY_DECAY**rank
        original_error += weight * abs(prediction.original_minutes - actual_minutes)
        adaptive_error += weight * abs(prediction.adaptive_minutes - actual_minutes)

    if original_error == 0:
        return False
    return adaptive_error <= original_error * QUALIFYING_ERROR_RATIO


def estimation_accuracy(predictions: Sequence[PredictionEvaluation]) -> EstimationAccuracy | None:
    """Summarise original vs adaptive error over every completed prediction snapshot."""
    completed = _completed_newest_first(predictions)
    if len(completed) < MIN_ACCURACY_SAMPLES:
        return None
    original_total = sum(
        abs(prediction.original_minutes - actual) for prediction, actual in completed
    )
    adaptive_total = sum(
        abs(prediction.adaptive_minutes - actual) for prediction, actual in completed
    )
    count = len(completed)
    improvement = (
        None
        if original_total == 0
        else _one_decimal(Fraction(100 * (original_total - adaptive_total), original_total))
    )
    return EstimationAccuracy(
        sample_size=count,
        original_mean_absolute_error_minutes=_one_decimal(Fraction(original_total, count)),
        adaptive_mean_absolute_error_minutes=_one_decimal(Fraction(adaptive_total, count)),
        improvement_percent=improvement,
        adaptive_qualified=qualifies(predictions),
    )


def _completed_newest_first(
    predictions: Sequence[PredictionEvaluation],
) -> list[tuple[PredictionEvaluation, int]]:
    completed = [
        (prediction, prediction.actual_minutes, prediction.completed_at)
        for prediction in predictions
        if prediction.completed_at is not None
        and prediction.actual_minutes is not None
        and prediction.actual_minutes > 0
    ]
    completed.sort(key=lambda item: (item[2], item[0].task_id), reverse=True)
    return [(prediction, actual) for prediction, actual, _ in completed]


def _history_window(
    history: Sequence[HistoryRecord],
) -> list[tuple[HistoryRecord, Fraction]] | None:
    """Return the newest eligible records with recency weights, or None when too sparse."""
    eligible = [
        record for record in history if record.actual_minutes > 0 and record.original_minutes > 0
    ]
    newest = sorted(
        eligible, key=lambda record: (record.completed_at, record.task_id), reverse=True
    )[:HISTORY_LIMIT]
    if sum(1 for record in newest if not record.provisional) < MIN_COMPLETED_RECORDS:
        return None
    return [
        (record, RECENCY_DECAY**rank * _reliability(record)) for rank, record in enumerate(newest)
    ]


def _reliability(record: HistoryRecord) -> Fraction:
    return PROVISIONAL_WEIGHT if record.provisional else Fraction(1)


def _ratio(record: HistoryRecord) -> Fraction:
    ratio = Fraction(record.actual_minutes, record.original_minutes)
    return min(max(ratio, RATIO_FLOOR), RATIO_CEILING)


def _statistics(window: Sequence[tuple[HistoryRecord, Fraction]]) -> _ScopeStatistics | None:
    if not window:
        return None
    points = sorted((_ratio(record), weight) for record, weight in window)
    return _ScopeStatistics(
        evidence=sum((_reliability(record) for record, _ in window), Fraction(0)),
        low=_weighted_quantile(points, Fraction(1, 4)),
        median=_weighted_quantile(points, Fraction(1, 2)),
        high=_weighted_quantile(points, Fraction(3, 4)),
    )


def _weighted_quantile(points: Sequence[tuple[Fraction, Fraction]], quantile: Fraction) -> Fraction:
    """Return the weighted quantile of ascending ``(ratio, weight)`` points.

    When the cumulative weight lands exactly on the target, the two neighbouring ratios are
    averaged, which reduces to the ordinary even-count median for equal weights.
    """
    target = quantile * sum((weight for _, weight in points), Fraction(0))
    cumulative = Fraction(0)
    for (ratio, weight), (next_ratio, _) in pairwise(points):
        cumulative += weight
        if cumulative == target:
            return (ratio + next_ratio) / 2
        if cumulative > target:
            return ratio
    return points[-1][0]


def _alpha(stats: _ScopeStatistics | None) -> Fraction:
    if stats is None:
        return Fraction(0)
    return stats.evidence / (stats.evidence + SHRINKAGE_STRENGTH)


def _blend_hierarchy(
    levels: Sequence[_ScopeStatistics | None],
    value: Callable[[_ScopeStatistics], Fraction],
) -> Fraction:
    """Shrink each level toward its parent, starting from the neutral ratio 1."""
    blended = Fraction(1)
    for stats in levels:
        if stats is None:
            continue
        blended = (stats.evidence * value(stats) + SHRINKAGE_STRENGTH * blended) / (
            stats.evidence + SHRINKAGE_STRENGTH
        )
    return blended


def _clamp_prediction_ratio(ratio: Fraction) -> Fraction:
    return min(max(ratio, PREDICTION_FLOOR_FACTOR), PREDICTION_CEILING_FACTOR)


def _minutes(original_minutes: int, ratio: Fraction) -> int:
    rounded = _round_half_up(Fraction(original_minutes) * ratio)
    return min(max(rounded, MIN_PREDICTED_MINUTES), MAX_PREDICTED_MINUTES)


def _factor(ratio: Fraction) -> Decimal:
    exact = Decimal(ratio.numerator) / Decimal(ratio.denominator)
    return exact.quantize(FACTOR_QUANTUM, rounding=ROUND_HALF_UP).normalize()


def _one_decimal(value: Fraction) -> Decimal:
    return Decimal(_round_half_up(value * 10)).scaleb(-1)


def _round_half_up(value: Fraction) -> int:
    """Round a rational value to a whole number with exact half-up semantics."""
    numerator = abs(value.numerator)
    denominator = value.denominator
    rounded = (2 * numerator + denominator) // (2 * denominator)
    return rounded if value >= 0 else -rounded
