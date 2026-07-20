import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';

// The page uses Superforms; portal vitest skips the SvelteKit plugin, so the
// SvelteKit virtual modules Superforms imports must be mocked. enhance is a
// use: action — inert during SSR.
vi.mock('$app/forms', () => ({ enhance: () => ({}) }));
vi.mock('$app/environment', () => ({ browser: false, dev: false, building: false, version: '' }));
vi.mock('$app/navigation', () => ({
  beforeNavigate: () => {},
  goto: vi.fn(),
  invalidateAll: vi.fn(),
}));
vi.mock('$app/stores', () => ({
  page: {
    subscribe: (run: (value: unknown) => void) => {
      run({
        data: {},
        form: null,
        params: {},
        route: { id: null },
        status: 200,
        url: new URL('https://hadron.test/app'),
      });
      return () => {};
    },
  },
}));

import Page from './+page.svelte';
import { edgeDeleteSchema, edgeUpdateSchema } from './schema';

// Flow-authoring surface (#478): the edge editor for a routing edge shows the
// generated next.<index>.<label> name, the plain-English condition preview,
// and the walker-accurate firing order (fall-through + unreachable markers).

const graph = { id: 'm1', urn: 'acme.com::flows', name: 'Flows' };

const target = (id: string, loc: string, name: string) => ({
  id,
  loc,
  name,
  description: null,
  tags: [],
  memory: { id: 'm1', urn: 'acme.com::flows' },
});

const highConfidence = {
  id: 'e1',
  name: 'next.1.high',
  loc: 'classify:next-1-high:act',
  description: null,
  isRunnable: false,
  condition: { '>': [{ var: 'message.data.confidence' }, 0.8] },
  priority: 0,
  data: null,
  target: target('n2', 'act', 'Act'),
};

const host = {
  id: 'n1',
  memoryId: 'm1',
  loc: 'classify',
  name: 'Classify',
  data: { extractionSpec: [{ field: 'intent' }, { field: 'confidence', shape: 'number' }] },
  memory: { id: 'm1', urn: 'acme.com::flows', name: 'Flows' },
  outgoingEdges: [
    highConfidence,
    {
      ...highConfidence,
      id: 'e2',
      name: 'next.2',
      loc: 'classify:next-2:defer',
      condition: null,
      target: target('n3', 'defer', 'Defer'),
    },
    {
      ...highConfidence,
      id: 'e3',
      name: 'next.3',
      loc: 'classify:next-3:escalate',
      condition: { '==': [{ var: 'message.data.intent' }, 'urgent'] },
      target: target('n4', 'escalate', 'Escalate'),
    },
    {
      ...highConfidence,
      id: 'e4',
      name: 'documents',
      loc: 'classify:documents:spec',
      condition: null,
      target: target('n5', 'spec', 'Spec'),
    },
  ],
  incomingEdges: [],
};

const flowFields = [
  { path: 'message.data.confidence', label: 'confidence — extracted by “Classify” (number)' },
  { path: 'message.data.intent', label: 'intent — extracted by “Classify” (string)' },
];

async function renderPage(edge: (typeof host.outgoingEdges)[number]) {
  const form = await superValidate({
    _kind: 'updateEdge',
    name: edge.name ?? '',
    description: edge.description ?? '',
    isRunnable: edge.isRunnable ?? false,
    priority: String(edge.priority ?? 0),
    condition: JSON.stringify(edge.condition ?? null),
    data: edge.data != null ? JSON.stringify(edge.data, null, 2) : '',
  }, zod4(edgeUpdateSchema), { errors: false });
  const deleteForm = await superValidate({}, zod4(edgeDeleteSchema), { errors: false });

  return render(Page, {
    props: { data: { graph, host, edge, flowFields, form, deleteForm } as never, form: null },
  }).body;
}

describe('edge editor flow authoring (#478)', () => {
  it('shows routing mode with the generated name for a next.* edge', async () => {
    const body = await renderPage(highConfidence);
    expect(body).toContain('Flow routing edge');
    expect(body).toContain('next.1.high');
    // Order + label editors are seeded from the parsed name.
    expect(body).toMatch(/value="1"/);
    expect(body).toMatch(/value="high"/);
  });

  it('renders the plain-English preview of the edited condition', async () => {
    const body = await renderPage(highConfidence);
    expect(body).toContain('when confidence is greater than 0.8');
  });

  it('renders the firing order with fall-through and unreachable markers', async () => {
    const body = await renderPage(highConfidence);
    expect(body).toContain('Flow routing from');
    // documents edge is not a routing candidate
    expect(body).not.toContain('classify:documents:spec');
    const posHigh = body.indexOf('next.1.high');
    const posFall = body.indexOf('next.2');
    const posDead = body.indexOf('next.3');
    expect(posHigh).toBeGreaterThan(-1);
    expect(posFall).toBeGreaterThan(posHigh);
    expect(posDead).toBeGreaterThan(posFall);
    expect(body).toContain('always fires (fall-through)');
    expect(body).toContain('never reached');
  });

  it('offers the flow envelope fields in the variable picker', async () => {
    const body = await renderPage(highConfidence);
    expect(body).toContain('message.data.confidence');
    expect(body).toContain('extracted by “Classify”');
  });

  it('keeps the free-text name input for reference edges', async () => {
    const body = await renderPage(host.outgoingEdges[3]);
    expect(body).toContain('Relationship name');
    expect(body).toContain('value="documents"');
    // No generated-name line — routing mode is off for a reference edge.
    expect(body).not.toContain('Saved as');
  });
});
