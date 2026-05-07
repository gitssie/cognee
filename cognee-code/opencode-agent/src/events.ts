/**
 * Event system — uses effect/PubSub for typed publish/subscribe.
 * Mirrors opencode's bus/index.ts pattern: Context.Service + Layer + ManagedRuntime.
 */

import { Effect, Layer, Context, ManagedRuntime, Stream } from "effect";

// ═══════════════════════════════════════════════════════════
// Event definition
// ═══════════════════════════════════════════════════════════

export interface EventDefinition<T extends string = string, P = unknown> {
  readonly type: T;
  readonly _properties: P;
}

export function defineEvent<T extends string, P>(type: T): EventDefinition<T, P> {
  return { type } as EventDefinition<T, P>;
}

// ═══════════════════════════════════════════════════════════
// Domain events
// ═══════════════════════════════════════════════════════════

export interface WorkspaceInitPayload {
  identity: string;
  workspaceHostPath: string;
  opencodeDataHostPath: string;
}

/** Fired when a workspace directory is initialized — triggers workspace capabilities. */
export const WorkspaceInit = defineEvent<"workspace.init", WorkspaceInitPayload>(
  "workspace.init",
);

// ═══════════════════════════════════════════════════════════
// EventBus — Context.Service tag
// ═══════════════════════════════════════════════════════════

type Payload = { type: string; properties: unknown };

const BACKLOG_LIMIT = 256;
const backlog = new Map<string, Payload[]>();
const handlers = new Map<string, Set<(payload: Payload) => void>>();

function dispatch(payload: Payload): void {
  const existing = backlog.get(payload.type) ?? [];
  existing.push(payload);
  if (existing.length > BACKLOG_LIMIT) existing.splice(0, existing.length - BACKLOG_LIMIT);
  backlog.set(payload.type, existing);

  for (const handler of handlers.get(payload.type) ?? []) handler(payload);
}

function subscribe(type: string, handler: (payload: Payload) => void): void {
  const set = handlers.get(type) ?? new Set<(payload: Payload) => void>();
  set.add(handler);
  handlers.set(type, set);

  for (const payload of backlog.get(type) ?? []) handler(payload);
}

export interface IEventBus {
  readonly publish: <D extends EventDefinition>(def: D, properties: D["_properties"]) => Effect.Effect<void>;
  readonly on: <D extends EventDefinition>(
    def: D,
    handler: (payload: { type: D["type"]; properties: D["_properties"] }) => Effect.Effect<void>,
  ) => Effect.Effect<void>;
}

export class EventBus extends Context.Service<EventBus, IEventBus>()("EventBus") {}

// ═══════════════════════════════════════════════════════════
// EventBus layer — PubSub-backed implementation
// ═══════════════════════════════════════════════════════════

export const EventBusLive = Layer.effect(
  EventBus,
  Effect.gen(function* () {
    return EventBus.of({
      publish: <D extends EventDefinition>(def: D, properties: D["_properties"]) =>
        Effect.sync(() => dispatch({ type: def.type, properties })),

      on: <D extends EventDefinition>(
        def: D,
        handler: (payload: { type: D["type"]; properties: D["_properties"] }) => Effect.Effect<void>,
      ) =>
        Effect.sync(() =>
          subscribe(def.type, (payload) => {
            Effect.runPromise(handler(payload as any)).catch((err) => {
              console.error(`[event-bus] handler failed for ${def.type}`, err);
            });
          }),
        ),
    });
  }),
);

// ═══════════════════════════════════════════════════════════
// Runtime factory — compose layers and create runtime
// ═══════════════════════════════════════════════════════════

export function makeRuntime(...layers: Layer.Layer<any, any, any>[]) {
  const merged = layers.length > 0
    ? Layer.provideMerge(layers[0], EventBusLive as Layer.Layer<any, any, any>)
    : EventBusLive;
  const runtime = ManagedRuntime.make(merged as Layer.Layer<EventBus, never, never>);
  runtime.runPromise(Stream.runDrain(Stream.never)).catch(() => {});
  return runtime;
}

// ═══════════════════════════════════════════════════════════
// Standalone publish — for imperative code (manager.ts).
// Uses its own runtime with just EventBusLive; compose-friendly
// code should use makeRuntime + EventBus.use instead.
// ═══════════════════════════════════════════════════════════

export function publish<D extends EventDefinition>(
  def: D,
  properties: D["_properties"],
): void {
  dispatch({ type: def.type, properties });
}

export function publishLive<D extends EventDefinition>(
  def: D,
  properties: D["_properties"],
): Effect.Effect<void, never, EventBus> {
  return EventBus.use((bus) => bus.publish(def, properties));
}
