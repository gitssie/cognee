from datetime import datetime, timezone
from typing import Optional
from uuid import UUID, uuid4

from sqlalchemy import select, update

from cognee.infrastructure.databases.relational import get_relational_engine
from cognee.modules.data.methods import delete_dataset, get_dataset, create_authorized_dataset
from cognee.modules.data.models import Dataset
from cognee.modules.users.models import User
from cognee.context_global_variables import set_database_global_context_variables
from cognee.infrastructure.databases.graph import get_graph_engine
from cognee.modules.engine.models import NodeSet

from src.modules.projects.models import Project


async def list_projects(owner_id: UUID) -> list[Project]:
    """Return all projects owned by the given user."""
    engine = get_relational_engine()
    async with engine.get_async_session() as session:
        result = await session.scalars(select(Project).where(Project.owner_id == owner_id))
        return list(result.all())


async def get_project(project_id: UUID, owner_id: UUID) -> Project | None:
    """Fetch a single project by id, enforcing owner check."""
    engine = get_relational_engine()
    async with engine.get_async_session() as session:
        result = await session.scalars(
            select(Project).where(Project.id == project_id).where(Project.owner_id == owner_id)
        )
        return result.first()


async def get_project_by_opencode_id(opencode_project_id: str, owner_id: UUID) -> Project | None:
    """Fetch a project by opencode_project_id, enforcing owner check."""
    engine = get_relational_engine()
    async with engine.get_async_session() as session:
        result = await session.scalars(
            select(Project)
            .where(Project.opencode_project_id == opencode_project_id)
            .where(Project.owner_id == owner_id)
        )
        return result.first()


async def create_project(
    name: str,
    type_: str,
    user: User,
    remote_url: Optional[str] = None,
    local_path: Optional[str] = None,
    opencode_project_id: Optional[str] = None,
) -> Project:
    """
    Create a new project. Uses cognee's create_authorized_dataset to create the dataset.
    """
    # Create Dataset via cognee API (handles id generation + permissions)
    dataset = await create_authorized_dataset(name, user)

    project_id = uuid4()
    project = Project(
        id=project_id,
        name=name,
        type=type_,
        remote_url=remote_url,
        local_path=local_path,
        opencode_project_id=opencode_project_id,
        dataset_id=dataset.id,
        owner_id=user.id,
    )

    engine = get_relational_engine()
    async with engine.get_async_session() as session:
        session.add(project)
        await session.commit()
        await session.refresh(project)

    return project


async def update_project(
    project_id: UUID,
    owner_id: UUID,
    name: Optional[str] = None,
    remote_url: Optional[str] = None,
    local_path: Optional[str] = None,
    opencode_project_id: Optional[str] = None,
) -> Project | None:
    """Patch a project's mutable fields. When name changes, sync dataset name too."""
    engine = get_relational_engine()
    async with engine.get_async_session() as session:
        # Fetch project first to get dataset_id
        result = await session.scalars(
            select(Project).where(Project.id == project_id).where(Project.owner_id == owner_id)
        )
        project = result.first()
        if project is None:
            return None

        values: dict = {"updated_at": datetime.now(timezone.utc)}
        if name is not None:
            values["name"] = name
        if remote_url is not None:
            values["remote_url"] = remote_url
        if local_path is not None:
            values["local_path"] = local_path
        if opencode_project_id is not None:
            values["opencode_project_id"] = opencode_project_id

        await session.execute(
            update(Project)
            .where(Project.id == project_id)
            .where(Project.owner_id == owner_id)
            .values(**values)
        )

        # Sync dataset name when project name changes (using actual dataset_id)
        if name is not None and project.dataset_id is not None:
            await session.execute(
                update(Dataset).where(Dataset.id == project.dataset_id).values(name=name)
            )

        await session.commit()

        result = await session.scalars(
            select(Project).where(Project.id == project_id).where(Project.owner_id == owner_id)
        )
        return result.first()


async def delete_project(project_id: UUID, owner_id: UUID) -> bool:
    """
    Delete a project, cascading to:
      1. Graph DB: delete NodeSet "coding_agent_rules" in that dataset's DB.
      2. cognee Dataset record.
      3. projects record.
    Returns True if project existed, False otherwise.
    """
    engine = get_relational_engine()
    async with engine.get_async_session() as session:
        result = await session.scalars(
            select(Project).where(Project.id == project_id).where(Project.owner_id == owner_id)
        )
        project = result.first()
        if project is None:
            return False

        dataset_id = project.dataset_id

        # 1. Switch to project's DB context and delete rules graph data
        try:
            await set_database_global_context_variables(dataset_id, owner_id)
            graph_engine = await get_graph_engine()
            nodes_data, _ = await graph_engine.get_nodeset_subgraph(
                node_type=NodeSet, node_name=["coding_agent_rules"]
            )
            for item in nodes_data:
                if isinstance(item, tuple) and len(item) == 2 and isinstance(item[1], dict):
                    node_id = item[1].get("id")
                    if node_id:
                        await graph_engine.delete_node(str(node_id))
        except Exception:
            pass  # Best-effort: don't block project deletion if graph cleanup fails

        # 2. Delete cognee Dataset
        try:
            dataset_obj = await get_dataset(owner_id, dataset_id)
            if dataset_obj is not None:
                await delete_dataset(dataset_obj)
        except Exception:
            pass  # Best-effort

        # 3. Delete project record
        await session.delete(project)
        await session.commit()

    return True
