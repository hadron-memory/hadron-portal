/** #988: the rendered sync error never echoes the server text, which can carry credentials. */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import SyncErrorDetail from './SyncErrorDetail.svelte';

const SECRET = 'S3CRETvalueS3CRETvalue123';

describe('SyncErrorDetail', () => {
  it('shows fixed copy for a recognised failure, without any of the server text', () => {
    const { body } = render(SyncErrorDetail, {
      props: { syncError: `Command failed: git clone --branch nope -- https://x-access-token:${SECRET}@github.com/a/b.git /tmp\nfatal: Remote branch nope not found` },
    });
    expect(body).toContain('doesn’t exist in its repository');
    expect(body).not.toContain(SECRET);
    expect(body).not.toContain('github.com');
  });
  it('an unrecognised failure, even with a query-string token, gets generic copy only', () => {
    const { body } = render(SyncErrorDetail, { props: { syncError: `weird https://git.example/r?access_token=${SECRET}` } });
    expect(body).toContain('The last sync failed.');
    expect(body).not.toContain(SECRET);
  });
  it('the review hold reads as product copy, not the code', () => {
    const { body } = render(SyncErrorDetail, { props: { syncError: 'GIT_SYNC_REVIEW_REQUIRED: 4 repo-owned node(s) are absent' } });
    expect(body).toContain('held for review');
    expect(body).not.toContain('GIT_SYNC_REVIEW_REQUIRED');
  });
});
