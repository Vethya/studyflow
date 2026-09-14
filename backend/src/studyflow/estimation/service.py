"""Evidence-gated adaptive estimate previews and prediction capture."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from studyflow.estimation.model import (
    CorrectionPrediction,
    median_correction,
    qualifies,
)
from studyflow.estimation.repositories import AdaptivePredictionRepository
from studyflow.tasks.service import TaskCategory

PlannedSource = Literal["original", "adaptive"]
HistoryScope = Literal["overall", "category"]
LARGE_FACTOR_LOWER_BOUND = Decimal("0.5")
LARGE_FACTOR_UPPER_BOUND = Decimal("2.0")
ACKNOWLEDGMENT_REPROMPT_THRESHOLD = Decimal("0.25")


class AdaptiveEstimateUnavailableError(ValueError):
    """Raised when a caller selects Adaptive without an available estimate."""


class AdaptivePredictionCaptureError(RuntimeError):
    """Raised when a chronological prediction cannot be persisted for a task."""


@dataclass(frozen=True, slots=True)
class AdaptiveEstimatePreview:
    """Student-safe adaptive estimate details for one task category and original estimate."""

    category: TaskCategory
    original_minutes: int
    adaptive_minutes: int | None
    correction_factor: Decimal | None
    history_scope: HistoryScope | None
    history_count: int | None
    available: bool
    planned_source: PlannedSource
    acknowledgment_required: bool


@dataclass(frozen=True, slots=True)
class AdaptiveEligibilityStatus:
    """The current adaptive eligibility and history sample state for an account."""

    is_qualified: bool
    completed_predictions_count: int
    eligible_history_count: int


class AdaptiveEstimator:
    """Calculates, gates, captures, and acknowledges correction predictions."""

    def __init__(
        self,
        repository: AdaptivePredictionRepository,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._repository = repository
        self._clock = clock

    async def preview(
        self, account_id: UUID, category: TaskCategory, original_minutes: int
    ) -> AdaptiveEstimatePreview:
        """Return a non-persisting, student-safe view of the current estimate."""
        preview, _ = await self._evaluate(account_id, category, original_minutes, self._repository)
        return preview

    async def capture_for_task(
        self,
        account_id: UUID,
        task_id: UUID,
        category: TaskCategory,
        original_minutes: int,
        *,
        planned_source: PlannedSource | None = None,
        repository: AdaptivePredictionRepository | None = None,
        replace: bool = False,
    ) -> AdaptiveEstimatePreview:
        """Persist one pre-task prediction and return the allowed planned source."""
        prediction_repository = repository or self._repository
        preview, prediction = await self._evaluate(
            account_id, category, original_minutes, prediction_repository
        )
        selected_source = planned_source or preview.planned_source
        if selected_source == "adaptive" and (
            not preview.available or preview.acknowledgment_required
        ):
            raise AdaptiveEstimateUnavailableError

        if prediction is None:
            if replace and not await prediction_repository.remove_prediction(account_id, task_id):
                raise AdaptivePredictionCaptureError
            return self._with_planned_source(preview, selected_source)
        save = (
            prediction_repository.replace_prediction
            if replace
            else prediction_repository.save_prediction
        )
        if not await save(account_id, task_id, prediction, exposed=preview.available):
            raise AdaptivePredictionCaptureError
        return self._with_planned_source(preview, selected_source)

    async def acknowledge(self, account_id: UUID, category: TaskCategory) -> bool:
        """Acknowledge the currently calculated qualified correction for a category."""
        history = await self._repository.history(account_id)
        prediction = median_correction(history, category, 1)
        if prediction is None or not qualifies(await self._repository.evaluations(account_id)):
            raise AdaptiveEstimateUnavailableError
        return await self._repository.acknowledge(
            account_id,
            category,
            prediction.correction_factor,
            self._clock(),
        )

    async def is_qualified(self, account_id: UUID) -> bool:
        """Return whether the account currently qualifies for adaptive estimates."""
        return qualifies(await self._repository.evaluations(account_id))

    async def recalculate_after_deletion(
        self,
        account_id: UUID,
        *,
        repository: AdaptivePredictionRepository | None = None,
    ) -> AdaptiveEligibilityStatus:
        """Recalculate adaptive qualification and reconcile acknowledgments after task deletion."""
        repo = repository or self._repository
        evaluations = await repo.evaluations(account_id)
        history = await repo.history(account_id)
        is_qualified = qualifies(evaluations)
        for category in TaskCategory:
            acknowledged_factor = await repo.acknowledgment(account_id, category)
            if acknowledged_factor is None:
                continue
            prediction = median_correction(history, category, 1)
            if prediction is None:
                continue
            factor = prediction.correction_factor
            if (
                LARGE_FACTOR_LOWER_BOUND <= factor <= LARGE_FACTOR_UPPER_BOUND
                or self._acknowledgment_required(factor, acknowledged_factor)
            ):
                await repo.remove_acknowledgment(account_id, category)

        completed_predictions = [
            e
            for e in evaluations
            if e.completed_at is not None and e.actual_minutes is not None and e.actual_minutes > 0
        ]
        return AdaptiveEligibilityStatus(
            is_qualified=is_qualified,
            completed_predictions_count=len(completed_predictions),
            eligible_history_count=len(history),
        )

    async def _evaluate(
        self,
        account_id: UUID,
        category: TaskCategory,
        original_minutes: int,
        repository: AdaptivePredictionRepository,
    ) -> tuple[AdaptiveEstimatePreview, CorrectionPrediction | None]:
        history = await repository.history(account_id)
        prediction = median_correction(history, category, original_minutes)
        if prediction is None or not qualifies(await repository.evaluations(account_id)):
            return self._unavailable_preview(category, original_minutes), prediction

        acknowledged_factor = await repository.acknowledgment(account_id, category)
        acknowledgment_required = self._acknowledgment_required(
            prediction.correction_factor, acknowledged_factor
        )
        return (
            AdaptiveEstimatePreview(
                category=category,
                original_minutes=original_minutes,
                adaptive_minutes=prediction.predicted_minutes,
                correction_factor=prediction.correction_factor,
                history_scope=prediction.history_scope,
                history_count=prediction.history_count,
                available=True,
                planned_source=("original" if acknowledgment_required else "adaptive"),
                acknowledgment_required=acknowledgment_required,
            ),
            prediction,
        )

    @staticmethod
    def _unavailable_preview(
        category: TaskCategory, original_minutes: int
    ) -> AdaptiveEstimatePreview:
        return AdaptiveEstimatePreview(
            category=category,
            original_minutes=original_minutes,
            adaptive_minutes=None,
            correction_factor=None,
            history_scope=None,
            history_count=None,
            available=False,
            planned_source="original",
            acknowledgment_required=False,
        )

    @staticmethod
    def _with_planned_source(
        preview: AdaptiveEstimatePreview, planned_source: PlannedSource
    ) -> AdaptiveEstimatePreview:
        return AdaptiveEstimatePreview(
            category=preview.category,
            original_minutes=preview.original_minutes,
            adaptive_minutes=preview.adaptive_minutes,
            correction_factor=preview.correction_factor,
            history_scope=preview.history_scope,
            history_count=preview.history_count,
            available=preview.available,
            planned_source=planned_source,
            acknowledgment_required=preview.acknowledgment_required,
        )

    @staticmethod
    def _acknowledgment_required(
        correction_factor: Decimal, acknowledged_factor: Decimal | None
    ) -> bool:
        if LARGE_FACTOR_LOWER_BOUND <= correction_factor <= LARGE_FACTOR_UPPER_BOUND:
            return False
        if acknowledged_factor is None:
            return True
        return (
            abs(correction_factor - acknowledged_factor) / acknowledged_factor
            >= ACKNOWLEDGMENT_REPROMPT_THRESHOLD
        )
