/**
 * #878 — skill export as ONE checkbox, driven through the mounted edit page.
 *
 * CLIENT lane because every behaviour here is an event handler writing bound
 * state that the page's recombination effect folds into the submitted
 * `propertiesJson` — none of which runs in a server render.
 *
 * What is asserted is the SUBMITTED value (the hidden `propertiesJson` and
 * `isRunnable` inputs), not the component's own state: the defect
 * this guards against is a save writing something the screen did not show.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import type { SkillCheck } from '$lib/skill-check';
import { editNodeSchema } from './schema';
import Page from './+page.svelte';

interface Seed {
  loc?: string;
  description?: string;
  isRunnable?: boolean;
  properties?: Record<string, unknown> | null;
  objectType?: string;
  schema?: Record<string, unknown> | null;
  id?: string;
  runnableBlockedBy?: string | null;
  noWriteDoor?: string | null;
  skillCheck?: SkillCheck | null;
}

async function dataFor(seed: Seed) {
  const loc = seed.loc ?? 'tasks:drive-pr-home';
  const isRunnable = seed.isRunnable ?? true;
  const properties = seed.properties ?? null;
  const node = {
    id: seed.id ?? 'n1',
    memoryId: 'mem-1',
    loc,
    name: 'Drive PR home',
    nodeType: 'task',
    alias: null,
    description: seed.description ?? null,
    abstract: null,
    content: 'Do the thing.',
    seq: null,
    tags: [],
    data: null,
    ownerRepo: null,
    objectType: seed.objectType ?? null,
    isRunnable,
    properties,
    outgoingEdges: [],
    incomingEdges: [],
    createdAt: '',
    updatedAt: '',
  };
  const form = await superValidate(
    {
      isRunnable,
      objectType: seed.objectType ?? '',
      propertiesJson: properties != null ? JSON.stringify(properties, null, 2) : '',
    },
    zod4(editNodeSchema),
    { errors: false },
  );
  return {
    node,
    graph: { id: 'mem-1', schema: seed.schema ?? null, urn: 'hrn:mem:x:m', name: 'M' },
    form,
    runnableBlockedBy: seed.runnableBlockedBy ?? null,
    noWriteDoor: seed.noWriteDoor ?? null,
    skillCheck: seed.skillCheck ?? null,
  };
}

async function mountPage(seed: Seed) {
  const props = reactiveProps({ data: await dataFor(seed) });
  return mountComponent(Page as never, props as never);
}

const submitted = (target: HTMLElement): Record<string, unknown> | null => {
  const raw = (target.querySelector('input[name=propertiesJson]') as HTMLInputElement).value;
  return raw ? JSON.parse(raw) : null;
};

function exportBox(target: HTMLElement): HTMLInputElement | null {
  const label = Array.from(target.querySelectorAll('label')).find((l) =>
    l.textContent?.includes('Export this node as a skill'),
  );
  return label?.querySelector('input[type=checkbox]') ?? null;
}

function setChecked(box: HTMLInputElement, checked: boolean) {
  box.checked = checked;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

/** The submitted Runnable value — a hidden input since #878 moved the checkbox to Settings. */
const submittedRunnable = (target: HTMLElement) =>
  (target.querySelector('input[name=isRunnable]') as HTMLInputElement).value;

const buttonNamed = (target: HTMLElement, text: string) =>
  Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) ?? null;

beforeEach(() => {
  resetNavigationGuards();
  setStubPage('https://example.test/app/memories/mem-1/nodes/n1/edit', { id: 'mem-1', nodeId: 'n1' });
});

