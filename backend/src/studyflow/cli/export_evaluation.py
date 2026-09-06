"""Documented backend evaluation data export command per SPEC §24.3 and §24.4."""

import argparse
import asyncio
import csv
import hashlib
import json
import sys
from collections.abc import Sequence
from datetime import UTC, datetime
from io import StringIO
from typing import Any
from uuid import UUID

import anyio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from studyflow.database.models.authentication import StudentAccount
from studyflow.database.models.scheduling import (
    ProposalTaskAllocation,
    ScheduleProposal,
    StudySession,
    StudySessionOutcome,
)
from studyflow.database.models.tasks import AcademicTask
from studyflow.settings import Settings


def pseudonymize_id(entity_id: UUID, prefix: str = "P") -> str:
    """Derive a deterministic pseudonymized participant/entity code."""
    digest = hashlib.sha256(str(entity_id).encode("utf-8")).hexdigest()[:12]
    return f"{prefix}-{digest}"


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt is not None else None


async def extract_evaluation_records(
    session: AsyncSession,
    target_account_id: UUID | None = None,
) -> list[dict[str, Any]]:
    """Extract pseudonymized technical records without sensitive PII."""
    account_stmt = select(StudentAccount)
    if target_account_id is not None:
        account_stmt = account_stmt.where(StudentAccount.id == target_account_id)
    account_stmt = account_stmt.order_by(StudentAccount.created_at)

    account_rows = (await session.execute(account_stmt)).scalars().all()
    records: list[dict[str, Any]] = []

    for account in account_rows:
        participant_code = pseudonymize_id(account.id, prefix="PARTICIPANT")

        # 1. Fetch tasks
        task_stmt = (
            select(AcademicTask)
            .where(AcademicTask.account_id == account.id)
            .order_by(AcademicTask.created_at)
        )
        task_rows = (await session.execute(task_stmt)).scalars().all()

        tasks_data: list[dict[str, Any]] = []
        task_code_map: dict[UUID, str] = {}
        for t in task_rows:
            task_code = pseudonymize_id(t.id, prefix="TASK")
            task_code_map[t.id] = task_code
            tasks_data.append(
                {
                    "task_code": task_code,
                    "category": t.category,
                    "priority": t.priority,
                    "original_estimate_minutes": t.original_estimate_minutes,
                    "adaptive_estimate_minutes": t.adaptive_estimate_minutes,
                    "planned_duration_minutes": t.planned_duration_minutes,
                    "planned_source": t.planned_source,
                    "created_at": _iso(t.created_at),
                    "deadline_at": _iso(t.deadline_at),
                    "completed_at": _iso(t.completed_at),
                    "finished_early_at": _iso(t.finished_early_at),
                }
            )

        # 2. Fetch proposals & allocations
        proposal_stmt = (
            select(ScheduleProposal)
            .where(ScheduleProposal.account_id == account.id)
            .order_by(ScheduleProposal.created_at)
        )
        proposal_rows = (await session.execute(proposal_stmt)).scalars().all()

        proposals_data: list[dict[str, Any]] = []
        for p in proposal_rows:
            proposal_code = pseudonymize_id(p.id, prefix="PROP")
            alloc_stmt = select(ProposalTaskAllocation).where(
                ProposalTaskAllocation.proposal_id == p.id
            )
            alloc_rows = (await session.execute(alloc_stmt)).scalars().all()
            allocations = [
                {
                    "task_code": task_code_map.get(a.task_id, pseudonymize_id(a.task_id, "TASK")),
                    "required_minutes": a.required_minutes,
                    "scheduled_minutes": a.scheduled_minutes,
                    "unscheduled_minutes": a.unscheduled_minutes,
                    "shortfall_minutes": a.shortfall_minutes,
                }
                for a in alloc_rows
            ]
            proposals_data.append(
                {
                    "proposal_code": proposal_code,
                    "kind": p.kind,
                    "status": p.status,
                    "revision_reason": p.revision_reason,
                    "created_at": _iso(p.created_at),
                    "allocations": allocations,
                }
            )

        # 3. Fetch study sessions and outcomes
        session_stmt = (
            select(StudySession, StudySessionOutcome)
            .outerjoin(StudySessionOutcome, StudySession.id == StudySessionOutcome.session_id)
            .where(StudySession.account_id == account.id)
            .order_by(StudySession.starts_at)
        )
        session_rows = (await session.execute(session_stmt)).all()

        sessions_data: list[dict[str, Any]] = []
        for s, outcome in session_rows:
            session_code = pseudonymize_id(s.id, prefix="SESS")
            outcome_data = (
                {
                    "kind": outcome.kind,
                    "actual_minutes": outcome.actual_minutes,
                    "remaining_minutes": outcome.remaining_minutes,
                    "recorded_at": _iso(outcome.recorded_at),
                }
                if outcome
                else None
            )
            sessions_data.append(
                {
                    "session_code": session_code,
                    "task_code": task_code_map.get(s.task_id, pseudonymize_id(s.task_id, "TASK")),
                    "starts_at": _iso(s.starts_at),
                    "ends_at": _iso(s.ends_at),
                    "planned_duration_minutes": s.planned_duration_minutes,
                    "outcome": outcome_data,
                }
            )

        # 4. Compute Participant Technical Metrics
        completed_tasks = [t for t in tasks_data if t["completed_at"] is not None]
        records.append(
            {
                "participant_code": participant_code,
                "timezone": account.timezone,
                "preferred_session_length_minutes": account.preferred_session_length_minutes,
                "minimum_break_minutes": account.minimum_break_minutes,
                "created_at": _iso(account.created_at),
                "tasks_count": len(tasks_data),
                "completed_tasks_count": len(completed_tasks),
                "tasks": tasks_data,
                "proposals": proposals_data,
                "sessions": sessions_data,
            }
        )

    return records


