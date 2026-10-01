/** #988: the rendered sync error never carries a credential, and the review hold reads as product copy. */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import SyncErrorDetail from './SyncErrorDetail.svelte';

describe('SyncErrorDetail', () => {
  it('renders a failed sync’s reason redacted', () => {
    const { body } = render(SyncErrorDetail, {
      props: { syncError: 'Command failed: git clone -- https://x-access-token:ghs_SECRETsecretSECRET1234@github.com/a/b.git /tmp' },
    });
    expect(body).toContain('The last sync failed.');
    expect(body).not.toContain('ghs_SECRET');
    expect(body).toContain('https://***@github.com/a/b.git');
  });
  it('renders the review hold as product copy with the next step, not the server text', () => {
    const { body } = render(SyncErrorDetail, { props: { syncError: 'GIT_SYNC_REVIEW_REQUIRED: 4 repo-owned node(s) are absent' } });
    expect(body).toContain('held for review');
    expect(body).toContain('Read branch');
    expect(body).not.toContain('GIT_SYNC_REVIEW_REQUIRED');
  });
});
