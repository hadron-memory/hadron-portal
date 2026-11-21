import { AI_CONFIG_PROVIDERS, AI_CONFIG_TEST_DEADLINE_MS } from '$lib/ai-config';
import type { AiConfigOwnerType, AiServiceConfig } from '$lib/types';

/** The AI-config section's own re-read; never a router-wide invalidateAll(). */
export const AI_CONFIGS_ENDPOINT = '/api/ai-configs';

/**
 * The client's network window for AI-config work, derived from the server's
 * respond-test deadline so the client can never abort first (#2054): the user
 * sees the server's own timeout result, and no request runs on after the UI
 * called it timed out. The margin covers transport and server overhead
 * between the deadline tripping and the response reaching the browser.
 */
export const AI_CONFIG_TIMEOUT_MS = AI_CONFIG_TEST_DEADLINE_MS + 5_000;

/** Explicit document readback must not degrade into same-fragment scrolling. */
export function aiConfigReloadHref(): string {
  if (typeof window === 'undefined') return '/';
  return `${window.location.pathname}${window.location.search}`;
}

/** One abort + timer + race implementation for AI-config network work. */
export function withAiConfigTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  onTimeout: () => T,
  controller = new AbortController(),
  parentSignal?: AbortSignal,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let onAbort: (() => void) | null = null;
  let settled = false;
  const abort = (resolve: (value: T) => void, reject: (error: unknown) => void) => {
    if (settled) return;
    settled = true;
    controller.abort();
    try {
      resolve(onTimeout());
    } catch (error) {
      reject(error);
    }
  };
  const bounded = new Promise<T>((resolve, reject) => {
    onAbort = () => abort(resolve, reject);
    timer = setTimeout(onAbort, AI_CONFIG_TIMEOUT_MS);
    if (controller.signal.aborted) onAbort();
    else controller.signal.addEventListener('abort', onAbort, { once: true });
    if (parentSignal && parentSignal !== controller.signal) {
      if (parentSignal.aborted) onAbort();
      else parentSignal.addEventListener('abort', onAbort, { once: true });
    }
  });
  const pending = Promise.resolve().then(() => operation(controller.signal));
  return Promise.race([pending, bounded]).finally(() => {
    settled = true;
    if (timer !== null) clearTimeout(timer);
    if (onAbort) {
      controller.signal.removeEventListener('abort', onAbort);
      if (parentSignal !== controller.signal) parentSignal?.removeEventListener('abort', onAbort);
    }
  });
}

const text = (value: unknown): value is string => typeof value === 'string';
const textOrNull = (value: unknown): value is string | null => value === null || text(value);
const bool = (value: unknown): value is boolean => typeof value === 'boolean';
const ownerType = (value: unknown): value is AiConfigOwnerType =>
  value === 'HADRON_SERVER' || value === 'ORGANIZATION' || value === 'APP' || value === 'AGENT';
const provider = (value: unknown): value is AiServiceConfig['provider'] =>
  text(value) && AI_CONFIG_PROVIDERS.some((candidate) => candidate.value === value);
const apiStyle = (value: unknown): value is AiServiceConfig['apiStyle'] =>
  value === null || value === 'CHAT_COMPLETIONS' || value === 'RESPONSES';
const params = (value: unknown): value is AiServiceConfig['params'] =>
  value === null || (!!value && typeof value === 'object' && !Array.isArray(value));

/** One masked config, or null when any rendered field has the wrong shape. */
export function parseAiConfig(raw: unknown): AiServiceConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  if (c.urn !== undefined && !textOrNull(c.urn)) return null;
  if (!text(c.id) || !c.id || !text(c.name) || !ownerType(c.ownerType) || !text(c.ownerId)) return null;
  if (!provider(c.provider) || !text(c.model) || !textOrNull(c.endpoint) || !textOrNull(c.effectiveEndpoint)) return null;
  if (!apiStyle(c.apiStyle) || !apiStyle(c.effectiveApiStyle) || !bool(c.hasApiKey)) return null;
  if (!textOrNull(c.apiKeyPreview) || !params(c.params) || !bool(c.enabled)) return null;
  if (!text(c.createdAt) || !textOrNull(c.updatedAt)) return null;
  return {
    id: c.id,
    ...(c.urn !== undefined ? { urn: c.urn as string | null } : {}),
    name: c.name,
    ownerType: c.ownerType,
    ownerId: c.ownerId,
    provider: c.provider,
    model: c.model,
    endpoint: c.endpoint,
    effectiveEndpoint: c.effectiveEndpoint,
    apiStyle: c.apiStyle,
    effectiveApiStyle: c.effectiveApiStyle,
    hasApiKey: c.hasApiKey,
    apiKeyPreview: c.apiKeyPreview,
    params: c.params,
    enabled: c.enabled,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/** The whole list, or null for a failed-read envelope or any malformed row. */
export function parseAiConfigList(body: unknown): AiServiceConfig[] | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const configs = (body as { configs?: unknown }).configs;
  if (!Array.isArray(configs)) return null;
  const parsed: AiServiceConfig[] = [];
  for (const raw of configs) {
    const config = parseAiConfig(raw);
    if (!config) return null;
    parsed.push(config);
  }
  return parsed;
}

/** Fetch and parse with a real time bound, even if a test/custom fetch ignores AbortSignal. */
async function readPayload(url: string, parentSignal?: AbortSignal): Promise<unknown> {
  try {
    return await withAiConfigTimeout(async (signal) => {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal,
      });
      if (!response.ok) return null;
      return await response.json();
    }, () => null, undefined, parentSignal);
  } catch {
    return null;
  }
}

/** Re-read one owner's masked list. Null means failed for any reason; never rejects. */
export async function readAiConfigs(
  ownerType: AiConfigOwnerType,
  ownerId: string,
  signal?: AbortSignal,
): Promise<AiServiceConfig[] | null> {
  const query = new URLSearchParams({ ownerType, ownerId });
  return parseAiConfigList(await readPayload(`${AI_CONFIGS_ENDPOINT}?${query}`, signal));
}

export type ResolvedAiConfigRead =
  | { status: 'fresh'; configs: AiServiceConfig[] }
  | { status: 'withheld' }
  | { status: 'failed' };

/** Re-read the enabled configs resolvable in an App's linked-agent chat context. */
export async function readResolvedAiConfigs(
  appRef: string,
  agentRef: string,
  signal?: AbortSignal,
): Promise<ResolvedAiConfigRead> {
  const query = new URLSearchParams({ appRef, agentRef });
  const body = await readPayload(`${AI_CONFIGS_ENDPOINT}?${query}`, signal);
  if (body && typeof body === 'object' && !Array.isArray(body) && (body as { withheld?: unknown }).withheld === true) {
    return { status: 'withheld' };
  }
  const configs = parseAiConfigList(body);
  return configs === null ? { status: 'failed' } : { status: 'fresh', configs };
}
