from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from cognee.modules.users.models import User
from cognee.modules.users.methods import get_authenticated_user

from src.modules.projects.service import (
    list_projects,
    get_project,
    get_project_by_opencode_id,
    create_project,
    update_project,
    delete_project,
)


# ── Schemas ────────────────────────────────────────────────────────────────────


class ProjectOut(BaseModel):
    id: UUID
    name: str
    type: str
    remote_url: Optional[str]
    local_path: Optional[str]
    opencode_project_id: Optional[str]
    dataset_id: UUID
    owner_id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CreateProjectIn(BaseModel):
    name: str
    type: str = "general"
    remote_url: Optional[str] = None
    local_path: Optional[str] = None
    opencode_project_id: Optional[str] = None
    vault_api_key: Optional[str] = None


class UpdateProjectIn(BaseModel):
    name: Optional[str] = None
    remote_url: Optional[str] = None
    local_path: Optional[str] = None
    opencode_project_id: Optional[str] = None


# ── Router factory ─────────────────────────────────────────────────────────────


def get_projects_router() -> APIRouter:
    router = APIRouter()

    @router.get("", response_model=list[ProjectOut])
    async def list_user_projects(
        opencode_project_id: Optional[str] = Query(default=None),
        user: User = Depends(get_authenticated_user),
    ) -> list[ProjectOut]:
        """List all projects for the authenticated user, optionally filtered by opencode_project_id."""
        if opencode_project_id is not None:
            project = await get_project_by_opencode_id(opencode_project_id, user.id)
            return [ProjectOut.model_validate(project)] if project else []
        projects = await list_projects(user.id)
        return [ProjectOut.model_validate(p) for p in projects]

    @router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
    async def create_user_project(
        body: CreateProjectIn,
        user: User = Depends(get_authenticated_user),
    ) -> ProjectOut:
        """Create a new project and provision its dedicated cognee Dataset."""
        project = await create_project(
            name=body.name,
            type_=body.type,
            user=user,
            remote_url=body.remote_url,
            local_path=body.local_path,
            opencode_project_id=body.opencode_project_id,
            vault_api_key=body.vault_api_key,
        )
        return ProjectOut.model_validate(project)

    @router.patch("/{project_id}", response_model=ProjectOut)
    async def patch_project(
        project_id: UUID,
        body: UpdateProjectIn,
        user: User = Depends(get_authenticated_user),
    ) -> ProjectOut:
        """Update mutable project fields (name, remote_url, local_path, opencode_project_id)."""
        project = await update_project(
            project_id=project_id,
            owner_id=user.id,
            name=body.name,
            remote_url=body.remote_url,
            local_path=body.local_path,
            opencode_project_id=body.opencode_project_id,
        )
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        return ProjectOut.model_validate(project)

    @router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_user_project(
        project_id: UUID,
        user: User = Depends(get_authenticated_user),
    ) -> None:
        """Delete a project, cascading to its Dataset and graph rules."""
        deleted = await delete_project(project_id=project_id, owner_id=user.id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Project not found")

    return router
