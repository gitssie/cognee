"""
MCP (Model Context Protocol) server for cognee-code backend.

Exposes cognee tools via Streamable HTTP transport so that the
opencode-agent (and other MCP clients) can connect at /mcp/.

All tools run in *direct* mode — they call cognee functions directly
rather than going through an HTTP API layer, because this module lives
inside the same Python process as the FastAPI server.
"""

from __future__ import annotations

import asyncio
import json
import sys
from contextlib import asynccontextmanager, redirect_stdout
from typing import Any, Optional
from uuid import UUID

import mcp.types as types
from mcp.server import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

from cognee.shared.logging_utils import get_logger
from cognee.modules.storage.utils import JSONEncoder

logger = get_logger()

# ---------------------------------------------------------------------------
# FastMCP instance — tools are registered below with @mcp.tool()
# ---------------------------------------------------------------------------
mcp = FastMCP("Cognee")

# Configure once at module level
mcp.settings.streamable_http_path = "/"
mcp.settings.transport_security = TransportSecuritySettings(
    enable_dns_rebinding_protection=False,
)


# ---------------------------------------------------------------------------
# Lifespan helper — call this from FastAPI's lifespan to start the MCP
# session manager's internal task group (required before handling requests).
# ---------------------------------------------------------------------------
@asynccontextmanager
async def mcp_lifespan():
    """Async context manager that runs the MCP session manager for its lifetime.

    Must be entered inside the FastAPI app lifespan so the session manager's
    anyio task group is active before any MCP requests arrive.
    Call ``get_mcp_app()`` / ``app.mount()`` *before* entering this context so
    that ``streamable_http_app()`` has already initialised ``_session_manager``.
    """
    async with mcp.session_manager.run():
        yield


# ---------------------------------------------------------------------------
# Public helper — called from main.py to obtain the ASGI app to mount
# ---------------------------------------------------------------------------
def get_mcp_app():
    """Return the Starlette ASGI app for Streamable-HTTP MCP transport."""
    return mcp.streamable_http_app()


@mcp.tool()
async def cognify(
    data: str,
    graph_model_file: Optional[str] = None,
    graph_model_name: Optional[str] = None,
    custom_prompt: Optional[str] = None,
) -> list[types.TextContent]:
    """
    Transform ingested data into a structured knowledge graph.

    Adds ``data`` to cognee and then launches the cognify pipeline as a
    background task (returns immediately due to MCP timeout constraints).
    Use ``cognify_status`` to poll for completion.

    Parameters
    ----------
    data:
        Text or document content to process.
    graph_model_file:
        Optional path to a Python file that defines a custom graph model class.
    graph_model_name:
        Class name inside ``graph_model_file`` to use as the graph model.
    custom_prompt:
        Override the default entity-extraction prompt.
    """
    import importlib.util
    import cognee

    async def _run() -> None:
        with redirect_stdout(sys.stderr):
            logger.info("cognify task starting")
            graph_model: Any = None
            if graph_model_file and graph_model_name:
                import os

                path = os.path.abspath(graph_model_file)
                spec = importlib.util.spec_from_file_location("_graph_model", path)
                if spec and spec.loader:
                    module = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(module)  # type: ignore[union-attr]
                    graph_model = getattr(module, graph_model_name)

            await cognee.add(data)
            kwargs: dict[str, Any] = {}
            if custom_prompt:
                kwargs["custom_prompt"] = custom_prompt
            if graph_model:
                kwargs["graph_model"] = graph_model
            try:
                await cognee.cognify(**kwargs)
                logger.info("cognify task finished")
            except Exception as exc:
                logger.error("cognify task failed: %s", exc)
                raise

    asyncio.create_task(_run())

    return [
        types.TextContent(
            type="text",
            text=(
                "Background cognify task launched.\n"
                "Use the `cognify_status` tool to check progress."
            ),
        )
    ]


@mcp.tool()
async def search(
    search_query: str,
    search_type: str,
    top_k: int = 10,
    datasets: Optional[list[str]] = None,
) -> list[types.TextContent]:
    """
    Search and query the knowledge graph.

    Parameters
    ----------
    search_query:
        Natural-language question or search query.
    search_type:
        One of: GRAPH_COMPLETION, RAG_COMPLETION, CHUNKS, SUMMARIES, CODE,
        CYPHER, FEELING_LUCKY.
    top_k:
        Maximum number of results to return (default 10).
    datasets:
        Optional list of dataset names or IDs to restrict the search to.
        When omitted, all accessible datasets are searched.
    """
    import cognee
    from cognee.modules.search.types import SearchType

    with redirect_stdout(sys.stderr):
        kwargs: dict[str, Any] = dict(
            query_type=SearchType[search_type.upper()],
            query_text=search_query,
            top_k=top_k,
        )
        if datasets:
            kwargs["datasets"] = datasets
        results = await cognee.search(**kwargs)

    stype = search_type.upper()
    if stype in ("GRAPH_COMPLETION", "RAG_COMPLETION"):
        # Extract only the search result text, omitting dataset metadata
        if results:
            first = results[0]
            text = first.get("search_result", str(first)) if isinstance(first, dict) else str(first)
        else:
            text = ""
    elif stype == "CODE":
        text = json.dumps(results, cls=JSONEncoder)
    else:
        text = str(results)

    return [types.TextContent(type="text", text=text)]


