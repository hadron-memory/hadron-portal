/**
 * portal#2444 — the refusal sentences that point at the editor's reload control
 * read the control's label from the one shared key, so renaming the button
 * renames the sentences. Pinned by renaming the label under the sentences: a
 * sentence that hardcodes the old text keeps saying it and fails here, where an
 * assertion on the default text could not tell the two apart.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/i18n/t', async (importActual) => {
  const actual = await importActual<typeof import('$lib/i18n/t')>();
  return {
    ...actual,
    t: (id: string, text: string, vars?: Parameters<typeof actual.t>[2]) =>
      id === 'customisation.reload-discard' ? 'Start over' : actual.t(id, text, vars),
  };
});

import { writeCustomisation } from './install-customisation';
import { customisationRefusalLead } from '$lib/install-customisation';

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
