/**
 * portal#2444 — the refusal sentences that point at the editor's reload control
 * read the control's label from the one shared key, so renaming the button
 * renames the sentences. Pinned by renaming the label under the sentences: a
 * sentence that hardcodes the old text keeps saying it and fails here, where an
 * assertion on the default text could not tell the two apart.
 */
import { describe, expect, it, vi } from 'vitest';

const seen: string[] = [];
vi.mock('$lib/i18n/t', async (importActual) => {
  const actual = await importActual<typeof import('$lib/i18n/t')>();
  return {
    ...actual,
    t: (id: string, text: string, vars?: Parameters<typeof actual.t>[2]) => {
      seen.push(id);
      return id === 'customisation.reload-discard' ? 'Start over' : actual.t(id, text, vars);
    },
  };
});

import { writeCustomisation } from './install-customisation';
import { customisationRefusalLead } from '$lib/install-customisation';

describe('portal#2444: a sentence that gained {control} has its own key', () => {
  // Reusing an id whose text changed would let a translation of the OLD copy
  // keep winning (the #2444 bug again) or leak a literal {control}; the start
  // arms already minted their own ids, and so do the draft arms.
  it.each([
    ['AGENT_NOT_INSTALLED', 'customisation.draft.changed'],
    ['INSTALL_MEMORY_NOT_FOUND', 'customisation.draft.not-found'],
    ['NODE_WRITE_CONFLICT', 'customisation.draft.conflict'],
  ])('%s draft lead reads %s, not the pre-{control} id', (code, id) => {
    seen.length = 0;
    customisationRefusalLead(code, { draft: true });
    expect(seen).toContain(id);
    expect(seen).not.toContain(id.replace('.draft', ''));
  });
});

describe('portal#2444: sentences follow the shared control label', () => {
  it('the unavailable-target sentence names the renamed control', async () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({
      agentRef: 'agent-a', loc: 'x', content: 'new', baseContent: 'old', expectedRevision: '7',
    })) fd.set(k, v);
    const request = vi.fn()
      .mockResolvedValueOnce({ app: { id: 'app-a' } })
      .mockResolvedValue({ installMemory: null });
    const r = (await writeCustomisation({ request } as never, 'app-a', fd, false)) as {
      data: { customisationFailed: { detail: string } };
    };
    const detail = r.data.customisationFailed.detail;
    expect(detail).toContain('use Start over;');
    expect(detail).not.toContain('Reload and discard draft');
    expect(seen).toContain('customisation.draft.unavailable');
    expect(seen).not.toContain('customisation.unavailable');
  });

  it.each(['AGENT_NOT_INSTALLED', 'INSTALL_MEMORY_NOT_FOUND', 'NODE_WRITE_CONFLICT'])(
    'the %s draft lead names the renamed control',
    (code) => {
      const lead = customisationRefusalLead(code, { draft: true })!;
      expect(lead).toContain('use Start over;');
      expect(lead).not.toContain('Reload and discard draft');
    },
  );
});
