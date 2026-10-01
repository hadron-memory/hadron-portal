import { describe, expect, it } from 'vitest';
import { classifyGitFailure, gitFailureMessage, gitFailureText, type GitFailure } from './sync-error';

const SECRET = 'S3CRETvalueS3CRETvalue123';

describe('classifyGitFailure (#988)', () => {
  const cases: Array<[string, GitFailure]> = [
    ['GIT_SYNC_REVIEW_REQUIRED: 3 repo-owned node(s) are absent', 'review-required'],
    ['fatal: Remote branch nope not found in upstream origin', 'branch-not-found'],
    ["error: pathspec 'nope' did not match any file(s) known to git", 'branch-not-found'],
    ['fatal: couldn\'t find remote ref refs/heads/nope', 'branch-not-found'],
    ["remote: Repository not found.\nfatal: repository 'https://github.com/a/b.git/' not found", 'repo-not-found'],
    ['fatal: Authentication failed for https://github.com/a/b.git/', 'auth-failed'],
    ['fatal: unable to access …: The requested URL returned error: 403', 'auth-failed'],
    ['fatal: unable to access …: The requested URL returned error: 404', 'repo-not-found'],
    ['fatal: unable to access …: Could not resolve host: github.com', 'network'],
    [' ! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs', 'push-rejected'],
    ['something nobody anticipated', 'unknown'],
    ['', 'unknown'],
  ];
  for (const [text, kind] of cases) {
    it(`${JSON.stringify(text.slice(0, 40))} → ${kind}`, () => expect(classifyGitFailure(text)).toBe(kind));
  }
  it('null and undefined are unknown', () => {
    expect(classifyGitFailure(null)).toBe('unknown');
    expect(classifyGitFailure(undefined)).toBe('unknown');
  });
});

describe('gitFailureMessage never echoes the server text (#988, Codex P1 on #989)', () => {
  // Every credential shape a blacklist could miss: URL userinfo (GitHub and
  // not), a query-string token, an Authorization header, a bare token.
  const leaks = [
    `Command failed: git clone -- https://x-access-token:${SECRET}@github.com/a/b.git /tmp/x\nfatal: Remote branch nope not found`,
    `fatal: unable to access 'https://git.example/repo.git?access_token=${SECRET}': Could not resolve host`,
    `Command failed: git -c http.extraHeader=Authorization: Bearer ${SECRET} fetch origin`,
    `Command failed: git push https://deploy:${SECRET}@gitlab.example/x.git\n ! [rejected] main -> main (non-fast-forward)`,
    `Git setup failed: ${SECRET} something unanticipated`,
  ];
  for (const raw of leaks) {
    for (const op of ['sync', 'push'] as const) {
      it(`${op}: no part of ${JSON.stringify(raw.slice(0, 48))}…`, () => {
        const out = gitFailureMessage(raw, op);
        expect(out).not.toContain(SECRET);
        expect(out).not.toContain('http');
        expect(out).not.toContain('Command failed');
      });
    }
  }

  it('an unknown failure says why there are no details, per operation', () => {
    expect(gitFailureText('unknown', 'sync')).toContain('The last sync failed.');
    expect(gitFailureText('unknown', 'push')).toContain('Push to Git failed.');
    expect(gitFailureText('unknown', 'sync')).toContain('can contain credentials');
  });

  it('the review hold names the next step, not the code', () => {
    const out = gitFailureMessage('GIT_SYNC_REVIEW_REQUIRED: 2 repo-owned node(s)', 'sync');
    expect(out).toContain('held for review');
    expect(out).toContain('Read branch');
    expect(out).not.toContain('GIT_SYNC_REVIEW_REQUIRED');
    // The only release deletes the held nodes, so the copy must say to keep them first (#1576, Ada #6000).
    expect(out).toContain('changed nothing');
    expect(out).toContain('export what you want to keep first');
  });
});
