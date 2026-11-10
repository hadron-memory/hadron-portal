/**
 * portal#1901: where a compiled boot prompt is recompiled, resolved only from what the node's own memory
 * already says. Nothing is guessed: an owner that cannot be read from the memory resolves to `null`, and the
 * page then gives generic guidance with no link and no command.
 *
 * - an Agent's system memory (class system, no App) holds the Agent's compiled prompt: compiled from the
 *   Agent's page;
 * - an App's install memory (class system, with an App) holds the App's compiled Agent prompt and a
 *   customised worker's: compiled from the App's install panel or the worker's page, which the memory alone
 *   cannot tell apart, so this resolves to the App only.
 */
export type CompiledPromptOwner =
  | { kind: 'agent'; name: string | null; urn: string | null; href: string }
  | { kind: 'install'; href: string }
  | null;

type MemoryOwnerFields = {
  class?: string | null;
  appId?: string | null;
  agent?: { id?: string | null; urn?: string | null; name?: string | null } | null;
};

export function compiledPromptOwner(memory: MemoryOwnerFields | null | undefined): CompiledPromptOwner {
  if (!memory || memory.class !== 'system') return null;
  if (memory.appId) return { kind: 'install', href: `/app/apps/${encodeURIComponent(memory.appId)}` };
  if (memory.agent?.id) return { kind: 'agent', name: memory.agent.name ?? null, urn: memory.agent.urn ?? null, href: `/app/agents/${encodeURIComponent(memory.agent.id)}` };
  return null;
}
