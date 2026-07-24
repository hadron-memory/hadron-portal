import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';

import AgentStatsWidget from './AgentStatsWidget.svelte';

// #636: the Agent Stats widget renders the agent count + a "Create new" action.
// SSR-rendered (no DOM) — assert against the returned body markup.

describe('AgentStatsWidget.svelte (#636)', () => {
  it('renders the count, a plural label, and a Create-new link', () => {
    const { body } = render(AgentStatsWidget, { props: { agentCount: 4 } });
    expect(body).toContain('Agent Stats');
    expect(body).toContain('>4<');
    expect(body).toContain('agents');
    expect(body).toContain('href="/app/agents/new"');
    expect(body).toContain('Create new');
  });

  it('uses the singular label for a single agent', () => {
    const { body } = render(AgentStatsWidget, { props: { agentCount: 1 } });
    expect(body).toContain('>1<');
    // The singular "agent" without the plural "agents".
    expect(body).toMatch(/>\s*agent\s*</);
  });

  it('defaults the count to 0 when no data slice is provided', () => {
    const { body } = render(AgentStatsWidget, { props: {} });
    expect(body).toContain('>0<');
    expect(body).toContain('href="/app/agents/new"');
  });
});