describe('checking the box', () => {
  it('writes BOTH hosts, on, with defaults from the node', async () => {
    const m = await mountPage({ description: 'Take a PR to merge. Use when asked.' });
    try {
      expect(submitted(m.target)).toBeNull();
      setChecked(exportBox(m.target)!, true);
      const expected = { name: 'drive-pr-home', description: 'Take a PR to merge. Use when asked.', enable: true };
      expect(submitted(m.target)).toEqual({ exports: { claudeSkill: expected, codexSkill: expected } });
    } finally {
      m.unmount();
    }
  });

  it('marks the node Runnable, which the server requires of a skill', async () => {
    // Reachable on a non-runnable node because an existing declaration keeps
    // the section visible.
    const m = await mountPage({
      isRunnable: false,
      properties: { exports: { claudeSkill: { name: 'kept', description: 'd', enable: false } } },
    });
    try {
      expect(submittedRunnable(m.target)).toBe('false');
      setChecked(exportBox(m.target)!, true);
      expect(submittedRunnable(m.target)).toBe('true');
      const kept = { name: 'kept', description: 'd', enable: true };
      expect(submitted(m.target)).toEqual({ exports: { claudeSkill: kept, codexSkill: kept } });
    } finally {
      m.unmount();
    }
  });

  it('unchecking switches both hosts off and keeps the name', async () => {
    const m = await mountPage({ description: 'x' });
    try {
      const box = exportBox(m.target)!;
      setChecked(box, true);
      setChecked(box, false);
      const off = { name: 'drive-pr-home', description: 'x', enable: false };
      expect(submitted(m.target)).toEqual({ exports: { claudeSkill: off, codexSkill: off } });
    } finally {
      m.unmount();
    }
  });

  it('"Clear skill export" removes both hosts', async () => {
    const m = await mountPage({ description: 'x', properties: { keep: 1 } });
    try {
      setChecked(exportBox(m.target)!, true);
      buttonNamed(m.target, 'Clear skill export')!.click();
      flushSync();
      expect(submitted(m.target)).toEqual({ keep: 1 });
    } finally {
      m.unmount();
    }
  });
});

describe('a Claude-only declaration written before #878', () => {
  const claudeOnly = {
    exports: { claudeSkill: { name: 'old-skill', description: 'Old. Use when.', enable: true } },
  };

  it('is NOT widened to Codex by merely opening the page', async () => {
    // A save of an untouched node must submit exactly what is stored — adding
    // a host nobody asked for is a silent write.
    const m = await mountPage({ properties: claudeOnly });
    try {
      expect(exportBox(m.target)!.checked).toBe(true);
      expect(submitted(m.target)).toEqual(claudeOnly);
    } finally {
      m.unmount();
    }
  });

  it('gains Codex on an explicit click', async () => {
    const m = await mountPage({ properties: claudeOnly });
    try {
      buttonNamed(m.target, 'Also export for Codex')!.click();
      flushSync();
      const d = claudeOnly.exports.claudeSkill;
      expect(submitted(m.target)).toEqual({ exports: { claudeSkill: d, codexSkill: d } });
      expect(buttonNamed(m.target, 'Also export for Codex')).toBeNull();
    } finally {
      m.unmount();
    }
  });
});

describe('host entries that disagree', () => {
  const divergent = {
    exports: {
      claudeSkill: { name: 'a', description: 'a', enable: true },
      codexSkill: { name: 'b', description: 'b', enable: false },
    },
  };

  it('are left verbatim and not offered as one checkbox', async () => {
    // Writing ONE declaration back would overwrite the other host with values
    // the user never saw.
    const m = await mountPage({ properties: divergent });
    try {
      expect(exportBox(m.target)).toBeNull();
      expect(m.target.textContent).toContain('can’t be edited with the checkbox');
      expect(submitted(m.target)).toEqual(divergent);
    } finally {
      m.unmount();
    }
  });
});

describe('where the divergence note sends the user', () => {
  const divergent = {
    exports: {
      claudeSkill: { name: 'a', description: 'a', enable: true },
      codexSkill: { name: 'b', description: 'b', enable: false },
    },
  };
  const POINTER = 'Structured storage → Properties';

  it('points at the raw JSON editor when there is one', async () => {
    const m = await mountPage({ properties: divergent });
    try {
      expect(m.target.textContent).toContain(POINTER);
      expect(m.target.querySelector('textarea#properties')).not.toBeNull();
    } finally {
      m.unmount();
    }
  });

  it('does NOT point there for a declared collection, where `exports` is read-only', async () => {
    const m = await mountPage({
      properties: divergent,
      objectType: 'competitor',
      schema: { objectTypes: { competitor: { fields: { stage: { type: 'text' } } } } },
    });
    try {
      expect(m.target.textContent).toContain('can’t be edited with the checkbox');
      expect(m.target.querySelector('textarea#properties')).toBeNull();
      expect(m.target.textContent).not.toContain(POINTER);
    } finally {
      m.unmount();
    }
  });
});

