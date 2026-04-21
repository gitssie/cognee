from datetime import datetime, timezone
from typing import Optional
from uuid import UUID, uuid4

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from cognee.infrastructure.databases.relational import get_relational_engine
from cognee.modules.data.methods import delete_dataset, get_dataset, create_authorized_dataset
from cognee.modules.data.models import Dataset
from cognee.modules.users.models import User, DatasetDatabase
from cognee.context_global_variables import set_database_global_context_variables
from cognee.infrastructure.databases.graph import get_graph_engine
from cognee.infrastructure.databases.vector import get_vectordb_config
from cognee.infrastructure.databases.graph.config import get_graph_config
from cognee.modules.data.methods import get_unique_dataset_id
from cognee.modules.engine.models import NodeSet
from cognee.infrastructure.databases.utils.get_or_create_dataset_database import (
    _existing_dataset_database,
)
from cognee.infrastructure.databases.dataset_database_handler.supported_dataset_database_handlers import (
    supported_dataset_database_handlers,
)

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
    vault_api_key: Optional[str] = None,
) -> Project:
    """
    Create a new project. Uses cognee's create_authorized_dataset to create the dataset.

    If vault_api_key is provided (Muninn vector backend only), the DatasetDatabase row is
    created or updated immediately so this dataset writes to the vault named after the
    dataset.
    """
    # Create Dataset via cognee API (handles id generation + permissions)
    dataset = await create_authorized_dataset(name, user)
    dataset_id = UUID(str(dataset.id))

    project_id = uuid4()
    project = Project(
        id=project_id,
        name=name,
        type=type_,
        remote_url=remote_url,
        local_path=local_path,
        opencode_project_id=opencode_project_id,
        dataset_id=dataset_id,
        owner_id=user.id,
    )

    engine = get_relational_engine()
    async with engine.get_async_session() as session:
        session.add(project)
        await session.commit()
        await session.refresh(project)

    # When a per-dataset Muninn vault API key is supplied, eagerly provision the
    # DatasetDatabase record so the key is stored before the first data operation.
    if vault_api_key:
        await _provision_muninn_dataset_database(
            dataset_id=dataset_id,
            user=user,
            vault_api_key=vault_api_key,
        )

    return project


def _build_muninn_vector_config(
    *,
    base_url: str,
    vault_name: str,
    vault_api_key: str,
) -> dict:
    return {
        "vector_database_provider": "muninn",
        "vector_database_url": base_url,
        "vector_database_key": vault_api_key,
        "vector_database_name": vault_name,
        "vector_database_connection_info": {},
        "vector_dataset_database_handler": "muninn",
    }


async def _resolve_dataset_vault_name(dataset_id: UUID, user: User) -> str:
    dataset = await get_dataset(user_id=user.id, dataset_id=dataset_id)
    if dataset is None:
        raise ValueError(f"Dataset {dataset_id} not found for owner {user.id}")

    dataset_name = str(dataset.name).strip()
    if not dataset_name:
        raise ValueError(f"Dataset {dataset_id} must have a non-empty name")

    return dataset_name


async def _provision_muninn_dataset_database(
    dataset_id: UUID,
    user: User,
    vault_api_key: str,
) -> None:
    """
    Create or update the DatasetDatabase record for a Muninn-backed dataset.

    Each dataset must map to exactly one Muninn vault. The vault identifier is derived from
    the dataset name and stored in DatasetDatabase.vector_database_name. The vault-bound API
    key is stored in DatasetDatabase.vector_database_key.
    """
    existing = await _existing_dataset_database(dataset_id, user)

    vector_config = get_vectordb_config()
    if vector_config.vector_db_provider != "muninn":
        return

    base_url = vector_config.vector_db_url
    vault_name = await _resolve_dataset_vault_name(dataset_id, user)
    vector_config_dict = _build_muninn_vector_config(
        base_url=base_url,
        vault_name=vault_name,
        vault_api_key=vault_api_key.strip(),
    )

    if existing is not None:
        db_engine = get_relational_engine()
        async with db_engine.get_async_session() as session:
            await session.execute(
                update(DatasetDatabase)
                .where(DatasetDatabase.dataset_id == dataset_id)
                .where(DatasetDatabase.owner_id == user.id)
                .values(**vector_config_dict)
            )
            await session.commit()
        return

    graph_config = get_graph_config()

    # Build graph DB config using the standard handler
    graph_handler = supported_dataset_database_handlers.get(
        graph_config.graph_dataset_database_handler
    )
    if graph_handler is None:
        return
    graph_config_dict = await graph_handler["handler_instance"].create_dataset(dataset_id, user)

    db_engine = get_relational_engine()
    async with db_engine.get_async_session() as session:
        record = DatasetDatabase(
            owner_id=user.id,
            dataset_id=dataset_id,
            **graph_config_dict,
            **vector_config_dict,
        )
        try:
            session.add(record)
            await session.commit()
        except IntegrityError:
            await session.rollback()
            # Race condition: another request already created the record; safe to ignore


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
