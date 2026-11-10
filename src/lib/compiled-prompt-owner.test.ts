import { describe, expect, it } from 'vitest';
import { compiledPromptOwner } from './compiled-prompt-owner';

describe('compiledPromptOwner (portal#1901)', () => {
  it('resolves an Agent system memory to its Agent page', () => {
    expect(compiledPromptOwner({ class: 'system', appId: null, agent: { id: 'a/1', urn: 'hrn:agent:acme.com:helper', name: 'Helper' } })).toEqual({ kind: 'agent', name: 'Helper', urn: 'hrn:agent:acme.com:helper', href: '/app/agents/a%2F1' });
    expect(compiledPromptOwner({ class: 'system', appId: null, agent: { id: 'a1', name: 'Helper' } })).toMatchObject({ kind: 'agent', urn: null });
  });
  it('resolves an install memory to the App only, never to a guessed worker or Agent', () => {
    expect(compiledPromptOwner({ class: 'system', appId: 'app-9', agent: { id: 'a1', name: 'Helper' } })).toEqual({ kind: 'install', href: '/app/apps/app-9' });
    expect(compiledPromptOwner({ class: 'system', appId: 'app-9', agent: null })).toEqual({ kind: 'install', href: '/app/apps/app-9' });
  });
  it('resolves nothing it cannot read', () => {
    expect(compiledPromptOwner(null)).toBeNull();
    expect(compiledPromptOwner({ class: 'knowledge', appId: 'app-9', agent: { id: 'a1' } })).toBeNull();
    expect(compiledPromptOwner({ class: 'system', appId: null, agent: null })).toBeNull();
    expect(compiledPromptOwner({ class: 'system', appId: null, agent: { id: null } })).toBeNull();
  });
});