describe('#878 — the edit page carries only what has no tab of its own', () => {
  const sections = (target: HTMLElement) =>
    Array.from(target.querySelectorAll('form details')).filter(
      (d) => d.parentElement?.tagName === 'FORM',
    ) as HTMLDetailsElement[];

  it('shows Structured storage and Skill export, both closed', async () => {
    // Metadata, Edges, Abstract and Content each have a tab on the node page.
    const m = await mountPage({ description: 'x' });
    try {
      const all = sections(m.target);
      expect(all.map((d) => d.querySelector('summary')?.textContent?.trim())).toEqual([
        'Structured storage',
        'Skill export',
      ]);
      expect(all.every((d) => !d.open)).toBe(true);
      // And none of the retired fields is still posted.
      for (const name of ['name', 'loc', 'description', 'content', 'abstract', 'edges', 'tags', 'seq']) {
        expect(m.target.querySelector(`[name=${name}]`), name).toBeNull();
      }
    } finally {
      m.unmount();
    }
  });

  it('opens Structured storage when the properties go invalid', async () => {
    const m = await mountPage({ description: 'x' });
    try {
      const storage = sections(m.target)[0];
      expect(storage.open).toBe(false);
      const raw = m.target.querySelector('textarea#properties') as HTMLTextAreaElement;
      raw.value = '{ not json';
      raw.dispatchEvent(new Event('input', { bubbles: true }));
      flushSync();
      expect(storage.open).toBe(true);
    } finally {
      m.unmount();
    }
  });
});

describe('the Skill export section opens itself when it holds a problem (@codex on #887)', () => {
  const skillSection = (target: HTMLElement) =>
    Array.from(target.querySelectorAll('form > details')).find((d) =>
      d.querySelector('summary')?.textContent?.includes('Skill export'),
    ) as HTMLDetailsElement;
  const on = (over: Record<string, unknown>) => ({
    exports: { claudeSkill: { name: 'good-name', description: 'd', enable: true, ...over } },
  });

  it.each([
    ['an invalid name', on({ name: 'Not Valid' })],
    ['a missing description', on({ description: '' })],
    ['host entries that disagree', { exports: { claudeSkill: { name: 'a' }, codexSkill: { name: 'b' } } }],
  ])('opens for %s', async (_what, properties) => {
    const m = await mountPage({ properties });
    try {
      expect(skillSection(m.target).open).toBe(true);
    } finally {
      m.unmount();
    }
  });

  it('stays closed for a valid declaration', async () => {
    const m = await mountPage({ properties: on({}) });
    try {
      expect(skillSection(m.target).open).toBe(false);
    } finally {
      m.unmount();
    }
  });

  it('opens for an enabled export on a node that is not runnable', async () => {
    const m = await mountPage({ isRunnable: false, properties: on({}) });
    try {
      expect(skillSection(m.target).open).toBe(true);
    } finally {
      m.unmount();
    }
  });
});

describe('an enabled export on a node that is not runnable (@copilot on #887)', () => {
  const on = { exports: { claudeSkill: { name: 'ok-name', description: 'd', enable: true } } };

  it('offers a button that marks the node runnable, instead of naming a control this page lacks', async () => {
    const m = await mountPage({ isRunnable: false, properties: on });
    try {
      expect(m.target.textContent).not.toContain('Is Runnable');
      const button = buttonNamed(m.target, 'Mark this node runnable');
      expect(button).not.toBeNull();
      expect(submittedRunnable(m.target)).toBe('false');
      button!.click();
      flushSync();
      expect(submittedRunnable(m.target)).toBe('true');
      expect(buttonNamed(m.target, 'Mark this node runnable')).toBeNull();
    } finally {
      m.unmount();
    }
  });

  it('does not offer it on a runnable node', async () => {
    const m = await mountPage({ isRunnable: true, properties: on });
    try {
      expect(buttonNamed(m.target, 'Mark this node runnable')).toBeNull();
    } finally {
      m.unmount();
    }
  });
});

