import { describe, expect, it } from 'vitest';
import {
  buildConversationCanvas,
  buildConversationEdgeDetails,
  orderedStages,
} from './conversation-canvas';
import type {
  ConversationGraphEdgeInput,
  ConversationGraphNodeInput,
} from './conversation-canvas';

const nodes: ConversationGraphNodeInput[] = [
  {
    id: 'conv-a',
    loc: 'conversations:find-mentor',
    name: 'find-mentor',
    description: 'Find Mentor',
    data: {
      stageOrder: ['intro', 'match'],
      goalDescriptions: ['Help the user find a mentor', 'Answer mentorship questions'],
    },
  },
  {
    id: 'stage-a2',
    loc: 'conversations:find-mentor:match',
    name: 'match',
    data: { promptRef: 'prompts:find-mentor:match', extractionSpec: [{ field: 'memory.topic' }] },
  },
  {
    id: 'stage-a1',
    loc: 'conversations:find-mentor:intro',
    name: 'intro',
    data: { promptRef: 'prompts:find-mentor:intro' },
  },
  // Not listed in stageOrder — must land last.
  { id: 'stage-a3', loc: 'conversations:find-mentor:wrap-up', name: 'wrap-up' },
  {
    id: 'conv-setup',
    loc: 'conversations:setup',
    name: 'setup',
    data: { isSetup: true, stageOrder: [] },
  },
  { id: 'topic-1', loc: 'topics:mentorship', name: 'Mentorship' },
  // Non-graph nodes must be excluded from the canvas.
  { id: 'prompt-1', loc: 'prompts:find-mentor:intro', name: 'intro' },
  { id: 'rev-1', loc: 'revisions:auto:1', name: 'rev' },
];

const edges: ConversationGraphEdgeInput[] = [
  {
    id: 'e-detour',
    name: 'needs profile',
    sourceId: 'stage-a1',
    targetId: 'conv-setup',
    priority: 5,
    condition: null,
    data: { timing: 'on_enter', behavior: 'detour' },
  },
  {
    id: 'e-next',
    name: 'ready',
    sourceId: 'stage-a1',
    targetId: 'stage-a2',
    priority: 0,
    condition: { '==': [{ var: 'memory.name' }, 'set'] },
    data: { timing: 'on_complete', behavior: 'transition' },
  },
  // Dangling target — dropped from canvas and details.
  { id: 'e-dangling', name: 'gone', sourceId: 'stage-a1', targetId: 'missing' },
];

describe('orderedStages', () => {
  it('orders by stageOrder, appending unlisted stages by loc', () => {
    const stages = [
      { loc: 'conversations:c:zeta' },
      { loc: 'conversations:c:alpha' },
      { loc: 'conversations:c:mid' },
    ];
    expect(orderedStages(['mid', 'zeta'], stages).map((s) => s.loc)).toEqual([
      'conversations:c:mid',
      'conversations:c:zeta',
      'conversations:c:alpha',
    ]);
  });

  it('ignores stageOrder entries with no matching stage', () => {
    const stages = [{ loc: 'conversations:c:one' }];
    expect(orderedStages(['ghost', 'one'], stages).map((s) => s.loc)).toEqual([
      'conversations:c:one',
    ]);
  });
});

describe('buildConversationCanvas', () => {
  const model = buildConversationCanvas(nodes, edges);

  it('keeps only topics, conversations, and stages', () => {
    expect(model.nodes.map((n) => n.id).sort()).toEqual(
      ['conv-a', 'conv-setup', 'stage-a1', 'stage-a2', 'stage-a3', 'topic-1'].sort(),
    );
  });

  it('lists every parent before its children', () => {
    const indexOf = new Map(model.nodes.map((n, i) => [n.id, i]));
    for (const n of model.nodes) {
      if (n.parentId) expect(indexOf.get(n.parentId)!).toBeLessThan(indexOf.get(n.id)!);
    }
  });

  it('parents stages to their conversation and ranks them per stageOrder', () => {
    const byId = new Map(model.nodes.map((n) => [n.id, n]));
    expect(byId.get('stage-a1')?.parentId).toBe('conv-a');
    expect(byId.get('stage-a1')?.stageIndex).toBe(1);
    expect(byId.get('stage-a2')?.stageIndex).toBe(2);
    // Unlisted in stageOrder → after the ordered ones.
    expect(byId.get('stage-a3')?.stageIndex).toBe(3);
  });

  it('labels nodes with description over name and carries stage metadata', () => {
    const byId = new Map(model.nodes.map((n) => [n.id, n]));
    expect(byId.get('conv-a')?.label).toBe('Find Mentor');
    expect(byId.get('conv-a')?.goalCount).toBe(2);
    expect(byId.get('conv-setup')?.isSetup).toBe(true);
    expect(byId.get('stage-a2')?.extractionFields).toEqual(['memory.topic']);
    expect(byId.get('stage-a2')?.promptRef).toBe('prompts:find-mentor:match');
  });

  it('sizes a conversation group to contain its stages', () => {
    const conv = model.nodes.find((n) => n.id === 'conv-a')!;
    const stages = model.nodes.filter((n) => n.parentId === 'conv-a');
    for (const s of stages) {
      expect(s.position.x + s.width).toBeLessThanOrEqual(conv.width);
      expect(s.position.y + s.height).toBeLessThanOrEqual(conv.height);
    }
  });

  it('emits sequence edges between consecutive stages only', () => {
    const seq = model.edges.filter((e) => e.kind === 'sequence');
    expect(seq.map((e) => [e.sourceId, e.targetId])).toEqual([
      ['stage-a1', 'stage-a2'],
      ['stage-a2', 'stage-a3'],
    ]);
  });

  it('annotates rule edges with timing, detour, rank, and condition text', () => {
    const rules = new Map(model.edges.filter((e) => e.kind === 'rule').map((e) => [e.id, e]));
    expect(rules.size).toBe(2); // the dangling edge is dropped
    const next = rules.get('e-next')!;
    expect(next.isDetour).toBe(false);
    expect(next.position).toBe(1); // priority 0 ranks before priority 5
    expect(next.conditionText).toBeTruthy();
    const detour = rules.get('e-detour')!;
    expect(detour.isDetour).toBe(true);
    expect(detour.timing).toBe('on_enter');
    expect(detour.position).toBe(2);
    expect(detour.conditionText).toBeNull();
  });

  it('prefers a saved data.position over the computed slot', () => {
    const moved = buildConversationCanvas(
      [
        {
          id: 'conv-a',
          loc: 'conversations:a',
          name: 'a',
          data: { stageOrder: ['s'], position: { x: 400, y: 300 } },
        },
        { id: 'stage-s', loc: 'conversations:a:s', name: 's', data: { position: { x: 30, y: 200 } } },
      ],
      [],
    );
    const conv = moved.nodes.find((n) => n.id === 'conv-a')!;
    const stage = moved.nodes.find((n) => n.id === 'stage-s')!;
    expect(conv.position).toEqual({ x: 400, y: 300 });
    expect(stage.position).toEqual({ x: 30, y: 200 });
    // The group grows to keep the moved stage inside its extent.
    expect(conv.height).toBeGreaterThanOrEqual(200 + stage.height);
  });

  it('ignores a malformed data.position', () => {
    const model2 = buildConversationCanvas(
      [{ id: 'c', loc: 'conversations:c', name: 'c', data: { position: { x: 'nope' } } }],
      [],
    );
    expect(model2.nodes[0].position.y).toBe(0);
  });
});

