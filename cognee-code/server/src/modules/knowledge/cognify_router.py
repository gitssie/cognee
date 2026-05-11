"""
Custom cognify router.

Wraps the core cognee cognify logic and registers the pipeline_run_id → user_id
mapping in sse_event_bus so that pipeline events are forwarded to the user's
global SSE stream (/api/v1/events).

All other cognify behaviour (WebSocket subscription, request validation, etc.)
is unchanged from the core router.
"""

from __future__ import annotations

from uuid import UUID
from typing import Optional, List

from fastapi import APIRouter, Depends
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from cognee.modules.users.models import User
from cognee.modules.users.methods import get_authenticated_user
from cognee.modules.pipelines.models.PipelineRunInfo import PipelineRunInfo, PipelineRunErrored
from cognee.shared.logging_utils import get_logger

from src.modules.knowledge.sse_event_bus import register_pipeline_run

logger = get_logger("cognify_router")

router = APIRouter()


class CognifyPayload(BaseModel):
    datasets: Optional[List[str]] = Field(default=None)
    dataset_ids: Optional[List[UUID]] = Field(default=None)
    run_in_background: Optional[bool] = Field(default=False)
    custom_prompt: Optional[str] = Field(default=None)
    chunks_per_batch: Optional[int] = Field(default=None)
    ontology_key: Optional[str] = Field(default=None)


@router.post("")
async def cognify(
    payload: CognifyPayload,
    user: User = Depends(get_authenticated_user),
):
    """
    Trigger knowledge graph construction.

    Delegates entirely to the core cognee cognify function and then
    registers the resulting pipeline_run_id(s) with the SSE event bus
    so that status events are pushed to the user's global SSE stream.
    """
    if not payload.datasets and not payload.dataset_ids:
        return JSONResponse(
            status_code=400, content={"error": "No datasets or dataset_ids provided"}
        )

    from cognee.api.v1.cognify import cognify as cognee_cognify
    from cognee.api.v1.ontologies.ontologies import OntologyService
    from cognee.infrastructure.databases.vector import get_vectordb_config

    try:
        datasets = payload.dataset_ids if payload.dataset_ids else payload.datasets

        # Auto-provision Muninn vaults as public before cognify.
        # Without this, new Muninn vaults are locked by default and data writes fail.
        vector_config = get_vectordb_config()
        if vector_config.vector_db_provider == "muninn":
            from src.modules.muninn.admin import ensure_vault_public
            for ds in (datasets or []):
                ds_id = ds if isinstance(ds, UUID) else ds
                vault_name = f"dataset-{ds_id}"
                # Don't block cognify if vault provisioning fails — just log
                await ensure_vault_public(vault_name)

        config_to_use = None
        if payload.ontology_key:
            ontology_service = OntologyService()
            ontology_contents = ontology_service.get_ontology_contents(payload.ontology_key, user)
            from cognee.modules.ontology.ontology_config import Config
            from cognee.modules.ontology.rdf_xml.RDFLibOntologyResolver import (
                RDFLibOntologyResolver,
            )
            from io import StringIO

            ontology_streams = [StringIO(content) for content in ontology_contents]
            config_to_use: Config = {
                "ontology_config": {
                    "ontology_resolver": RDFLibOntologyResolver(ontology_file=ontology_streams)
                }
            }

        cognify_run = await cognee_cognify(
            datasets,
            user,
            config=config_to_use,
            run_in_background=payload.run_in_background or False,
            custom_prompt=payload.custom_prompt,
            chunks_per_batch=payload.chunks_per_batch or 5,
        )

        # Register every pipeline run with the SSE event bus so the
        # patched push_to_queue shim can route events to this user.
        _register_runs(cognify_run, user.id)

        if isinstance(cognify_run, dict):
            if any(isinstance(v, PipelineRunErrored) for v in cognify_run.values()):
                return JSONResponse(status_code=420, content=jsonable_encoder(cognify_run))
        elif isinstance(cognify_run, list):
            if any(isinstance(v, PipelineRunErrored) for v in cognify_run):
                return JSONResponse(status_code=420, content=jsonable_encoder(cognify_run))

        return cognify_run

    except Exception as error:
        logger.error(f"Cognify failed: {error}")
        return JSONResponse(status_code=409, content={"error": str(error)})


def _register_runs(cognify_run, user_id: UUID) -> None:
    """Extract pipeline_run_id(s) from the cognify result and register with SSE bus."""
    try:
        if isinstance(cognify_run, list):
            for item in cognify_run:
                if isinstance(item, PipelineRunInfo) and item.pipeline_run_id:
                    register_pipeline_run(item.pipeline_run_id, user_id)
                    logger.debug(
                        f"Registered pipeline run {item.pipeline_run_id} for user {user_id}"
                    )
        elif isinstance(cognify_run, dict):
            for item in cognify_run.values():
                if isinstance(item, PipelineRunInfo) and item.pipeline_run_id:
                    register_pipeline_run(item.pipeline_run_id, user_id)
                    logger.debug(
                        f"Registered pipeline run {item.pipeline_run_id} for user {user_id}"
                    )
    except Exception as exc:
        logger.warning(f"Failed to register pipeline runs for SSE: {exc}")