describe('a node the portal cannot make runnable (@copilot on #887)', () => {
  // A `review` or `spec` node that became runnable would match two governed
  // kinds, and the save has no single write door for that. The page must not
  // offer a fix the save rejects.
  const on = { exports: { claudeSkill: { name: 'ok-name', description: 'd', enable: true } } };

  it('explains instead of offering "Mark this node runnable"', async () => {
    const m = await mountPage({ isRunnable: false, properties: on, runnableBlockedBy: 'review' });
    try {
      expect(buttonNamed(m.target, 'Mark this node runnable')).toBeNull();
      expect(m.target.textContent).toContain('can’t make a review node runnable');
    } finally {
      m.unmount();
    }
  });

  it('cannot switch an OFF export on — that would save one the exporter rejects (@codex on #887)', async () => {
    const off = { exports: { claudeSkill: { name: 'ok-name', description: 'd', enable: false } } };
    const m = await mountPage({ isRunnable: false, properties: off, runnableBlockedBy: 'spec' });
    try {
      const box = exportBox(m.target)!;
      expect(box.disabled).toBe(true);
      expect(box.getAttribute('aria-describedby')).toBe('skill-export-runnable-blocked');
      expect(m.target.querySelector('#skill-export-runnable-blocked')?.textContent).toContain('spec node');
      // Even if a change event arrives anyway, nothing is enabled or made runnable.
      setChecked(box, true);
      expect(submitted(m.target)).toEqual(off);
      expect(submittedRunnable(m.target)).toBe('false');
    } finally {
      m.unmount();
    }
  });

  it('can still switch an enabled export OFF', async () => {
    const m = await mountPage({ isRunnable: false, properties: on, runnableBlockedBy: 'review' });
    try {
      const box = exportBox(m.target)!;
      expect(box.disabled).toBe(false);
      setChecked(box, false);
      const off = { name: 'ok-name', description: 'd', enable: false };
      expect(submitted(m.target)).toEqual({ exports: { claudeSkill: off } });
    } finally {
      m.unmount();
    }
  });
});

describe('section state on a node-to-node navigation (@copilot on #887)', () => {
  const skillSection = (target: HTMLElement) =>
    Array.from(target.querySelectorAll('form > details')).find((d) =>
      d.querySelector('summary')?.textContent?.includes('Skill export'),
    ) as HTMLDetailsElement;
  const broken = { exports: { claudeSkill: { name: 'Not Valid', description: 'd', enable: true } } };
  const valid = { exports: { claudeSkill: { name: 'fine', description: 'd', enable: true } } };

  it('node B starts collapsed even though node A had its section open', async () => {
    const m = await mountPage({ id: 'a', properties: broken });
    try {
      expect(skillSection(m.target).open).toBe(true);
      (m.props as { data: unknown }).data = await dataFor({ id: 'b', properties: valid });
      flushSync();
      expect(skillSection(m.target).open).toBe(false);
    } finally {
      m.unmount();
    }
  });

  it('node B re-opens for its OWN error when A had one too', async () => {
    // The attention value is true on both sides, so an effect that did not
    // also depend on the node would not re-run after the reset.
    const m = await mountPage({ id: 'a', properties: broken });
    try {
      (m.props as { data: unknown }).data = await dataFor({ id: 'b', properties: broken });
      flushSync();
      expect(skillSection(m.target).open).toBe(true);
    } finally {
      m.unmount();
    }
  });
});

describe('a host entry carrying a field this form does not edit (@copilot on #887)', () => {
  it('is left verbatim — an untouched Save must not drop the extra key', async () => {
    const withExtra = {
      exports: { claudeSkill: { name: 'n', description: 'd', enable: true, arguments: ['x'] } },
    };
    const m = await mountPage({ properties: withExtra });
    try {
      expect(exportBox(m.target)).toBeNull();
      expect(m.target.textContent).toContain('carry fields this form doesn’t edit');
      expect(submitted(m.target)).toEqual(withExtra);
    } finally {
      m.unmount();
    }
  });
});

