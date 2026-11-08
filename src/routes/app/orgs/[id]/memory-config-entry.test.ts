import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { setStubPage } from '$lib/test/stubs/app-stores';
import Layout from './+layout.svelte';

const org = {
  id: 'org-1',
  name: 'Example org',
  urn: 'hrn:org:example.com',
  githubInstallationId: null,
  githubAppId: null,
  hasGithubAppPrivateKey: false,
  createdAt: '1789430400000',
  updatedAt: '1789430400000',
};
const user = { id: 'user-1', handle: 'reader', githubUsername: null, name: 'Reader', avatarUrl: null, roles: [] as string[] };
const children = createRawSnippet(() => ({ render: () => '<div>tab body</div>' }));

describe('organization memory-config entry (#1749 B1)', () => {
  it('renders the node-role templates entry with preload-data off', () => {
    setStubPage('https://example.test/app/orgs/org-1/node-role-templates', { id: 'org-1' });
    const html = render(Layout, {
      props: {
        data: {
          user,
          activeOrgId: org.id,
          activeOrg: org,
          navOrgs: [org],
          nodeAdvice: [],
          impersonation: null,
          isConsumerMode: false,
          org,
        },
        children,
      },
    }).body;
    const link = (html.match(/<a\b[^>]*>/g) ?? []).find((tag) => tag.includes('href="/app/orgs/org-1/node-role-templates"'));
    expect(link).toBeDefined();
    expect(link).toContain('data-sveltekit-preload-data="off"');
  });
});