describe('buildConversationEdgeDetails', () => {
  it('resolves endpoint labels and edge data, dropping dangling edges', () => {
    const details = buildConversationEdgeDetails(nodes, edges);
    expect(details.map((d) => d.id).sort()).toEqual(['e-detour', 'e-next']);
    const detour = details.find((d) => d.id === 'e-detour')!;
    expect(detour.sourceLabel).toBe('intro');
    expect(detour.targetLabel).toBe('setup');
    expect(detour.behavior).toBe('detour');
    expect(detour.timing).toBe('on_enter');
    expect(detour.priority).toBe(5);
    expect(detour.data).toEqual({ timing: 'on_enter', behavior: 'detour' });
  });
});

describe('start order on the canvas (S7, Q13/Q14/Q14a)', () => {
  const ns: ConversationGraphNodeInput[] = [
    { id: 'c-b', loc: 'conversations:b', name: 'b', seq: 2 },
    { id: 'c-a', loc: 'conversations:a', name: 'a', seq: 2 },
    { id: 'c-z', loc: 'conversations:z', name: 'z', seq: 1 },
    { id: 'c-n', loc: 'conversations:n', name: 'n', seq: null },
    { id: 'c-up', loc: 'conversations:B', name: 'B' },
    { id: 'c-s', loc: 'conversations:setup', name: 'setup', seq: 1, data: { isSetup: true } },
    { id: 'c-f', loc: 'conversations:fallback', name: 'fallback', seq: 2, data: { isFallback: true } },
  ];

  it('numbers ordinary conversations by seq, nulls last, ties by code-unit loc', () => {
    const model = buildConversationCanvas(ns, []);
    const order = model.nodes
      .filter((n) => n.kind === 'conversation' && n.startOrder != null)
      .sort((x, y) => x.startOrder! - y.startOrder!)
      .map((n) => n.loc);
    expect(order).toEqual([
      'conversations:z',
      'conversations:a',
      'conversations:b',
      'conversations:B',
      'conversations:n',
    ]);
  });

  it('gives setup and fallback conversations no start number', () => {
    const model = buildConversationCanvas(ns, []);
    const byLoc = Object.fromEntries(model.nodes.map((n) => [n.loc, n]));
    expect(byLoc['conversations:setup'].startOrder).toBeNull();
    expect(byLoc['conversations:fallback'].startOrder).toBeNull();
  });
});

describe('stage-target labels (S7, Q15)', () => {
  const ns: ConversationGraphNodeInput[] = [
    { id: 'c1', loc: 'conversations:intake', name: 'intake', description: 'Intake' },
    { id: 'c2', loc: 'conversations:wrap', name: 'wrap', description: 'Wrap up' },
    { id: 's2', loc: 'conversations:wrap:thanks', name: 'thanks', description: 'Say thanks' },
  ];

  it('labels a stage target "conversation / stage" and a conversation target with its own label', () => {
    const edges: ConversationGraphEdgeInput[] = [
      { id: 'e1', name: 'r1', sourceId: 'c1', targetId: 's2' },
      { id: 'e2', name: 'r2', sourceId: 'c1', targetId: 'c2' },
    ];
    const details = buildConversationEdgeDetails(ns, edges);
    expect(details.find((d) => d.id === 'e1')?.targetLabel).toBe('Wrap up / Say thanks');
    expect(details.find((d) => d.id === 'e2')?.targetLabel).toBe('Wrap up');
  });
});
