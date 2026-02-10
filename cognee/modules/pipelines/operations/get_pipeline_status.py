from uuid import UUID
from datetime import datetime
from typing import Any, Optional, Union, cast
from pydantic import BaseModel
from sqlalchemy import select, func
from cognee.infrastructure.databases.relational import get_relational_engine
from ..models import PipelineRun, PipelineRunStatus
from sqlalchemy.orm import aliased


class PipelineStatusInfo(BaseModel):
    """Extended pipeline status info with timestamp for stale detection."""

    status: PipelineRunStatus
    created_at: datetime
    pipeline_run_id: Optional[UUID] = None

    class Config:
        use_enum_values = True


async def get_pipeline_status(
    dataset_ids: list[UUID], pipeline_name: str, include_details: bool = False
) -> dict[str, Union[PipelineRunStatus, PipelineStatusInfo, Any]]:
    """
    Get the latest pipeline status for each dataset.

    Args:
        dataset_ids: List of dataset UUIDs to check
        pipeline_name: Name of the pipeline (e.g., 'cognify_pipeline')
        include_details: If True, returns PipelineStatusInfo with timestamp;
                        if False, returns just the status enum (backward compatible)

    Returns:
        Dictionary mapping dataset_id to status or PipelineStatusInfo
    """
    db_engine = get_relational_engine()

    async with db_engine.get_async_session() as session:
        query = (
            select(
                PipelineRun,
                func.row_number()
                .over(
                    partition_by=PipelineRun.dataset_id,
                    order_by=PipelineRun.created_at.desc(),
                )
                .label("rn"),
            )
            .filter(PipelineRun.dataset_id.in_(dataset_ids))
            .filter(PipelineRun.pipeline_name == pipeline_name)
            .subquery()
        )

        aliased_pipeline_run = aliased(PipelineRun, query)

        latest_runs = select(aliased_pipeline_run).filter(query.c.rn == 1)

        runs = (await session.execute(latest_runs)).scalars().all()

        if include_details:
            # Return extended info with timestamp for stale detection
            result: dict[str, Any] = {}
            for run in runs:
                run_id_value = getattr(run, "pipeline_run_id", None)
                created_at_value = getattr(run, "created_at", None)
                status_value = getattr(run, "status", None)

                # Convert status to enum
                if status_value is not None and hasattr(status_value, "value"):
                    status_enum = PipelineRunStatus(cast(Any, status_value).value)
                elif status_value is not None:
                    status_enum = PipelineRunStatus(status_value)
                else:
                    status_enum = PipelineRunStatus.DATASET_PROCESSING_INITIATED

                # Convert created_at to datetime
                if isinstance(created_at_value, datetime):
                    created_at_dt = created_at_value
                elif created_at_value is not None:
                    created_at_dt = datetime.fromisoformat(str(created_at_value))
                else:
                    created_at_dt = datetime.now()

                # Convert pipeline_run_id to UUID
                pipeline_uuid: Optional[UUID] = None
                if run_id_value is not None:
                    pipeline_uuid = UUID(str(run_id_value))

                result[str(run.dataset_id)] = PipelineStatusInfo(
                    status=status_enum,
                    created_at=created_at_dt,
                    pipeline_run_id=pipeline_uuid,
                )
            return result
        else:
            # Backward compatible: return just status enum
            pipeline_statuses = {str(run.dataset_id): run.status for run in runs}
            return pipeline_statuses
