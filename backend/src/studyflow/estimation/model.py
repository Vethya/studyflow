"""Pure contracts and calculations for adaptive task estimates."""

from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal
from uuid import UUID

from studyflow.tasks.service import TaskCategory


@dataclass(frozen=True, slots=True)
class HistoryRecord:
    """One completed task that may contribute to a correction factor."""

    task_id: UUID
    category: TaskCategory
    original_minutes: int
    actual_minutes: int
    completed_at: datetime


@dataclass(frozen=True, slots=True)
class CorrectionPrediction:
    """The transparent correction calculated from completed-task history."""

    predicted_minutes: int
    correction_factor: Decimal
    history_scope: Literal["category", "overall"]
    history_count: int


@dataclass(frozen=True, slots=True)
class PredictionEvaluation:
    """A saved prediction joined to a task's later completion outcome."""

    task_id: UUID
    original_minutes: int
    adaptive_minutes: int
    actual_minutes: int | None
    completed_at: datetime | None


def median_correction(
    history: list[HistoryRecord], category: TaskCategory, original_minutes: int
) -> CorrectionPrediction | None:
    """Predict duration from the median of the newest applicable task ratios."""
    eligible = [
        record
        for record in history
        if record.actual_minutes > 0 and record.original_minutes > 0
    ]
    category_history = [record for record in eligible if record.category is category]
    if len(category_history) >= 5:
        applicable = category_history
        history_scope: Literal["category", "overall"] = "category"
    else:
        applicable = eligible
        history_scope = "overall"
    if len(applicable) < 5:
        return None

    latest = sorted(applicable, key=lambda record: (record.completed_at, record.task_id))[-20:]
    ratios = sorted(
        Decimal(record.actual_minutes) / Decimal(record.original_minutes) for record in latest
    )
    midpoint = len(ratios) // 2
    if len(ratios) % 2:
        correction_factor = ratios[midpoint]
    else:
        correction_factor = (ratios[midpoint - 1] + ratios[midpoint]) / Decimal(2)
    predicted_minutes = int(
        (Decimal(original_minutes) * correction_factor).quantize(
            Decimal("1"), rounding=ROUND_HALF_UP
        )
    )
    return CorrectionPrediction(
        predicted_minutes=predicted_minutes,
        correction_factor=correction_factor,
        history_scope=history_scope,
        history_count=len(latest),
    )


def qualifies(predictions: list[PredictionEvaluation]) -> bool:
    """Return whether adaptive predictions beat original estimates by at least ten percent."""
    completed = [
        prediction
        for prediction in predictions
        if prediction.completed_at is not None
        and prediction.actual_minutes is not None
        and prediction.actual_minutes > 0
    ]
    if len(completed) < 5:
        return False

    selected = sorted(
        completed,
        key=lambda prediction: (prediction.completed_at, prediction.task_id),
    )[-10:]
    original_errors: list[Decimal] = []
    adaptive_errors: list[Decimal] = []
    for prediction in selected:
        actual_minutes = prediction.actual_minutes
        if actual_minutes is None:
            continue
        original_errors.append(Decimal(abs(prediction.original_minutes - actual_minutes)))
        adaptive_errors.append(Decimal(abs(prediction.adaptive_minutes - actual_minutes)))

    original_mae = sum(original_errors, Decimal("0")) / Decimal(len(original_errors))
    if original_mae == 0:
        return False
    adaptive_mae = sum(adaptive_errors, Decimal("0")) / Decimal(len(adaptive_errors))
    return adaptive_mae <= original_mae * Decimal("0.90")
