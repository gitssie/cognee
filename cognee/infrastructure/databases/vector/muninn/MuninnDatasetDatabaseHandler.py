from typing import Optional, Protocol, cast
from uuid import UUID

from cognee.infrastructure.databases.dataset_database_handler.dataset_database_handler_interface import (
    DatasetDatabaseHandlerInterface,
)
from cognee.infrastructure.databases.vector import get_vectordb_config
from cognee.infrastructure.databases.vector.create_vector_engine import create_vector_engine
from cognee.modules.users.models import DatasetDatabase, User


class _MuninnDatasetEngine(Protocol):
    async def delete_vault_prefix(self, prefix: str): ...


class MuninnDatasetDatabaseHandler(DatasetDatabaseHandlerInterface):
    @classmethod
    async def create_dataset(cls, dataset_id: Optional[UUID], user: Optional[User]) -> dict:
        vector_config = get_vectordb_config()

        if vector_config.vector_db_provider != "muninn":
            raise ValueError(
                "MuninnDatasetDatabaseHandler can only be used with the Muninn vector provider."
            )

        dataset_name = f"dataset-{dataset_id}"

        return {
            "vector_database_provider": "muninn",
            "vector_database_url": vector_config.vector_db_url,
            "vector_database_key": vector_config.vector_db_key,
            "vector_database_name": dataset_name,
            "vector_database_connection_info": {},
            "vector_dataset_database_handler": "muninn",
        }

    @classmethod
    async def delete_dataset(cls, dataset_database: DatasetDatabase):
        vector_engine = create_vector_engine(
            vector_db_provider=str(dataset_database.vector_database_provider),
            vector_db_url=str(dataset_database.vector_database_url or ""),
            vector_db_key=str(dataset_database.vector_database_key or ""),
            vector_db_name=str(dataset_database.vector_database_name),
        )
        muninn_engine = cast(_MuninnDatasetEngine, vector_engine)
        await muninn_engine.delete_vault_prefix(str(dataset_database.vector_database_name))
