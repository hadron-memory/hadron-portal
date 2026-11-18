import { describe, expect, it, vi } from 'vitest';
import type { GraphQLClient } from 'graphql-request';
import { AGENT_EXTENSIONS_QUERY, AGENT_SYSTEM_MEMORY_IDENTITY_QUERY, loadAgentExtensions, loadSystemMemoryIdentity } from './agent-profile';
function client(request: ReturnType<typeof vi.fn>) { return { request } as unknown as GraphQLClient; }
describe('canonical extending Agent pages', () => {
  it('uses the reverse-read contract and preserves an empty incomplete scan cursor', async () => {
    const request = vi.fn().mockResolvedValue({ agent: { extendedBy: { items: [], hasMore: true, endCursor: 'opaque+/=' } } });
    expect(await loadAgentExtensions(client(request), 'base', 'previous')).toEqual({ items: [], hasMore: true, endCursor: 'opaque+/=', failed: false });
    expect(request).toHaveBeenCalledWith(AGENT_EXTENSIONS_QUERY, { ref: 'base', after: 'previous' });
    expect(AGENT_EXTENSIONS_QUERY).toContain('extendedBy(first: 20, after: $after)');
  });
  it('returns readable identities and does not infer a total or enumerate org agents', async () => {
    const items = [{ id: 'child', name: 'Child', urn: 'hrn:agent:example.com:child' }];
    const request = vi.fn().mockResolvedValue({ agent: { extendedBy: { items, hasMore: false, endCursor: null } } });
    expect(await loadAgentExtensions(client(request), 'base', null)).toEqual({ items, hasMore: false, endCursor: null, failed: false });
    expect(request).toHaveBeenCalledTimes(1);
    expect(AGENT_EXTENSIONS_QUERY).not.toMatch(/total|organizations/);
  });
  it.each(['refused', 'missing cursor', 'base disappeared'])('distinguishes %s from an empty successful page', async mode => {
    const request = mode === 'refused' ? vi.fn().mockRejectedValue(new Error('expired opaque cursor')) : vi.fn().mockResolvedValue(mode === 'base disappeared' ? { agent: null } : { agent: { extendedBy: { items: [], hasMore: true, endCursor: null } } });
    expect(await loadAgentExtensions(client(request), 'base', 'expired')).toEqual({ items: [], endCursor: null, hasMore: false, failed: true });
  });
});
describe('authorized system memory identity', () => {
  it('looks up the exact system memory without composing a URN', async () => {
    const memory = { id: 'sys', name: 'System', urn: 'hrn:mem:example.com:system' };
    const request = vi.fn().mockResolvedValue({ memory });
    expect(await loadSystemMemoryIdentity(client(request), 'sys')).toEqual(memory);
    expect(request).toHaveBeenCalledWith(AGENT_SYSTEM_MEMORY_IDENTITY_QUERY, { ref: 'sys' });
  });
  it('does not query when absent and never guesses an unreadable identity', async () => {
    const request = vi.fn().mockRejectedValue(new Error('unreadable'));
    expect(await loadSystemMemoryIdentity(client(request), null)).toBeNull(); expect(request).not.toHaveBeenCalled();
    expect(await loadSystemMemoryIdentity(client(request), 'hidden')).toBeNull();
    request.mockResolvedValue({ memory: null });
    expect(await loadSystemMemoryIdentity(client(request), 'hidden')).toBeNull();
  });
});
