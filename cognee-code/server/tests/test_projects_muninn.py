"""
Unit tests for the Muninn dataset/vault provisioning logic in projects/service.py.

These tests are fully offline — no real database, no running Muninn instance.
All I/O is replaced by pytest-mock patches.

Run with:
    cd cognee-code/server
    uv run pytest tests/test_projects_muninn.py -v
"""

from __future__ import annotations

import uuid
from typing import Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_user(user_id: Optional[uuid.UUID] = None):
    user = MagicMock()
    user.id = user_id or uuid.uuid4()
    return user


def _make_dataset(dataset_id: Optional[uuid.UUID] = None):
    ds = MagicMock()
    ds.id = dataset_id or uuid.uuid4()
    return ds


# ---------------------------------------------------------------------------
# Tests for _provision_muninn_dataset_database
# ---------------------------------------------------------------------------


class TestProvisionMuninnDatasetDatabase:
    """Unit tests for service._provision_muninn_dataset_database."""

    @pytest.mark.asyncio
    async def test_no_op_when_record_already_exists(self):
        """If a DatasetDatabase row already exists, the function updates its vault mapping."""
        user = _make_user()
        dataset_id = uuid.uuid4()
        existing_record = MagicMock()

        vec_config = MagicMock()
        vec_config.vector_db_provider = "muninn"
        vec_config.vector_db_url = "http://localhost:8476"

        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_session.execute = AsyncMock()
        mock_session.commit = AsyncMock()

        mock_engine = MagicMock()
        mock_engine.get_async_session = MagicMock(return_value=mock_session)

        with (
            patch(
                "src.modules.projects.service._existing_dataset_database",
                new=AsyncMock(return_value=existing_record),
            ),
            patch(
                "src.modules.projects.service.get_vectordb_config",
                return_value=vec_config,
            ),
            patch(
                "src.modules.projects.service._resolve_dataset_vault_name",
                new=AsyncMock(return_value="dataset-name"),
            ),
            patch(
                "src.modules.projects.service.get_relational_engine",
                return_value=mock_engine,
            ),
        ):
            from src.modules.projects.service import _provision_muninn_dataset_database

            await _provision_muninn_dataset_database(
                dataset_id=dataset_id,
                user=user,
                vault_api_key="mk_test_key",
            )

            mock_session.execute.assert_awaited_once()
            mock_session.commit.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_no_op_when_provider_is_not_muninn(self):
        """If the vector provider is not muninn, the function is a no-op."""
        user = _make_user()
        dataset_id = uuid.uuid4()

        vec_config = MagicMock()
        vec_config.vector_db_provider = "lancedb"

        with (
            patch(
                "src.modules.projects.service._existing_dataset_database",
                new=AsyncMock(return_value=None),
            ),
            patch(
                "src.modules.projects.service.get_vectordb_config",
                return_value=vec_config,
            ),
            patch(
                "src.modules.projects.service.get_relational_engine",
            ) as mock_engine,
        ):
            from src.modules.projects.service import _provision_muninn_dataset_database

            await _provision_muninn_dataset_database(
                dataset_id=dataset_id,
                user=user,
                vault_api_key="mk_test_key",
            )

            mock_engine.assert_not_called()

    @pytest.mark.asyncio
    async def test_creates_dataset_database_with_supplied_key(self):
        """When no record exists and provider is muninn, a DatasetDatabase row is committed."""
        user = _make_user()
        dataset_id = uuid.uuid4()
        vault_key = "mk_per_dataset_key"
        vault_name = "test"

        vec_config = MagicMock()
        vec_config.vector_db_provider = "muninn"
        vec_config.vector_db_url = "http://localhost:8476"

        graph_config_dict = {
            "graph_database_provider": "networkx",
            "graph_database_url": "",
            "graph_database_key": "",
            "graph_database_name": f"graph-{dataset_id}",
            "graph_database_connection_info": {},
            "graph_dataset_database_handler": "networkx",
        }

        # Mock session as an async context manager
        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        mock_engine = MagicMock()
        mock_engine.get_async_session = MagicMock(return_value=mock_session)

        added_records = []

        def _add(record):
            added_records.append(record)

        mock_session.add = _add
        mock_session.commit = AsyncMock()

        graph_handler_instance = MagicMock()
        graph_handler_instance.create_dataset = AsyncMock(return_value=graph_config_dict)

        graph_cfg = MagicMock()
        graph_cfg.graph_dataset_database_handler = "networkx"

        supported_handlers = {
            "networkx": {"handler_instance": graph_handler_instance},
        }

        with (
            patch(
                "src.modules.projects.service._existing_dataset_database",
                new=AsyncMock(return_value=None),
            ),
            patch(
                "src.modules.projects.service.get_vectordb_config",
                return_value=vec_config,
            ),
            patch(
                "src.modules.projects.service.get_graph_config",
                return_value=graph_cfg,
            ),
            patch(
                "src.modules.projects.service._resolve_dataset_vault_name",
                new=AsyncMock(return_value=vault_name),
            ),
            patch(
                "src.modules.projects.service.get_relational_engine",
                return_value=mock_engine,
            ),
            patch(
                "src.modules.projects.service.supported_dataset_database_handlers",
                supported_handlers,
            ),
        ):
            from src.modules.projects.service import _provision_muninn_dataset_database

            await _provision_muninn_dataset_database(
                dataset_id=dataset_id,
                user=user,
                vault_api_key=vault_key,
            )

        assert len(added_records) == 1
        record = added_records[0]
        assert record.vector_database_key == vault_key
        assert record.vector_database_provider == "muninn"
        assert record.vector_database_url == "http://localhost:8476"
        assert record.vector_database_name == vault_name
        assert record.owner_id == user.id
        assert record.dataset_id == dataset_id

    @pytest.mark.asyncio
    async def test_create_project_passes_vault_key_to_provision(self):
        """create_project() calls _provision_muninn_dataset_database when vault key is given."""
        user = _make_user()
        dataset = _make_dataset()
        project_id = uuid.uuid4()

        mock_project = MagicMock()
        mock_project.id = project_id

        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_session.add = MagicMock()
        mock_session.commit = AsyncMock()
        mock_session.refresh = AsyncMock()

        mock_engine = MagicMock()
        mock_engine.get_async_session = MagicMock(return_value=mock_session)

        provision_mock = AsyncMock()

        with (
            patch(
                "src.modules.projects.service.create_authorized_dataset",
                new=AsyncMock(return_value=dataset),
            ),
            patch(
                "src.modules.projects.service.get_relational_engine",
                return_value=mock_engine,
            ),
            patch(
                "src.modules.projects.service._provision_muninn_dataset_database",
                new=provision_mock,
            ),
            # uuid4 returns a predictable id for the Project constructor
            patch("src.modules.projects.service.uuid4", return_value=project_id),
        ):
            from src.modules.projects.service import create_project

            # mock_session.refresh populates project via side_effect
            async def _refresh(obj):
                obj.id = project_id

            mock_session.refresh.side_effect = _refresh

            await create_project(
                name="my-project",
                type_="general",
                user=user,
                vault_api_key="mk_mykey",
            )

        provision_mock.assert_awaited_once_with(
            dataset_id=dataset.id,
            user=user,
            vault_api_key="mk_mykey",
        )

    @pytest.mark.asyncio
    async def test_create_project_skips_provision_without_vault_key(self):
        """create_project() does NOT call _provision when vault_api_key is None."""
        user = _make_user()
        dataset = _make_dataset()
        project_id = uuid.uuid4()

        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_session.add = MagicMock()
        mock_session.commit = AsyncMock()
        mock_session.refresh = AsyncMock()

        mock_engine = MagicMock()
        mock_engine.get_async_session = MagicMock(return_value=mock_session)

        provision_mock = AsyncMock()

        with (
            patch(
                "src.modules.projects.service.create_authorized_dataset",
                new=AsyncMock(return_value=dataset),
            ),
            patch(
                "src.modules.projects.service.get_relational_engine",
                return_value=mock_engine,
            ),
            patch(
                "src.modules.projects.service._provision_muninn_dataset_database",
                new=provision_mock,
            ),
            patch("src.modules.projects.service.uuid4", return_value=project_id),
        ):
            from src.modules.projects.service import create_project

            async def _refresh(obj):
                obj.id = project_id

            mock_session.refresh.side_effect = _refresh

            await create_project(
                name="my-project",
                type_="general",
                user=user,
                vault_api_key=None,
            )

        provision_mock.assert_not_awaited()