describe('the editor’s own panel on a node-to-node navigation (@copilot on #887)', () => {
  it('node B starts with "Change the skill’s name and description" closed', async () => {
    const decl = (name: string) => ({ exports: { claudeSkill: { name, description: 'd', enable: true } } });
    const panel = (target: HTMLElement) =>
      Array.from(target.querySelectorAll('details')).find((d) =>
        d.querySelector('summary')?.textContent?.includes('name and description'),
      ) as HTMLDetailsElement;
    const m = await mountPage({ id: 'a', properties: decl('from-a') });
    try {
      panel(m.target).open = true;
      panel(m.target).dispatchEvent(new Event('toggle'));
      flushSync();
      expect(panel(m.target).open).toBe(true);
      (m.props as { data: unknown }).data = await dataFor({ id: 'b', properties: decl('from-b') });
      flushSync();
      expect(panel(m.target).open).toBe(false);
    } finally {
      m.unmount();
    }
  });
});

describe('the superForm fields on a node-to-node navigation (@codex on #887)', () => {
  it('node B gets its OWN objectType and isRunnable, not node A’s', async () => {
    // A is a runnable `thing`; B is an ordinary untyped node. Before the fix
    // B rendered A's object type and posted A's isRunnable: true.
    const m = await mountPage({ id: 'a', objectType: 'thing', isRunnable: true });
    try {
      const objectType = () => (m.target.querySelector('#objectType') as HTMLInputElement).value;
      expect(objectType()).toBe('thing');
      expect(submittedRunnable(m.target)).toBe('true');

      (m.props as { data: unknown }).data = await dataFor({ id: 'b', isRunnable: false });
      flushSync();

      expect(objectType()).toBe('');
      expect(submittedRunnable(m.target)).toBe('false');
    } finally {
      m.unmount();
    }
  });
});

describe('a node with no write path at all (@copilot on #887)', () => {
  const saveButton = (target: HTMLElement) =>
    target.querySelector('button[type=submit]') as HTMLButtonElement;

  it('says why and disables Save', async () => {
    const reason = 'This node is both task and review, and the platform has no single write path for that combination.';
    const m = await mountPage({ noWriteDoor: reason });
    try {
      expect(m.target.querySelector('#no-write-door')?.textContent).toContain('no single write path');
      expect(saveButton(m.target).disabled).toBe(true);
      expect(saveButton(m.target).getAttribute('aria-describedby')).toBe('no-write-door');
    } finally {
      m.unmount();
    }
  });

  it('leaves Save enabled on an ordinary node', async () => {
    const m = await mountPage({});
    try {
      expect(m.target.querySelector('#no-write-door')).toBeNull();
      expect(saveButton(m.target).disabled).toBe(false);
    } finally {
      m.unmount();
    }
  });
});

describe('a node of a STRICT collection (@copilot on #887)', () => {
  // The server rejects any property key a strict collection does not declare
  // (validateNodeAgainstSchema), so `exports` there can only fail to save.
  const schema = (strict: boolean, fields: Record<string, unknown> = { stage: { type: 'text' } }) => ({
    objectTypes: { competitor: { strict, fields } },
  });

  it('cannot switch the export on, and says why', async () => {
    const m = await mountPage({ objectType: 'competitor', schema: schema(true) });
    try {
      const box = exportBox(m.target)!;
      expect(box.disabled).toBe(true);
      expect(box.getAttribute('aria-describedby')).toBe('skill-export-strict');
      expect(m.target.querySelector('#skill-export-strict')?.textContent).toContain('competitor, doesn’t allow an exports object');
      setChecked(box, true);
      expect(submitted(m.target)).toBeNull();
    } finally {
      m.unmount();
    }
  });

  it('is unaffected by a NON-strict collection', async () => {
    const m = await mountPage({ objectType: 'competitor', schema: schema(false) });
    try {
      expect(exportBox(m.target)!.disabled).toBe(false);
      expect(m.target.querySelector('#skill-export-strict')).toBeNull();
    } finally {
      m.unmount();
    }
  });

  it.each([
    ['a strict collection', true],
    ['a NON-strict collection', false],
  ])('is ALSO blocked when %s declares an exports field (@codex on #887)', async (_what, strict) => {
    // No schema field type accepts an object, so a declared `exports` field
    // type-checks the export and rejects it — strict or not.
    const m = await mountPage({
      objectType: 'competitor',
      schema: schema(strict, { stage: { type: 'text' }, exports: { type: 'text' } }),
    });
    try {
      expect(exportBox(m.target)!.disabled).toBe(true);
    } finally {
      m.unmount();
    }
  });
});

