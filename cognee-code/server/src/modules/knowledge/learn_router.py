from typing import Optional
from uuid import UUID

import asyncio
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from cognee.modules.users.models import User
from cognee.modules.users.methods import get_authenticated_user
from cognee.shared.logging_utils import get_logger
from src.modules.projects.service import get_project

logger = get_logger("learn_router")


class LearnInput(BaseModel):
    summary: str
    project_id: Optional[UUID] = None
    custom_prompt: Optional[str] = None


def get_learn_router() -> APIRouter:
    router = APIRouter()

    @router.post("", response_model=dict)
    async def learn_from_compaction(
        payload: LearnInput,
        user: User = Depends(get_authenticated_user),
    ):
        """
        Extract non-obvious learnings from a compaction summary and store them in the
        project's knowledge graph via add() + cognify().

        Runs asynchronously in the background so as not to block the caller.
        """
        dataset_id: Optional[UUID] = None
        if payload.project_id:
            project = await get_project(payload.project_id, user.id)
            if project is None:
                return JSONResponse(status_code=404, content={"error": "Project not found"})
            dataset_id = project.dataset_id

        from src.modules.knowledge.learn_service import learn_from_summary

        # Fire-and-forget: run in background, don't block the HTTP response
        async def _run():
            try:
                await learn_from_summary(
                    summary=payload.summary,
                    dataset_id=dataset_id,
                    user=user,
                    custom_prompt=payload.custom_prompt,
                )
                logger.info(f"Session summary learned for project {payload.project_id}")
            except Exception as exc:
                logger.error(f"Failed to learn from summary: {exc}")

        asyncio.create_task(_run())
        return {"message": "Learning extraction started in background"}

    return router
