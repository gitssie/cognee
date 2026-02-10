from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import List

from cognee.modules.users.models import User
from cognee.modules.users.methods import get_authenticated_user
from cognee.tasks.codingagents.coding_rule_associations import (
    get_existing_rules,
    add_rule_associations,
)


class RuleInput(BaseModel):
    text: str
    nodeset: str = "coding_agent_rules"


def get_rules_router() -> APIRouter:
    router = APIRouter()

    @router.get("", response_model=List[str])
    async def list_rules(
        nodeset: str = "coding_agent_rules", user: User = Depends(get_authenticated_user)
    ):
        """
        List all rules from a specific nodeset.
        """
        return await get_existing_rules(rules_nodeset_name=nodeset)

    @router.post("", response_model=dict)
    async def add_rule(rule_input: RuleInput, user: User = Depends(get_authenticated_user)):
        """
        Add a rule (extracted from text) to the knowledge graph.
        """
        await add_rule_associations(data=rule_input.text, rules_nodeset_name=rule_input.nodeset)
        return {"message": "Rule extraction processing"}

    return router
