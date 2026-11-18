import { afterEach, describe, expect, it } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import Page from './+page.svelte';
import { connectExchangeSchema, deleteExchangeConnectionSchema, githubAppCredentialsSchema, githubInstallationSchema, testExchangeConnectionSchema, unlinkGithubSchema } from './schema';

let mounted: Mounted<Record<string, unknown>> | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; });

describe('AI-only integration URN scope (#1907)', () => {
  it('keeps Exchange and GitHub cards free of any URN chip', async () => {
    setStubPage('https://example.test/app/orgs/o1/integrations', { id: 'o1' });
    const [githubAppForm, githubInstallationForm, unlinkGithubForm, connectExchangeForm, testExchangeConnectionForm, deleteExchangeConnectionForm] = await Promise.all(
      [githubAppCredentialsSchema, githubInstallationSchema, unlinkGithubSchema, connectExchangeSchema, testExchangeConnectionSchema, deleteExchangeConnectionSchema].map(schema => superValidate(zod4(schema as never), { errors: false })),
    );
    mounted = mountComponent(Page as never, { data: {
      org: { id: 'o1', name: 'Acme', urn: 'hrn:org:acme.com', members: [], githubAppId: '123', githubInstallationId: 456,
        githubUrn: 'hrn:aiconf:acme.com:org:github-must-not-render',
        exchangeConnections: [{ id: 'ex1', displayName: 'Exchange control', mailboxEmail: 'synthetic@example.invalid', syncStatus: 'OK', urn: 'hrn:aiconf:acme.com:org:exchange-must-not-render' }],
      },
      currentUserId: 'u1', configs: [], configsError: null,
      githubAppForm, githubInstallationForm, unlinkGithubForm, connectExchangeForm, testExchangeConnectionForm, deleteExchangeConnectionForm,
    }, form: null } as never) as Mounted<Record<string, unknown>>;
    await tick();
    const root = mounted.target;
    expect(root.textContent).toContain('Exchange control');
    expect(root.textContent).toContain('GitHub');
    expect(root.textContent).not.toContain('exchange-must-not-render');
    expect(root.textContent).not.toContain('github-must-not-render');
    const chips = [...root.querySelectorAll('button[aria-label*="URN"]')];
    expect(chips.length).toBeGreaterThan(0); // the AI section owner is a positive control
    for (const chip of chips) expect(chip.closest('section')?.textContent).toContain('AI');
  });
});
