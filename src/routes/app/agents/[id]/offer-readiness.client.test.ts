/**
 * portal#1850 (hrn:node:hadronmemory.com:specs:cor:dmo:050:19): the Agent page shows its manager whether the
 * Agent is ready to be offered to other organisations. Acceptance pins 1–3 —
 * ready shows ready; not-ready lists one line per reason in server order with
 * named subjects and counts; null (every non-manager, PUBLIC readers included)
 * renders NOTHING: no heading, no state line, no empty section.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import Page from './+page.svelte';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { pageData } from './page-fixture';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

async function mountAgent(agentOverride: Record<string, unknown>) {
  const data = await pageData('a', { mentionOnly: false }, agentOverride);
  const props = reactiveProps<Record<string, unknown>>({ data: { ...data, navOrgs: [] }, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  return m;
}

// The section must be findable as a unit, so the pins can also prove its ABSENCE.
const section = (root: HTMLElement) =>
  [...root.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent?.trim() === 'Offering') ?? null;

describe('agent offer readiness (#1850)', () => {
  it('acceptance 1: a manager of a ready Agent sees ready', async () => {
    const m = await mountAgent({ offerReadiness: { ready: true, reasons: [] } });
    expect(section(m.target)).not.toBeNull();
    expect(m.target.textContent).toContain('Ready to be offered');
    expect(m.target.textContent).not.toContain('Not ready to be offered');
  });

  it('acceptance 2: one line per reason, in server order, names when the server names them, counts otherwise', async () => {
    const m = await mountAgent({
      offerReadiness: {
        ready: false,
        reasons: [
          { code: 'AGENT_NOT_PUBLIC', count: 1, subjects: [], omittedByCap: 0, hiddenByAccess: 1 },
          {
            code: 'CLONE_LINKED_MEMORY_ENCRYPTED',
            count: 3,
            subjects: [{ name: 'Team roles' }],
            omittedByCap: 0,
            hiddenByAccess: 2,
          },
          {
            code: 'CLONE_IMPORT_UNUSABLE',
            count: 22,
            subjects: [{ name: 'Alpha role' }, { name: 'Beta role' }],
            omittedByCap: 2,
            hiddenByAccess: 18,
          },
        ],
      },
    });
    const text = m.target.textContent ?? '';
    expect(text).toContain('Not ready to be offered');
    // Server order preserved: NOT_PUBLIC before the encrypted memory before the import.
    const notPublic = text.indexOf('only subscribe to, install or clone a PUBLIC Agent');
    const encrypted = text.indexOf('3 linked memories are encrypted');
    const imports = text.indexOf('22 imported Agents can’t be used by another organization');
    expect(notPublic).toBeGreaterThan(-1);
    expect(encrypted).toBeGreaterThan(notPublic);
    expect(imports).toBeGreaterThan(encrypted);
    // Named subjects appear after a separator (the server names only what the manager may read).
    expect(text).toContain('3 linked memories are encrypted: Team roles');
    expect(text).toContain('Alpha role, Beta role');
    // Hidden and capped subjects are counts only — and the hidden line carries its own noun (UX #1859).
    expect(text).toContain('2 more items you can’t view');
    expect(text).toContain('+2 more');
    expect(text).toContain('18 more items you can’t view');
    expect(text).toContain('1 more item you can’t view');
  });

  it('acceptance 3 (hard pin): null offerReadiness renders nothing — no section, no state line', async () => {
    const m = await mountAgent({ offerReadiness: null });
    expect(section(m.target)).toBeNull();
    expect(m.target.textContent).not.toContain('Ready to be offered');
    expect(m.target.textContent).not.toContain('Not ready to be offered');
  });

  it('acceptance 3 control: an absent field (slim projection) also renders nothing', async () => {
    const m = await mountAgent({});
    expect(section(m.target)).toBeNull();
    expect(m.target.textContent).not.toContain('Not ready to be offered');
  });

  // The offerReasonText fallback exists so a server code the portal does not
  // know yet stays VISIBLE instead of being swallowed. Pin exactly that: an
  // unknown code renders, carrying the raw code with it.
  it('an unknown reason code renders the raw code, never silence', async () => {
    const m = await mountAgent({
      offerReadiness: {
        ready: false,
        reasons: [{ code: 'SOME_FUTURE_CODE', count: 1, subjects: [], omittedByCap: 0, hiddenByAccess: 0 }],
      },
    });
    expect(section(m.target)).not.toBeNull();
    expect(m.target.textContent).toContain('Blocked: SOME_FUTURE_CODE');
  });

  // The Settings pointer is the section's only interactive element (BLIND #1859):
  // it exists exactly when AGENT_NOT_PUBLIC is among the reasons, and a singular
  // count keeps the singular sentence.
  it('the Settings pointer appears only with AGENT_NOT_PUBLIC; singular counts keep singular copy', async () => {
    const withNotPublic = await mountAgent({
      offerReadiness: {
        ready: false,
        reasons: [
          { code: 'AGENT_NOT_PUBLIC', count: 1, subjects: [], omittedByCap: 0, hiddenByAccess: 0 },
          { code: 'CLONE_LINKED_MEMORY_ENCRYPTED', count: 1, subjects: [{ name: 'Team roles' }], omittedByCap: 0, hiddenByAccess: 0 },
        ],
      },
    });
    const text = withNotPublic.target.textContent ?? '';
    expect(text).toContain('A linked memory is encrypted: Team roles');
    expect(section(withNotPublic.target)?.querySelector('button')).not.toBeNull();
    expect(text).toContain('Visibility can be changed in');
    await withNotPublic.unmount();

    const withoutNotPublic = await mountAgent({
      offerReadiness: {
        ready: false,
        reasons: [{ code: 'AGENT_RETIRED', count: 1, subjects: [], omittedByCap: 0, hiddenByAccess: 0 }],
      },
    });
    expect(withoutNotPublic.target.textContent).not.toContain('Visibility can be changed in');
  });

  // The UI trusts `ready` (the server computes it from the same blockers); a
  // contradictory payload still renders ready, not a reason list (BLIND #1859).
  it('ready wins: a non-empty reasons array alongside ready renders the ready state', async () => {
    const m = await mountAgent({
      offerReadiness: {
        ready: true,
        reasons: [{ code: 'AGENT_RETIRED', count: 1, subjects: [], omittedByCap: 0, hiddenByAccess: 0 }],
      },
    });
    expect(m.target.textContent).toContain('Ready to be offered');
    expect(m.target.textContent).not.toContain('This Agent is retired');
  });
});