describe('an export already stored on a collection that cannot hold it (@copilot on #887)', () => {
  const strict = { objectTypes: { competitor: { strict: true, fields: { stage: { type: 'text' } } } } };
  const stored = { exports: { claudeSkill: { name: 'n', description: 'd', enable: true } } };
  const section = (target: HTMLElement) =>
    Array.from(target.querySelectorAll('form > details')).find((d) =>
      d.querySelector('summary')?.textContent?.includes('Skill export'),
    ) as HTMLDetailsElement;

  it('opens the section, disables the box both ways, and offers Clear — which removes the key', async () => {
    const m = await mountPage({ objectType: 'competitor', schema: strict, properties: stored });
    try {
      expect(section(m.target).open).toBe(true);
      // Switching OFF would still submit `exports`, which the collection rejects.
      expect(exportBox(m.target)!.disabled).toBe(true);
      buttonNamed(m.target, 'Clear skill export')!.click();
      flushSync();
      expect(submitted(m.target)).toBeNull();
    } finally {
      m.unmount();
    }
  });

  it('stays collapsed when there is no export to act on', async () => {
    const m = await mountPage({ objectType: 'competitor', schema: strict });
    try {
      expect(section(m.target).open).toBe(false);
    } finally {
      m.unmount();
    }
  });
});

// ── #882: the server's verdict, not the portal's prediction ────────────────

describe('#882 — the Skill export section shows the SERVER\'s verdict on the saved node', () => {
  const on = { name: 'drive-pr-home', description: 'Take a PR home.', enable: true };
  const stored = { exports: { claudeSkill: on, codexSkill: on } };
  const both = (check: Record<string, unknown>): SkillCheck => ({
    kind: 'checked',
    hosts: [
      { host: 'claudeSkill', ...check } as never,
      { host: 'codexSkill', ...check } as never,
    ],
  });
  const verdict = (t: HTMLElement) => t.querySelector('[data-testid="skill-server-check"]')?.textContent ?? null;

  it('an export that is ON but fails the server\'s lint says the server WON\'T export it, in the server\'s words', async () => {
    const m = await mountPage({
      properties: stored,
      skillCheck: both({ status: 'judged', off: false, errors: ['skill name "Create Release Tag!" is invalid'], warnings: [] }),
    });
    try {
      const v = verdict(m.target)!;
      expect(v).toContain('As saved, the server won’t export this for Claude and Codex:');
      expect(v).toContain('skill name "Create Release Tag!" is invalid');
      // The defect: an outcome claimed beside the refusal. Neither may appear.
      expect(v).not.toContain('checks pass');
      expect(m.target.textContent).not.toContain('Exported as');
      expect(m.target.textContent).toContain('Set to export as');
    } finally {
      m.unmount();
    }
  });

  it('labels warnings as NOT blocking, so they do not read as reasons for the refusal', async () => {
    const m = await mountPage({
      properties: stored,
      skillCheck: both({ status: 'judged', off: false, errors: ['name is invalid'], warnings: ['description never says "Use when"'] }),
    });
    try {
      const v = verdict(m.target)!;
      const refusal = v.indexOf('won’t export this');
      const label = v.indexOf('Worth fixing, though it doesn’t stop the export (Claude and Codex):');
      const warning = v.indexOf('description never says "Use when"');
      expect(refusal).toBeGreaterThanOrEqual(0);
      // The warning sits under its own label, after the refusal's reasons.
      expect(label).toBeGreaterThan(refusal);
      expect(warning).toBeGreaterThan(label);
    } finally {
      m.unmount();
    }
  });

  it('says the checks pass only when the server found no error', async () => {
    const m = await mountPage({ properties: stored, skillCheck: both({ status: 'judged', off: false, errors: [], warnings: [] }) });
    try {
      expect(verdict(m.target)).toContain('As saved, the server’s checks pass for Claude and Codex.');
    } finally {
      m.unmount();
    }
  });

  it('names a check that could not run, instead of implying it passed', async () => {
    const m = await mountPage({
      properties: stored,
      skillCheck: both({ status: 'unavailable', detail: 'plan exploded' }),
    });
    try {
      const v = verdict(m.target)!;
      expect(v).toContain('Couldn’t get the server’s check for Claude and Codex: plan exploded');
      expect(v).not.toContain('checks pass');
    } finally {
      m.unmount();
    }
  });

  it('says so once the form differs from what the server judged — and not before', async () => {
    const m = await mountPage({ properties: stored, skillCheck: both({ status: 'judged', off: false, errors: [], warnings: [] }) });
    try {
      // Positive control: the verdict renders, and says nothing about unsaved changes.
      expect(verdict(m.target)).toContain('checks pass');
      expect(verdict(m.target)).not.toContain('unsaved changes');
      // Any edit to the export makes the form differ from the node the server judged.
      const name = m.target.querySelector<HTMLInputElement>('#skill-export-name')!;
      name.value = 'renamed-skill';
      name.dispatchEvent(new Event('input', { bubbles: true }));
      flushSync();
      expect(verdict(m.target)).toContain('You have unsaved changes. The server checks the export when you save.');
    } finally {
      m.unmount();
    }
  });
});

