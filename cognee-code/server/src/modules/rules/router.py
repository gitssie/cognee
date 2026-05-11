from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from cognee.modules.users.models import User
from cognee.modules.users.methods import get_authenticated_user
from src.modules.rules.service import (
    get_rules_with_ids,
    delete_rule_by_id,
    add_rule_direct,
    extract_and_save_rules,
)
from src.modules.projects.service import get_project
from cognee.context_global_variables import (
    set_database_global_context_variables as _set_ctx,
    global_context_variables as _gcv,
)


_DEFAULT_NODESET = "coding_agent_rules"


async def _scoped(
    project_id: Optional[UUID],
    user: User,
) -> dict:
    """Save global context before scoping to a project and return original values for restoration."""
    return {
        "orig_dataset_id": _gcv.get("dataset_id"),
        "orig_user_id": _gcv.get("user_id"),
    }


async def _unscope(original: dict) -> None:
    """Restore global context to its original values after a scoped operation."""
    if original.get("orig_dataset_id") is not None:
        _gcv["dataset_id"] = original["orig_dataset_id"]
    else:
        _gcv.pop("dataset_id", None)
    if original.get("orig_user_id") is not None:
        _gcv["user_id"] = original["orig_user_id"]
    else:
        _gcv.pop("user_id", None)


class RuleInput(BaseModel):
    text: str
    project_id: Optional[UUID] = None


class RuleExtractInput(BaseModel):
    text: str
    project_id: Optional[UUID] = None


class RuleSaveInput(BaseModel):
    rules: List[str]
    project_id: Optional[UUID] = None


def get_rules_router() -> APIRouter:
    router = APIRouter()

    @router.get("", response_model=List[dict])
    async def list_rules(
        project_id: Optional[UUID] = Query(default=None),
        user: User = Depends(get_authenticated_user),
    ):
        """List all rules.
        Pass project_id to scope rules to a project; omit for global rules."""
        original = await _scoped(project_id, user)
        try:
            return await get_rules_with_ids(
                project_id=project_id,
                owner_id=user.id,
            )
        finally:
            await _unscope(original)

    @router.post("", response_model=dict)
    async def add_rule(
        rule_input: RuleInput,
        user: User = Depends(get_authenticated_user),
    ):
        """Add a rule directly to the knowledge graph (no LLM processing).
        Pass project_id in the body to scope rules to a project."""
        original = await _scoped(rule_input.project_id, user)
        try:
            if rule_input.project_id:
                project = await get_project(rule_input.project_id, user.id)
                if project is None:
                    return {"message": "Project not found"}
                await _set_ctx(project.dataset_id, user.id)

            result = await add_rule_direct(text=rule_input.text)
            return result
        finally:
            await _unscope(original)

    @router.post("/save", response_model=dict)
    async def save_rules(
        rule_input: RuleSaveInput,
        user: User = Depends(get_authenticated_user),
    ):
        """Save a list of explicit coding rules directly to the knowledge graph.
        No LLM processing — rules are stored as-is.
        Pass project_id to scope rules to a project."""
        original = await _scoped(rule_input.project_id, user)
        try:
            if rule_input.project_id:
                project = await get_project(rule_input.project_id, user.id)
                if project is None:
                    return {"message": "Project not found"}
                await _set_ctx(project.dataset_id, user.id)

            for text in rule_input.rules:
                if text.strip():
                    await add_rule_direct(text=text.strip())
            return {"message": f"Saved {len(rule_input.rules)} rules"}
        finally:
            await _unscope(original)

    @router.post("/extract", response_model=dict)
    async def extract_rules(
        rule_input: RuleExtractInput,
        user: User = Depends(get_authenticated_user),
    ):
        """Extract coding rules from text using LLM and save them to the knowledge graph.
        Pass project_id to scope extracted rules to a project; omit for global rules."""
        original = await _scoped(rule_input.project_id, user)
        try:
            if rule_input.project_id:
                project = await get_project(rule_input.project_id, user.id)
                if project is None:
                    return {"message": "Project not found"}
                await _set_ctx(project.dataset_id, user.id)

            await extract_and_save_rules(text=rule_input.text)
            return {"message": "Rules extracted and saved"}
        finally:
            await _unscope(original)

    @router.delete("/{rule_id}", response_model=dict)
    async def remove_rule(
        rule_id: str,
        project_id: Optional[UUID] = Query(default=None),
        user: User = Depends(get_authenticated_user),
    ):
        """Delete a rule by its ID."""
        original = await _scoped(project_id, user)
        try:
            if project_id:
                project = await get_project(project_id, user.id)
                if project:
                    await _set_ctx(project.dataset_id, user.id)

            await delete_rule_by_id(rule_id)
            return {"message": "Rule deleted"}
        finally:
            await _unscope(original)

    return router
