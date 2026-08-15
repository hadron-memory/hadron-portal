import { describe, expect, it } from 'vitest';
import { appSlugFromUrn, orgWideWorkerLabel, qualifiedWorkerName, workerLabel } from './worker-label';

describe('appSlugFromUrn', () => {
  it('takes the slug atom off a canonical v2 App URN', () => {
    expect(appSlugFromUrn('hrn:app:acme.com:eng-team')).toBe('eng-team');
  });

  it('accepts a user-rooted App URN', () => {
    expect(appSlugFromUrn('hrn:app:ada:my-team')).toBe('my-team');
  });

  it('falls back to the last atom for a non-canonical spelling', () => {
    // The portal still meets legacy spellings; a slightly-off qualifier beats
    // silently degrading to the bare name.
    expect(appSlugFromUrn('urn:app:acme.com::eng-team')).toBe('eng-team');
  });

  it('returns null when there is no usable atom', () => {
    expect(appSlugFromUrn(null)).toBeNull();
    expect(appSlugFromUrn(undefined)).toBeNull();
    expect(appSlugFromUrn('')).toBeNull();
    expect(appSlugFromUrn(':::')).toBeNull();
  });
});

describe('qualifiedWorkerName', () => {
  it('builds the app-qualified compound from an App URN', () => {
    expect(qualifiedWorkerName('Iris', 'hrn:app:acme.com:eng-team')).toBe('eng-team/Iris');
  });

  it('accepts a bare slug as well as a URN', () => {
    expect(qualifiedWorkerName('Iris', 'eng-team')).toBe('eng-team/Iris');
  });

  it('degrades to the bare name rather than emitting a half-built qualifier', () => {
    expect(qualifiedWorkerName('Iris', null)).toBe('Iris');
    expect(qualifiedWorkerName('Iris', '')).toBe('Iris');
  });

  it('does not mangle a name that already contains the separator', () => {
    // The separator is a rendering device, not a parse point — nothing reads
    // the compound back apart, so a name is passed through verbatim.
    expect(qualifiedWorkerName('Iris/2', 'eng-team')).toBe('eng-team/Iris/2');
  });
});

describe('workerLabel', () => {
  it('renders the bare name in App context', () => {
    expect(workerLabel('Iris', { context: 'app' })).toBe('Iris');
  });

  it('renders the compound org-wide', () => {
    expect(
      workerLabel('Iris', { context: 'org-wide', appSlugOrUrn: 'hrn:app:acme.com:eng-team' }),
    ).toBe('eng-team/Iris');
  });

  it('keeps two Apps’ same-named workers distinguishable org-wide', () => {
    // The whole point of the compound: per-App uniqueness means "Iris" alone
    // is ambiguous the moment the App context is gone.
    const a = workerLabel('Iris', { context: 'org-wide', appSlugOrUrn: 'hrn:app:acme.com:eng-team' });
    const b = workerLabel('Iris', { context: 'org-wide', appSlugOrUrn: 'hrn:app:acme.com:sales-team' });
    expect(a).not.toBe(b);
  });
});

// hadron-server#980: the shape a session row carries. `worker` is null for an
// ordinary human-driven session, and `worker.app` is separately null when the
// App self-gate masks it — so both absences need a defined rendering.
describe('orgWideWorkerLabel', () => {
  it('qualifies a session-shaped worker reference', () => {
    expect(
      orgWideWorkerLabel({ name: 'Iris', app: { urn: 'hrn:app:acme.com:eng-team' } }),
    ).toBe('eng-team/Iris');
  });

  it('is empty for a session with no worker, not a placeholder', () => {
    // The accessor feeds sorting and the global filter. Returning "—" here
    // would make a user searching for a dash match every human-driven session.
    expect(orgWideWorkerLabel(null)).toBe('');
    expect(orgWideWorkerLabel(undefined)).toBe('');
  });

  it('degrades to the bare name when the App is masked by its own read gate', () => {
    expect(orgWideWorkerLabel({ name: 'Iris', app: null })).toBe('Iris');
    expect(orgWideWorkerLabel({ name: 'Iris' })).toBe('Iris');
  });

  it('still separates two Apps’ same-named workers', () => {
    const a = orgWideWorkerLabel({ name: 'Iris', app: { urn: 'hrn:app:acme.com:eng-team' } });
    const b = orgWideWorkerLabel({ name: 'Iris', app: { urn: 'hrn:app:acme.com:sales-team' } });
    expect(a).not.toBe(b);
  });
});
