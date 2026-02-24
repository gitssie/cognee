from contextlib import asynccontextmanager
import asyncio
import subprocess
import sys
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from cognee.modules.engine.operations.setup import setup

# ── opencode-agent path ───────────────────────────────────────────────────────
# server/ is at cognee-code/server/  →  opencode-agent/ is at cognee-code/opencode-agent/
_AGENT_DIR = Path(__file__).resolve().parents[2] / "opencode-agent"

_agent_proc: subprocess.Popen | None = None


def _start_opencode_agent() -> subprocess.Popen | None:
    """Spawn the opencode-agent bun process as a background child."""
    if not _AGENT_DIR.exists():
        print(f"[server] opencode-agent directory not found: {_AGENT_DIR}", file=sys.stderr)
        return None

    bun_cmd = "bun"
    try:
        proc = subprocess.Popen(
            [bun_cmd, "run", "src/index.ts"],
            cwd=str(_AGENT_DIR),
            stdout=sys.stdout,
            stderr=sys.stderr,
        )
        print(f"[server] opencode-agent started (pid={proc.pid})", flush=True)
        return proc
    except FileNotFoundError:
        print("[server] 'bun' not found — skipping opencode-agent startup", file=sys.stderr)
        return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _agent_proc

    # Startup: Initialize cognee database
    await setup()

    # Startup: Launch opencode-agent
    _agent_proc = _start_opencode_agent()

    # Startup: Run MCP session manager for its lifetime
    from src.modules.mcp.server import mcp_lifespan

    async with mcp_lifespan():
        yield

    # Shutdown: terminate opencode-agent
    if _agent_proc is not None and _agent_proc.poll() is None:
        print("[server] Terminating opencode-agent...", flush=True)
        _agent_proc.terminate()
        try:
            await asyncio.wait_for(
                asyncio.get_event_loop().run_in_executor(None, _agent_proc.wait),
                timeout=5.0,
            )
        except asyncio.TimeoutError:
            _agent_proc.kill()


app = FastAPI(
    title="Cognee-Code Backend",
    description="AI-assisted development platform backend",
    version="0.1.0",
    docs_url="/docs",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

# CORS Configuration
origins = [
    "http://localhost:9000",  # Quasar default
    "http://localhost:3000",
    "*",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {"message": "Welcome to Cognee-Code Backend"}


# --- Core Cognee API Integration ---
from cognee.api.v1.cognify.routers import get_cognify_router
from cognee.api.v1.search.routers import get_search_router
from cognee.api.v1.datasets.routers import get_datasets_router
from cognee.api.v1.add.routers import get_add_router
from cognee.api.v1.ontologies.routers.get_ontology_router import get_ontology_router
from cognee.api.v1.rules.routers.get_rules_router import get_rules_router
from cognee.api.v1.notebooks.routers.get_notebooks_router import get_notebooks_router
from cognee.api.v1.permissions.routers.get_permissions_router import get_permissions_router
from cognee.api.v1.users.routers import get_auth_router, get_users_router
from cognee.api.v1.users.routers.get_visualize_router import get_visualize_router

# Integrate Core Routers
app.include_router(get_auth_router(), prefix="/api/v1/auth", tags=["auth"])
app.include_router(get_users_router(), prefix="/api/v1/users", tags=["users"])
app.include_router(get_cognify_router(), prefix="/api/v1/cognify", tags=["cognify"])
app.include_router(get_search_router(), prefix="/api/v1/search", tags=["search"])
app.include_router(get_datasets_router(), prefix="/api/v1/datasets", tags=["datasets"])
app.include_router(get_add_router(), prefix="/api/v1/add", tags=["add"])
app.include_router(get_ontology_router(), prefix="/api/v1/ontologies", tags=["ontologies"])
app.include_router(get_rules_router(), prefix="/api/v1/rules", tags=["rules"])
app.include_router(get_notebooks_router(), prefix="/api/v1/notebooks", tags=["notebooks"])
app.include_router(get_permissions_router(), prefix="/api/v1/permissions", tags=["permissions"])
app.include_router(get_visualize_router(), prefix="/api/v1/visualize", tags=["visualize"])


# --- Custom Modules ---
# Note: knowledge_router removed - cognee core datasets router provides full functionality
from src.modules.access_control.routers import router as access_control_router

app.include_router(access_control_router, prefix="/api/v1", tags=["rbac"])

# --- MCP (Model Context Protocol) ---
# Mount the FastMCP Streamable-HTTP app at /mcp/ so that external MCP clients
# (e.g. opencode-agent) can connect at http://localhost:8000/mcp/
from src.modules.mcp.server import get_mcp_app

app.mount("/mcp", get_mcp_app())
