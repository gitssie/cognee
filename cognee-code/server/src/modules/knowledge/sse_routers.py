"""
SSE (Server-Sent Events) endpoints for real-time status updates.

Design: ONE global endpoint per user session.
------------------------------------------------------------------------
  GET /api/v1/events
    - Authenticated, long-lived connection.
    - Pushes ALL pipeline and dataset events for the current user.
    - Auto-reconnect-safe: the browser's EventSource retries on disconnect.

Event envelope (all events share this shape)::

    event: <type>
    data: {"type": "<type>", "pipeline_run_id": "...", "dataset_id": "...",
           "dataset_name": "...", "status": "...", ...}

Event types emitted on this stream:
    "connected"        — first event after handshake
    "pipeline:update"  — intermediate pipeline run status
    "pipeline:done"    — pipeline completed successfully
    "pipeline:error"   — pipeline errored
    "keep-alive"       — SSE comment (no data, keeps proxy connections alive)

The pipeline events are wired up automatically: when cognify is triggered
via POST /api/v1/cognify, the caller also calls
``register_pipeline_run(run_id, user_id)`` from sse_event_bus so that
subsequent queue events are forwarded to the user's global SSE stream.
"""

from __future__ import annotations

import asyncio
import json
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from cognee.modules.users.models import User
from cognee.modules.users.methods import get_authenticated_user
from cognee.shared.logging_utils import get_logger

from src.modules.knowledge.sse_event_bus import subscribe, unsubscribe

logger = get_logger("sse_routers")

router = APIRouter(tags=["SSE"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _sse_event(data: dict, event: str | None = None) -> str:
    """Format a dict as an SSE message string."""
    lines = []
    if event:
        lines.append(f"event: {event}")
    lines.append(f"data: {json.dumps(data)}")
    lines.append("")  # blank line terminates the event
    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Global user-level SSE endpoint
# ---------------------------------------------------------------------------


@router.get("/events")
async def global_event_stream(
    request: Request,
    user: User = Depends(get_authenticated_user),
):
    """
    Global SSE stream for the authenticated user.

    The frontend connects once on app startup and listens for all
    pipeline and dataset status events belonging to this user.

    Events emitted:
      - event: connected      → {"type": "connected"}
      - event: pipeline:update → {"type": "pipeline:update", "pipeline_run_id": ...,
                                   "dataset_id": ..., "dataset_name": ..., "status": ...}
      - event: pipeline:done  → same shape, status == "PipelineRunCompleted"
      - event: pipeline:error → same shape, status == "PipelineRunErrored"
    """
    queue = subscribe(user.id)

    async def event_generator() -> AsyncGenerator[str, None]:
        # Handshake event
        yield _sse_event({"type": "connected"}, event="connected")

        try:
            while True:
                if await request.is_disconnected():
                    break

                try:
                    # Wait up to 20 s for an event; send keep-alive on timeout
                    event = await asyncio.wait_for(queue.get(), timeout=20.0)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
                    continue

                if event is None:
                    # Sentinel: explicit close signal
                    break

                # event is expected to be a dict already (see sse_event_bus shim)
                evt_type: str = event.get("type", "pipeline:update")
                yield _sse_event(event, event=evt_type)

        except asyncio.CancelledError:
            pass
        finally:
            unsubscribe(user.id, queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable nginx buffering
        },
    )
