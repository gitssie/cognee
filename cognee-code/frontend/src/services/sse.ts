/**
 * Global SSE (Server-Sent Events) service.
 *
 * Design: ONE persistent EventSource connection per user session.
 *   GET /api/v1/events
 *
 * On connect, all pipeline and dataset events for the current user are
 * pushed through this single stream. The service forwards each event onto
 * the Quasar EventBus so any component can subscribe without knowing about
 * the underlying SSE connection.
 *
 * Bus event names mirror the SSE event types:
 *   "connected"       — initial handshake
 *   "pipeline:update" — intermediate pipeline run status
 *   "pipeline:done"   — pipeline completed successfully
 *   "pipeline:error"  — pipeline errored
 *
 * Usage in components:
 *   import { inject } from 'vue'
 *   import type { EventBus } from 'quasar'
 *   const bus = inject<EventBus>('sseBus')!
 *   bus.on('pipeline:update', handler)
 *   // remember to bus.off('pipeline:update', handler) on unmount
 */

import type { EventBus } from 'quasar';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SseConnectedPayload {
  user_id: string;
}

export interface PipelineEventPayload {
  type: string;
  pipeline_run_id: string;
  dataset_id?: string;
  dataset_name?: string;
  status: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const SSE_BASE = '/api/v1/events';

// The backend uses CookieTransport; EventSource sends the auth_token cookie
// automatically when withCredentials is true — no ?token= query param needed.

/** Named SSE events the server emits on this endpoint. */
const SSE_EVENT_NAMES: string[] = [
  'connected',
  'pipeline:update',
  'pipeline:done',
  'pipeline:error',
];

/** Reconnect delay in milliseconds (exponential back-off base). */
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

let _bus: EventBus | null = null;
let _es: EventSource | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _reconnectAttempts = 0;
let _destroyed = false;

// ---------------------------------------------------------------------------
// Core connection logic
// ---------------------------------------------------------------------------

function _connect(): void {
  if (_destroyed || _es) return;

  _es = new EventSource(SSE_BASE, { withCredentials: true });

  for (const evtName of SSE_EVENT_NAMES) {
    _es.addEventListener(evtName, (event: MessageEvent) => {
      if (!_bus) return;
      try {
        const payload: unknown = JSON.parse(event.data as string);
        _bus.emit(evtName, payload);
      } catch {
        _bus.emit(evtName, event.data);
      }
    });
  }

  _es.onopen = () => {
    _reconnectAttempts = 0;
  };

  _es.onerror = () => {
    _teardownEs();
    _scheduleReconnect();
  };
}

function _teardownEs(): void {
  if (_es) {
    _es.close();
    _es = null;
  }
}

function _scheduleReconnect(): void {
  if (_destroyed) return;
  if (_reconnectTimer !== null) return; // already scheduled

  const delay = Math.min(
    RECONNECT_BASE_MS * 2 ** _reconnectAttempts,
    RECONNECT_MAX_MS,
  );
  _reconnectAttempts += 1;

  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    _connect();
  }, delay);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Called by boot/sse.ts once, right after app creation.
 * Wires in the Quasar EventBus and opens the global SSE connection.
 */
export function initSseService(bus: EventBus): void {
  _bus = bus;
  _destroyed = false;
  _connect();
}

/**
 * Close the SSE connection and cancel any pending reconnect.
 * Intended for app teardown (e.g. hot-reload, SSR cleanup).
 */
export function destroySseService(): void {
  _destroyed = true;
  if (_reconnectTimer !== null) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  _teardownEs();
  _bus = null;
}
