/**
 * Agent management API service
 *
 * All endpoints go through /agent-api/ → nginx → opencode-agent:3005 (health server)
 */

const BASE = '/agent-api';

// ── Types ──────────────────────────────────────────────────────────

export interface HealthSnapshot {
  ok: boolean;
  opencode: {
    url: string;
    healthy: boolean;
    version?: string;
  };
  channels: Record<string, boolean>;
  config: {
    groupsEnabled: boolean;
  };
  activity?: {
    dayStart: number;
    inboundToday: number;
    outboundToday: number;
    lastInboundAt?: number;
    lastOutboundAt?: number;
    lastMessageAt?: number;
  };
  agent?: {
    scope: string;
    path: string;
    loaded: boolean;
    selected?: string;
  };
}

export interface SandboxRuntimeItem {
  identity: string;
  sandboxName: string;
  image: string;
  hostPort: number;
  guestPort: number;
  status: string;
  lastActivityAt: number;
  createdAt: number;
}

export interface SandboxListResult {
  ok: boolean;
  items: SandboxRuntimeItem[];
}

export interface SandboxOperationResult {
  identity: string;
  ok: boolean;
  error?: string;
}

export interface AgentConfig {
  model?: string;
  prompt?: string;
  mcp?: Record<string, unknown>;
  permission?: Record<string, unknown>;
  agent?: Record<string, unknown>;
}

export interface TelegramIdentity {
  id: string;
  enabled: boolean;
  running: boolean;
  access?: 'public' | 'private';
  pairingRequired?: boolean;
}

export interface SlackIdentity {
  id: string;
  enabled: boolean;
  running: boolean;
}

export interface BindingItem {
  channel: string;
  identityId: string;
  peerId: string;
  directory: string;
  updatedAt?: number;
}

export interface GroupsConfig {
  ok: boolean;
  groupsEnabled: boolean;
}

// ── API functions ──────────────────────────────────────────────────

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Agent API error ${resp.status}: ${body}`);
  }
  return resp.json();
}

// ── Health ──────────────────────────────

export function getHealth(): Promise<HealthSnapshot> {
  return request<HealthSnapshot>('/health');
}

// ── Sandbox management ──────────────────

export function listSandboxes(): Promise<SandboxListResult> {
  return request<SandboxListResult>('/sandboxes');
}

export function stopSandbox(identity: string): Promise<SandboxOperationResult> {
  return request<SandboxOperationResult>(`/sandboxes/${encodeURIComponent(identity)}/stop`, {
    method: 'POST',
  });
}

export function removeSandbox(identity: string): Promise<SandboxOperationResult> {
  return request<SandboxOperationResult>(`/sandboxes/${encodeURIComponent(identity)}`, {
    method: 'DELETE',
  });
}

// ── Agent config ─────────────────────────

export function getAgentConfig(): Promise<AgentConfig> {
  return request<AgentConfig>('/config/agent');
}

export function updateAgentConfig(input: Partial<AgentConfig>): Promise<AgentConfig> {
  return request<AgentConfig>('/config/agent', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

// ── Unified channel identities (all channels) ─

export interface ChannelIdentityItem {
  id: string;
  enabled: boolean;
  running: boolean;
  directory?: string;
  meta?: Record<string, unknown>;
}

export interface ChannelIdentitiesResult {
  ok: boolean;
  channels: Record<string, { items: ChannelIdentityItem[] }>;
}

export function listAllIdentities(): Promise<ChannelIdentitiesResult> {
  return request<ChannelIdentitiesResult>('/identities');
}

// ── Channel identities (per-channel) ──────

export function listTelegramIdentities(): Promise<{ ok: boolean; items: TelegramIdentity[] }> {
  return request<{ ok: boolean; items: TelegramIdentity[] }>('/identities/telegram');
}

export function upsertTelegramIdentity(input: {
  id?: string;
  token: string;
  enabled?: boolean;
  directory?: string;
}): Promise<{ ok: boolean; telegram: { id: string; enabled: boolean; applied?: boolean; error?: string } }> {
  return request('/identities/telegram', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function deleteTelegramIdentity(id: string): Promise<{ ok: boolean; telegram: { id: string; deleted: boolean } }> {
  return request(`/identities/telegram/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function listSlackIdentities(): Promise<{ ok: boolean; items: SlackIdentity[] }> {
  return request<{ ok: boolean; items: SlackIdentity[] }>('/identities/slack');
}

export function upsertSlackIdentity(input: {
  id?: string;
  botToken: string;
  appToken: string;
  enabled?: boolean;
  directory?: string;
}): Promise<{ ok: boolean; slack: { id: string; enabled: boolean; applied?: boolean; error?: string } }> {
  return request('/identities/slack', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function deleteSlackIdentity(id: string): Promise<{ ok: boolean; slack: { id: string; deleted: boolean } }> {
  return request(`/identities/slack/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ── Bindings ─────────────────────────────

export function listBindings(channel?: string): Promise<{ ok: boolean; items: BindingItem[] }> {
  const query = channel ? `?channel=${encodeURIComponent(channel)}` : '';
  return request<{ ok: boolean; items: BindingItem[] }>(`/bindings${query}`);
}

// ── Groups config ────────────────────────

export function getGroupsConfig(): Promise<GroupsConfig> {
  return request<GroupsConfig>('/config/groups');
}

export function setGroupsConfig(enabled: boolean): Promise<GroupsConfig> {
  return request<GroupsConfig>('/config/groups', {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });
}