@mcp.tool()
async def list_data(dataset_id: Optional[str] = None) -> list[types.TextContent]:
    """
    List all datasets (and optionally the data items in one dataset).

    Parameters
    ----------
    dataset_id:
        If provided, list individual data items for this dataset UUID.
        If omitted, list all datasets.
    """
    from cognee.modules.users.methods import get_default_user
    from cognee.modules.data.methods import get_datasets

    with redirect_stdout(sys.stderr):
        try:
            lines: list[str] = []
            user = await get_default_user()

            if dataset_id:
                from cognee.modules.data.methods import get_dataset, get_dataset_data

                ds = await get_dataset(user.id, UUID(dataset_id))
                if not ds:
                    return [types.TextContent(type="text", text=f"Dataset not found: {dataset_id}")]

                items = await get_dataset_data(UUID(str(ds.id)))
                lines.append(f"Dataset: {ds.name}  (id={ds.id})")
                for i, item in enumerate(items, 1):
                    lines.append(f"  {i}. {item.name or 'Unnamed'}  (data_id={item.id})")
            else:
                datasets = await get_datasets(user.id)
                if not datasets:
                    return [types.TextContent(type="text", text="No datasets found.")]
                lines.append("Available datasets:")
                for ds in datasets:
                    lines.append(f"  - {ds.name}  (id={ds.id})")

            return [types.TextContent(type="text", text="\n".join(lines))]

        except ValueError as exc:
            return [types.TextContent(type="text", text=f"Invalid UUID: {exc}")]
        except Exception as exc:
            logger.error("list_data error: %s", exc)
            return [types.TextContent(type="text", text=f"Error: {exc}")]


@mcp.tool()
async def delete(
    data_id: str,
    dataset_id: str,
    mode: str = "soft",
) -> list[types.TextContent]:
    """
    Delete a specific data item from a dataset.

    Parameters
    ----------
    data_id:
        UUID string of the data item to delete.
    dataset_id:
        UUID string of the dataset that contains the item.
    mode:
        ``"soft"`` (default) or ``"hard"`` deletion.
    """
    import cognee
    from cognee.modules.users.methods import get_default_user

    with redirect_stdout(sys.stderr):
        try:
            user = await get_default_user()
            result = await cognee.delete(
                data_id=UUID(data_id),
                dataset_id=UUID(dataset_id),
                mode=mode,
                user=user,
            )
            return [
                types.TextContent(
                    type="text",
                    text=f"Deleted.\n{json.dumps(result, indent=2, cls=JSONEncoder)}",
                )
            ]
        except ValueError as exc:
            return [types.TextContent(type="text", text=f"Invalid UUID: {exc}")]
        except Exception as exc:
            logger.error("delete error: %s", exc)
            return [types.TextContent(type="text", text=f"Error: {exc}")]


@mcp.tool()
async def prune() -> list[types.TextContent]:
    """
    Reset the knowledge graph by removing ALL stored data.

    This is irreversible. Both data content and system metadata are removed.
    """
    import cognee

    with redirect_stdout(sys.stderr):
        try:
            await cognee.prune.prune_data()
            await cognee.prune.prune_system(metadata=True)
            return [types.TextContent(type="text", text="Pruned successfully.")]
        except Exception as exc:
            logger.error("prune error: %s", exc)
            return [types.TextContent(type="text", text=f"Error: {exc}")]


@mcp.tool()
async def cognify_status() -> list[types.TextContent]:
    """
    Get the current status of the cognify pipeline for the default dataset.
    """
    with redirect_stdout(sys.stderr):
        try:
            from cognee.modules.data.methods.get_unique_dataset_id import get_unique_dataset_id
            from cognee.modules.users.methods import get_default_user
            from cognee.modules.pipelines.operations.get_pipeline_status import get_pipeline_status

            user = await get_default_user()
            dataset_id = await get_unique_dataset_id("main_dataset", user)
            status = await get_pipeline_status([dataset_id], "cognify_pipeline")
            return [types.TextContent(type="text", text=str(status))]
        except Exception as exc:
            logger.error("cognify_status error: %s", exc)
            return [types.TextContent(type="text", text=f"Error: {exc}")]
