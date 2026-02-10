# Backend Agent Guidelines (cognee-code/server)

This document defines the protocols, conventions, and architectural standards for the **Cognee-Code Backend**, a comprehensive AI-assisted development platform.

## 1. Project Context & Dependencies

**CRITICAL: Understand the distinction between the Core Engine and this Subproject.**

| Component | Path | Description |
| :--- | :--- | :--- |
| **Core Engine** | `/root/workspace/github/cognee` | **The Dependency.** The underlying RAG/Memory/Graph engine. We *use* this library; we generally do not modify it unless necessary for a bug fix. |
| **Our Project** | `/root/workspace/github/cognee/cognee-code` | **The Workspace.** This is where we implement the new features (M1-M7). |
| **Requirements** | `/root/workspace/github/cognee/cognee-code/docs` | **The Spec.** `functional-requirements.md` and `M*.md` files define WHAT we build. |
| **Frontend** | `/root/workspace/github/cognee/cognee-code/frontend` | The Vue 3 + Quasar UI. |
| **Backend** | `/root/workspace/github/cognee/cognee-code/server` | The FastAPI + MCP Server implementation. |

## 2. System Architecture

The backend is built upon the **Cognee Engine** and serves as the central brain for:
1.  **Memory Management:** Long-term storage of code, docs, and rules.
2.  **Knowledge Graph:** Structured representation of the codebase and knowledge.
3.  **Task Management:** Tracking AI agent tasks and execution.

### Core Modules (per `docs/functional-requirements.md`)
| Module | Name | Description |
| :--- | :--- | :--- |
| **M1** | **Knowledge Management** | Dataset organization, file ingestion, data cleaning. |
| **M2** | **Graph Knowledge** | "Cognify" pipeline, ontology management, graph visualization. |
| **M3** | **Code Rules** | Extracting, storing, and retrieving coding best practices. |
| **M4** | **AI Task Management** | Interaction logging, Notebook execution, pipeline status. |
| **M7** | **Auth & RBAC** | Multi-tenant user management, role-based access control. |

## 3. API Design Guidelines

The backend exposes a REST API (`/api/v1`) and an MCP interface.

### 3.1 REST API (`/api/v1`)
- **Framework:** FastAPI.
- **Authentication:** JWT (Bearer Token) + Cookies.
- **Standard Endpoints:**
    - `POST /api/v1/cognify`: Trigger graph generation.
    - `GET /api/v1/search`: Hybrid search (Graph + Vector).
    - `GET /api/v1/datasets`: Manage knowledge collections.
    - `POST /api/v1/responses`: OpenAI-compatible completion endpoint.

### 3.2 MCP Interface (Model Context Protocol)
- **Role:** Exposes core tools (`cognify`, `search`, `delete`, `prune`) to external AI agents (Cursor, Claude).
- **Tools:** Must align with the definitions in `functional-requirements.md` (Section 8).

## 4. Implementation Workflow

When implementing features, follow this sequence:

1.  **Requirement Check:** Read the specific section in `cognee-code/docs/functional-requirements.md`.
    - *Example:* Implementing "Delete Data"? Read Section 3.2.4 carefully regarding Soft vs. Hard delete.
2.  **Model Design:** Define Pydantic models for request/response payloads.
3.  **Logic Implementation:**
    - Import from the **Core Engine** (`cognee.*`) for graph/vector operations.
    - Ensure RBAC checks (`read`, `write`, `delete` permissions) are applied at the service layer in **Our Project**.
4.  **Interface Exposure:** Add the endpoint to `api/v1` router AND register the equivalent tool in the MCP server if applicable.

## 5. Coding Conventions

- **Language:** Python 3.10+.
- **Dependency Management:** `uv`.
- **Style:** PEP 8.
- **Type Safety:** 100% type hint coverage.
- **Async/Await:** All I/O bound operations (DB, LLM, File) must be asynchronous.

## 6. Key Technologies

- **Engine:** `cognee` (GraphRAG, Vector Store).
- **Web Framework:** `fastapi`.
- **Database:**
    - **Graph:** Neo4j or NetworkX (via Cognee adapter).
    - **Vector:** LanceDB, ChromaDB, or PGVector.
    - **Relational:** PostgreSQL (for users, permissions, metadata).
- **Protocol:** MCP (Model Context Protocol).

## 7. Developer & Agent Checklist

Before marking a task as complete:
- [ ] Does the implementation match the `functional-requirements.md` spec?
- [ ] Are permissions checked? (e.g., Can User A delete User B's dataset?)
- [ ] Is the API response format consistent with the "Frontend Display Requirements" in the docs?
- [ ] Are Pydantic models used for validation?

## 8. Startup Command

To run the backend server locally:

```bash
cd cognee-code/server
uv run uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
```
