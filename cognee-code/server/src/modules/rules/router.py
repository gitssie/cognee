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


_DEFAULT_NODESET = "coding_agent_rules"


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
        return await get_rules_with_ids(
            project_id=project_id,
            owner_id=user.id,
        )

    @router.post("", response_model=dict)
    async def add_rule(
        rule_input: RuleInput,
        user: User = Depends(get_authenticated_user),
    ):
        """Add a rule directly to the knowledge graph (no LLM processing).
        Pass project_id in the body to scope rules to a project."""
        if rule_input.project_id:
            project = await get_project(rule_input.project_id, user.id)
            if project is None:
                return {"message": "Project not found"}
            from cognee.context_global_variables import set_database_global_context_variables

            await set_database_global_context_variables(project.dataset_id, user.id)

        result = await add_rule_direct(text=rule_input.text)
        return result

    @router.post("/save", response_model=dict)
    async def save_rules(
        rule_input: RuleSaveInput,
        user: User = Depends(get_authenticated_user),
    ):
        """Save a list of explicit coding rules directly to the knowledge graph.
        No LLM processing — rules are stored as-is.
        Pass project_id to scope rules to a project."""
        if rule_input.project_id:
            project = await get_project(rule_input.project_id, user.id)
            if project is None:
                return {"message": "Project not found"}
            from cognee.context_global_variables import set_database_global_context_variables

            await set_database_global_context_variables(project.dataset_id, user.id)

        for text in rule_input.rules:
            if text.strip():
                await add_rule_direct(text=text.strip())
        return {"message": f"Saved {len(rule_input.rules)} rules"}

    @router.post("/extract", response_model=dict)
    async def extract_rules(
        rule_input: RuleExtractInput,
        user: User = Depends(get_authenticated_user),
    ):
        """Extract coding rules from text using LLM and save them to the knowledge graph.
        Pass project_id to scope extracted rules to a project; omit for global rules."""
        if rule_input.project_id:
            project = await get_project(rule_input.project_id, user.id)
            if project is None:
                return {"message": "Project not found"}
            from cognee.context_global_variables import set_database_global_context_variables

            await set_database_global_context_variables(project.dataset_id, user.id)

        await extract_and_save_rules(text=rule_input.text)
        return {"message": "Rules extracted and saved"}

    @router.delete("/{rule_id}", response_model=dict)
    async def remove_rule(
        rule_id: str,
        project_id: Optional[UUID] = Query(default=None),
        user: User = Depends(get_authenticated_user),
    ):
        """Delete a rule by its ID."""
        if project_id:
            project = await get_project(project_id, user.id)
            if project:
                from cognee.context_global_variables import set_database_global_context_variables

                await set_database_global_context_variables(project.dataset_id, user.id)

        await delete_rule_by_id(rule_id)
        return {"message": "Rule deleted"}

    return router
