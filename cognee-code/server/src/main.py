from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from cognee.modules.engine.operations.setup import setup


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Initialize cognee database
    await setup()
    yield
    # Shutdown: cleanup if needed


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
