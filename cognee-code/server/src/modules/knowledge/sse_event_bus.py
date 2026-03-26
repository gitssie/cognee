"""
User-scoped event bus for global SSE streaming.

Architecture:
    - Each connected user gets an asyncio.Queue (or a set of queues if they
      have multiple browser tabs open).
    - When a cognify pipeline emits a PipelineRunInfo event the patched
      push_to_queue() also publishes the event here, keyed by user_id.
    - The global SSE endpoint (/api/v1/events) subscribes to this bus for
      the lifetime of the HTTP connection.

Thread-safety note:
    All asyncio queues are manipulated from the same event-loop thread, so
    no locks are required.
"""

from __future__ import annotations

import asyncio
from typing import Any
from uuid import UUID


# ---------------------------------------------------------------------------
# User queue registry
# ---------------------------------------------------------------------------

# user_id (str) → set of asyncio.Queue  (one Queue per open browser tab/connection)
_user_queues: dict[str, set[asyncio.Queue[Any]]] = {}

# pipeline_run_id (str) → user_id (str)  — populated when cognify starts
_run_to_user: dict[str, str] = {}


def register_pipeline_run(pipeline_run_id: UUID, user_id: UUID) -> None:
    """Record which user owns a given pipeline run."""
    _run_to_user[str(pipeline_run_id)] = str(user_id)


def unregister_pipeline_run(pipeline_run_id: UUID) -> None:
    """Remove the run → user mapping once the run is terminal."""
    _run_to_user.pop(str(pipeline_run_id), None)


def subscribe(user_id: UUID) -> asyncio.Queue[Any]:
    """
    Create and register a new Queue for a user SSE connection.
    Returns the queue; the caller is responsible for calling unsubscribe().
    """
    key = str(user_id)
    q: asyncio.Queue[Any] = asyncio.Queue()
    _user_queues.setdefault(key, set()).add(q)
    return q


def unsubscribe(user_id: UUID, queue: asyncio.Queue[Any]) -> None:
    """Remove a queue when the SSE connection closes."""
    key = str(user_id)
    if key in _user_queues:
        _user_queues[key].discard(queue)
        if not _user_queues[key]:
            del _user_queues[key]


def publish_for_run(pipeline_run_id: UUID, event: Any) -> None:
    """
    Broadcast an event to all queues belonging to the user who owns this run.
    Called by the patched push_to_queue() shim.
    """
    user_id_str = _run_to_user.get(str(pipeline_run_id))
    if user_id_str is None:
        return
    for q in list(_user_queues.get(user_id_str, [])):
        q.put_nowait(event)


def publish_for_user(user_id: UUID, event: Any) -> None:
    """Broadcast an arbitrary event directly to a user's queues."""
    for q in list(_user_queues.get(str(user_id), [])):
        q.put_nowait(event)