describe('#905 review — the verdict is not tied to the checkbox\'s current value', () => {
  const on = { name: 'drive-pr-home', description: 'Take a PR home.', enable: true };
  const divergent = { exports: { claudeSkill: { ...on, name: 'a' }, codexSkill: { ...on, name: 'b', enable: false } } };
  const errorsFor = (msg: string): SkillCheck => ({
    kind: 'checked',
    hosts: [
      { host: 'claudeSkill', status: 'judged', off: false, errors: [msg], warnings: [] },
      { host: 'codexSkill', status: 'judged', off: true, errors: [], warnings: [] },
    ],
  });
  const pass: SkillCheck = {
    kind: 'checked',
    hosts: [{ host: 'claudeSkill', status: 'judged', off: false, errors: [], warnings: [] }],
  };
  const verdict = (t: HTMLElement) => t.querySelector('[data-testid="skill-server-check"]')?.textContent ?? null;

  it('a DIVERGENT stored export still shows the server\'s verdict (@codex on #905)', async () => {
    const m = await mountPage({ properties: divergent, skillCheck: errorsFor('name "a" is too short for Claude') });
    try {
      expect(exportBox(m.target)).toBeNull(); // still the divergent branch
      expect(verdict(m.target)).toContain('As saved, the server won’t export this for Claude:');
      expect(verdict(m.target)).toContain('name "a" is too short for Claude');
    } finally {
      m.unmount();
    }
  });

  it('after Clear, the verdict stays — flagged as describing the saved node — even on a node that is not runnable (@copilot on #905)', async () => {
    const m = await mountPage({ isRunnable: false, properties: { exports: { claudeSkill: on } }, skillCheck: pass });
    try {
      expect(verdict(m.target)).not.toContain('unsaved changes');
      const clear = buttonNamed(m.target, 'Clear skill export')!;
      clear.click();
      flushSync();
      expect(submitted(m.target)).toBeNull(); // the export really is cleared in the form
      const v = verdict(m.target);
      expect(v).toContain('As saved, the server’s checks pass for Claude.');
      expect(v).toContain('You have unsaved changes. The server checks the export when you save.');
    } finally {
      m.unmount();
    }
  });

  it('a RAW edit to a divergent export counts as unsaved (@copilot on #905)', async () => {
    const m = await mountPage({ properties: divergent, skillCheck: errorsFor('x') });
    try {
      expect(verdict(m.target)).not.toContain('unsaved changes');
      const raw = m.target.querySelector('textarea#properties') as HTMLTextAreaElement;
      const bag = JSON.parse(raw.value);
      bag.exports.codexSkill.name = 'renamed';
      raw.value = JSON.stringify(bag, null, 2);
      raw.dispatchEvent(new Event('input', { bubbles: true }));
      flushSync();
      expect(verdict(m.target)).toContain('You have unsaved changes.');
    } finally {
      m.unmount();
    }
  });

  it('re-ordering stored keys is NOT an unsaved change — the comparison is canonical', async () => {
    // Stored codexSkill-first; the form re-serialises claudeSkill-first.
    const m = await mountPage({ properties: { exports: { codexSkill: on, claudeSkill: on } }, skillCheck: pass });
    try {
      expect(verdict(m.target)).toContain('checks pass');
      expect(verdict(m.target)).not.toContain('unsaved changes');
    } finally {
      m.unmount();
    }
  });
});