def format_as_csv(records: Sequence[dict[str, Any]]) -> str:
    """Format evaluation tasks and outcomes into a flat tabular CSV."""
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "participant_code",
            "task_code",
            "category",
            "priority",
            "original_estimate_minutes",
            "adaptive_estimate_minutes",
            "planned_duration_minutes",
            "planned_source",
            "created_at",
            "deadline_at",
            "completed_at",
            "session_code",
            "session_starts_at",
            "session_ends_at",
            "session_planned_duration_minutes",
            "outcome_kind",
            "actual_minutes",
            "remaining_minutes",
            "outcome_recorded_at",
        ]
    )
    for record in records:
        p_code = record["participant_code"]
        sessions_by_task: dict[str, list[dict[str, Any]]] = {}
        for s in record.get("sessions", []):
            sessions_by_task.setdefault(s["task_code"], []).append(s)

        for task in record["tasks"]:
            t_code = task["task_code"]
            task_sessions = sessions_by_task.get(t_code, [])
            base_row = [
                p_code,
                t_code,
                task["category"],
                task["priority"],
                task["original_estimate_minutes"],
                task["adaptive_estimate_minutes"],
                task["planned_duration_minutes"],
                task["planned_source"],
                task["created_at"],
                task["deadline_at"],
                task["completed_at"],
            ]
            if not task_sessions:
                writer.writerow([*base_row, "", "", "", "", "", "", "", ""])
            else:
                for s in task_sessions:
                    outcome = s.get("outcome") or {}
                    writer.writerow(
                        [
                            *base_row,
                            s.get("session_code", ""),
                            s.get("starts_at", ""),
                            s.get("ends_at", ""),
                            s.get("planned_duration_minutes", ""),
                            outcome.get("kind", ""),
                            outcome.get("actual_minutes", ""),
                            outcome.get("remaining_minutes", ""),
                            outcome.get("recorded_at", ""),
                        ]
                    )
    return output.getvalue()


async def run_export(
    database_url: str,
    output_path: str | None = None,
    output_format: str = "json",
    account_id: UUID | None = None,
) -> str:
    """Execute evaluation extraction and return or write serialized output."""
    engine = create_async_engine(database_url)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    try:
        async with session_factory() as session:
            records = await extract_evaluation_records(session, target_account_id=account_id)
    finally:
        await engine.dispose()

    if output_format == "csv":
        serialized = format_as_csv(records)
    else:
        payload = {
            "exported_at": datetime.now(UTC).isoformat(),
            "participant_count": len(records),
            "participants": records,
        }
        serialized = json.dumps(payload, indent=2)

    if output_path:
        await anyio.Path(output_path).write_text(serialized, encoding="utf-8")

    return serialized


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Export pseudonymized StudyFlow evaluation datasets per SPEC §24.4"
    )
    parser.add_argument(
        "--output",
        "-o",
        type=str,
        help="Target output file path (prints to stdout if omitted)",
    )
    parser.add_argument(
        "--format",
        "-f",
        choices=["json", "csv"],
        default="json",
        help="Export format (default: json)",
    )
    parser.add_argument(
        "--database-url",
        type=str,
        help="Database URL (defaults to STUDYFLOW_DATABASE_URL from environment/settings)",
    )
    parser.add_argument(
        "--account-id",
        type=UUID,
        help="Optional specific account UUID to export",
    )

    args = parser.parse_args()
    settings = Settings()
    db_url = args.database_url or settings.database_url.get_secret_value()

    output = asyncio.run(
        run_export(
            database_url=db_url,
            output_path=args.output,
            output_format=args.format,
            account_id=args.account_id,
        )
    )

    if not args.output:
        print(output)
    else:
        print(f"Evaluation dataset exported successfully to {args.output}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
