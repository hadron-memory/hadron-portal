import type { AiConfigOwnerType, AiServiceConfig } from '$lib/types';

/** The AI-config section's own re-read; never a router-wide invalidateAll(). */
export const AI_CONFIGS_ENDPOINT = '/api/ai-configs';
export const AI_CONFIG_READBACK_TIMEOUT_MS = 10_000;

const text = (value: unknown): value is string => typeof value === 'string';
const textOrNull = (value: unknown): value is string | null => value === null || text(value);
const bool = (value: unknown): value is boolean => typeof value === 'boolean';
const ownerType = (value: unknown): value is AiConfigOwnerType =>
  value === 'HADRON_SERVER' || value === 'ORGANIZATION' || value === 'APP' || value === 'AGENT';
const apiStyle = (value: unknown): value is AiServiceConfig['apiStyle'] =>
  value === null || value === 'CHAT_COMPLETIONS' || value === 'RESPONSES';
const params = (value: unknown): value is AiServiceConfig['params'] =>
  value === null || (!!value && typeof value === 'object' && !Array.isArray(value));

/** One masked config, or null when any rendered field has the wrong shape. */
function parseConfig(raw: unknown): AiServiceConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  if (!text(c.id) || !c.id || !text(c.name) || !ownerType(c.ownerType) || !text(c.ownerId)) return null;
  if (!text(c.provider) || !text(c.model) || !textOrNull(c.endpoint) || !textOrNull(c.effectiveEndpoint)) return null;
  if (!apiStyle(c.apiStyle) || !apiStyle(c.effectiveApiStyle) || !bool(c.hasApiKey)) return null;
  if (!textOrNull(c.apiKeyPreview) || !params(c.params) || !bool(c.enabled)) return null;
  if (!text(c.createdAt) || !textOrNull(c.updatedAt)) return null;
  return {
    id: c.id,
    name: c.name,
    ownerType: c.ownerType,
    ownerId: c.ownerId,
    provider: c.provider as AiServiceConfig['provider'],
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
    const config = parseConfig(raw);
    if (!config) return null;
    parsed.push(config);
  }
  return parsed;
}

/** Fetch and parse with a real time bound, even if a test/custom fetch ignores AbortSignal. */
async function readPayload(url: string): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const pending = (async () => {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) return null;
      return await response.json();
    })();
    const expired = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(null);
      }, AI_CONFIG_READBACK_TIMEOUT_MS);
    });
    return await Promise.race([pending, expired]);
  } catch {
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/** Re-read one owner's masked list. Null means failed for any reason; never rejects. */
export async function readAiConfigs(
  ownerType: AiConfigOwnerType,
  ownerId: string,
): Promise<AiServiceConfig[] | null> {
  const query = new URLSearchParams({ ownerType, ownerId });
  return parseAiConfigList(await readPayload(`${AI_CONFIGS_ENDPOINT}?${query}`));
}

/** Re-read the enabled configs resolvable in an App's linked-agent chat context. */
export async function readResolvedAiConfigs(
  appRef: string,
  agentRef: string,
): Promise<AiServiceConfig[] | null> {
  const query = new URLSearchParams({ appRef, agentRef });
  return parseAiConfigList(await readPayload(`${AI_CONFIGS_ENDPOINT}?${query}`));
}
