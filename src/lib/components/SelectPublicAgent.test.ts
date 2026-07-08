/**
 * SelectPublicAgent SSR smoke (#486) — the ElementSelector-derived
 * marketplace picker: owner-org badge from the URN, both empty states.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import SelectPublicAgent from './SelectPublicAgent.svelte';

const agent = {
  id: 'a1',
  urn: 'hrn:agent:other.org::concierge',
  name: 'Concierge',
  description: 'Answers guest questions',
  organizationId: 'org-OTHER',
};

describe('SelectPublicAgent', () => {
  it('renders nothing when closed', () => {
    const { body } = render(SelectPublicAgent, {
      props: { agents: [agent], onselect: () => {}, open: false },
    });
    expect(body).not.toContain('Concierge');
  });

  it('renders agents with the owner-org badge derived from the URN', () => {
    const { body } = render(SelectPublicAgent, {
      props: { agents: [agent], onselect: () => {}, open: true },
    });
    expect(body).toContain('Concierge');
    expect(body).toContain('other.org');
    expect(body).toContain('hrn:agent:other.org::concierge');
    expect(body).toContain('Answers guest questions');
  });

  it('distinguishes "no public agents" from "no matches"', () => {
    const { body } = render(SelectPublicAgent, {
      props: { agents: [], onselect: () => {}, open: true },
    });
    expect(body).toContain('No public agents available');
  });
});