describe('#905 review — the section opens for a refusal only the server can see (@codex)', () => {
  // A declaration the client's own checks pass: valid name, a "Use when"
  // description, a runnable node. Only the server knows it collides.
  const valid = { name: 'drive-pr-home', description: 'Take a PR home. Use when asked to merge.', enable: true };
  const skillSection = (t: HTMLElement) =>
    Array.from(t.querySelectorAll('details')).find((d) => d.querySelector('summary')?.textContent?.includes('Skill export'))!;

  it('opens when the server refuses an export the client thinks is fine', async () => {
    const m = await mountPage({
      properties: { exports: { claudeSkill: valid } },
      skillCheck: {
        kind: 'checked',
        hosts: [{ host: 'claudeSkill', status: 'judged', off: false, errors: ['skill name "drive-pr-home" is also declared by another node'], warnings: [] }],
      },
    });
    try {
      flushSync();
      expect(skillSection(m.target).open).toBe(true);
    } finally {
      m.unmount();
    }
  });

  it('stays closed when the server passes it — the positive control', async () => {
    const m = await mountPage({
      properties: { exports: { claudeSkill: valid } },
      skillCheck: { kind: 'checked', hosts: [{ host: 'claudeSkill', status: 'judged', off: false, errors: [], warnings: [] }] },
    });
    try {
      flushSync();
      expect(skillSection(m.target).open).toBe(false);
    } finally {
      m.unmount();
    }
  });
});

describe('#905 review — a retired top-level declaration goes to the raw editor (@codex)', () => {
  const legacy = { name: 'drive-pr-home', description: 'Take a PR home. Use when asked.', enable: true };
  const pass: SkillCheck = {
    kind: 'checked',
    hosts: [{ host: 'claudeSkill', status: 'judged', off: false, errors: [], warnings: [] }],
  };
  const verdict = (t: HTMLElement) => t.querySelector('[data-testid="skill-server-check"]')?.textContent ?? null;

  it('offers NO checkbox for a legacy-only export on a non-runnable node, says why, and shows its verdict', async () => {
    const m = await mountPage({ isRunnable: false, properties: { skill: legacy }, skillCheck: pass });
    try {
      expect(exportBox(m.target)).toBeNull();
      expect(m.target.textContent).toContain('older top-level “skill” or “claudeSkill” setting');
      expect(verdict(m.target)).toContain('As saved, the server’s checks pass for Claude.');
    } finally {
      m.unmount();
    }
  });

  it('round-trips a bag with BOTH a legacy key and modern hosts, dropping nothing', async () => {
    const stored = { claudeSkill: legacy, exports: { codexSkill: legacy }, url: 'kept' };
    const m = await mountPage({ properties: stored, skillCheck: pass });
    try {
      expect(exportBox(m.target)).toBeNull();
      expect(submitted(m.target)).toEqual(stored);
      expect(verdict(m.target)).not.toContain('unsaved changes');
    } finally {
      m.unmount();
    }
  });

  it('a raw edit to the legacy key counts as unsaved', async () => {
    const m = await mountPage({ properties: { skill: legacy }, skillCheck: pass });
    try {
      expect(verdict(m.target)).not.toContain('unsaved changes');
      const raw = m.target.querySelector('textarea#properties') as HTMLTextAreaElement;
      const bag = JSON.parse(raw.value);
      bag.skill.enable = false;
      raw.value = JSON.stringify(bag, null, 2);
      raw.dispatchEvent(new Event('input', { bubbles: true }));
      flushSync();
      expect(verdict(m.target)).toContain('You have unsaved changes.');
    } finally {
      m.unmount();
    }
  });
});
