from typing import List, Optional
from uuid import UUID, NAMESPACE_OID, uuid5

from cognee.infrastructure.databases.graph import get_graph_engine
from cognee.modules.engine.models import NodeSet
from cognee.context_global_variables import set_database_global_context_variables
from cognee.tasks.codingagents.coding_rule_associations import Rule, add_rule_associations
from cognee.tasks.storage import add_data_points


_DEFAULT_NODESET = "coding_agent_rules"


async def get_rules_with_ids(
    project_id: Optional[UUID],
    owner_id: UUID,
) -> List[dict]:
    """
    Fetch rules from the graph, returning each rule as {"id": str, "text": str}.

    If project_id is given, switches the DB context to that project's dedicated
    Dataset before querying. Otherwise queries the global (default) graph DB.
    """
    if project_id is not None:
        from src.modules.projects.service import get_project

        project = await get_project(project_id, owner_id)
        if project is not None:
            await set_database_global_context_variables(project.dataset_id, owner_id)

    graph_engine = await get_graph_engine()
    nodes_data, _ = await graph_engine.get_nodeset_subgraph(
        node_type=NodeSet, node_name=[_DEFAULT_NODESET]
    )

    return [
        {"id": str(item[1]["id"]), "text": item[1]["text"]}
        for item in nodes_data
        if isinstance(item, tuple)
        and len(item) == 2
        and isinstance(item[1], dict)
        and "id" in item[1]
        and "text" in item[1]
    ]


async def delete_rule_by_id(rule_id: str) -> None:
    """Delete a rule node from the graph by its UUID string."""
    graph_engine = await get_graph_engine()
    await graph_engine.delete_node(rule_id)


async def add_rule_direct(text: str, rules_nodeset_name: str = _DEFAULT_NODESET) -> dict:
    """Directly save a rule text to the graph without LLM processing."""
    rules_nodeset = NodeSet(
        id=uuid5(NAMESPACE_OID, name=rules_nodeset_name), name=rules_nodeset_name
    )
    rule = Rule(
        id=uuid5(NAMESPACE_OID, name=text),
        text=text,
        belongs_to_set=rules_nodeset,
    )
    await add_data_points(data_points=[rule])
    return {"id": str(rule.id), "text": rule.text}


async def extract_and_save_rules(
    text: str,
    rules_nodeset_name: str = _DEFAULT_NODESET,
) -> None:
    """Use LLM to extract coding rules from text and save them to the knowledge graph."""
    await add_rule_associations(data=text, rules_nodeset_name=rules_nodeset_name)
