/**
 * portal#1380 Slice 1 (diagnostic, no behaviour change): where does a memory's
 * first entry spend its cost?
 *
 * Runs the REAL `/app/memories/[id]` layout `load` against a synthetic memory
 * of N nodes served by a stub GraphQL client, then reports what the portal
 * itself pays for it: how many graph pages the layout drains, how long the
 * projection builds take, and how many bytes each returned key serializes to
 * (devalue `uneval` is what SvelteKit inlines into the HTML; JSON is the
 * independent cross-check).
 *
 *   HADRON_PROFILE_MEMORY_ENTRY=1 pnpm vitest run --project node scripts/profile-memory-entry-layout
 *   HADRON_PROFILE_NODES=32920 sets the size (default: 1000, 8000, 32920)
 *
 * Without the env var only the positive control below runs, so a plain
 * `pnpm test` stays fast. WHAT THIS CANNOT SEE: hadron-server's database and
 * resolver time per page, and network transfer. The stub answers instantly, so
 * "fetch" here is the portal's own paging loop and nothing else. The response
 * bytes per query are reported as the input to that cost, not as a timing.
 */
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { brotliCompressSync, constants as zc, gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MEMORY_BY_ID_QUERY,
  SELF_CAN_WRITE_QUERY,
  MEMORY_NODES_QUERY,
  MEMORY_EDGES_QUERY,
  MEMORY_USAGE_SUMMARY_QUERY,
  ORGANIZATION_QUERY,
} from '$lib/server/queries';
import { buildGraphViewData, buildTreeEntries } from '$lib/graph-utils';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

// SvelteKit's own serializer, resolved from SvelteKit so a strict pnpm layout
// does not hide it.
const requireFromKit = createRequire(join(realpathSync(resolve(process.cwd(), 'node_modules/@sveltejs/kit')), 'package.json'));
const devalue = requireFromKit('devalue') as { uneval: (v: unknown) => string; stringify: (v: unknown) => string };

// --- deterministic synthetic memory ---------------------------------------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const WORDS = ['plan', 'finding', 'incident', 'review', 'spec', 'task', 'note', 'design', 'runbook', 'metric', 'decision', 'access', 'node', 'graph', 'usage'];
const hex = (r: () => number, n: number) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('');
const uuid = (r: () => number) => `${hex(r, 8)}-${hex(r, 4)}-${hex(r, 4)}-${hex(r, 4)}-${hex(r, 12)}`;

type Shape = { edgesPerNode: number; usageShare: number; descChars: number };
// Calibrated against Cloe's production key sizes (see the profile node); the
// calibration run prints the ratio so a drifting fixture is visible.
export const DEFAULT_SHAPE: Shape = { edgesPerNode: 0.7, usageShare: 0.9, descChars: 30 };

export function synthMemory(nodeCount: number, shape: Shape = DEFAULT_SHAPE, seed = 1380) {
  const r = rng(seed);
  const memoryId = uuid(r);
  const memoryUrn = 'hrn:mem:example.test:large';
  const nodes: Array<Record<string, unknown>> = [];
  const locs: string[] = [];
  // A tree of folders: branching ~12, depth up to 4, leaves carry the rest.
  for (let i = 0; i < nodeCount; i++) {
    const depth = 1 + Math.floor(r() * 3);
    const parts: string[] = [];
    for (let d = 0; d < depth; d++) parts.push(`${WORDS[Math.floor(r() * WORDS.length)].slice(0, 4)}${Math.floor(r() * 12)}`);
    const loc = `${parts.join(':')}:n${i}`;
    locs.push(loc);
    nodes.push({
      id: uuid(r),
      loc,
      name: `${WORDS[Math.floor(r() * WORDS.length)]} ${WORDS[Math.floor(r() * WORDS.length)]} ${i}`,
      nodeType: r() < 0.9 ? 'info' : 'reference',
      tags: Array.from({ length: Math.floor(r() * 4) }, () => WORDS[Math.floor(r() * WORDS.length)]),
      seq: r() < 0.5 ? Math.floor(r() * 100) : null,
      isRunnable: r() < 0.02 ? true : null,
      description: r() < 0.8 ? 'x'.repeat(shape.descChars - 10 + Math.floor(r() * 20)) : null,
      openThreads: r() < 0.03 ? 1 : 0,
    });
  }
  const edges: Array<Record<string, unknown>> = [];
  const edgeCount = Math.round(nodeCount * shape.edgesPerNode);
  for (let i = 0; i < edgeCount; i++) {
    const s = nodes[Math.floor(r() * nodeCount)];
    const t = nodes[Math.floor(r() * nodeCount)];
    edges.push({ id: uuid(r), loc: `${s.loc}:related:${t.loc}`, name: 'related', sourceId: s.id, targetId: t.id });
  }
  const usage: Array<{ nodeLoc: string; type: string; count: number }> = [];
  for (const loc of locs) {
    if (r() >= shape.usageShare) continue;
    usage.push({ nodeLoc: loc, type: 'read', count: 1 + Math.floor(r() * 40) });
    if (r() < 0.6) usage.push({ nodeLoc: loc, type: 'write', count: 1 + Math.floor(r() * 5) });
    if (r() < 0.5) usage.push({ nodeLoc: loc, type: 'search', count: 1 + Math.floor(r() * 9) });
    if (r() < 0.5) usage.push({ nodeLoc: loc, type: 'list', count: 1 + Math.floor(r() * 9) });
  }
  const memory = {
    id: memoryId,
    urn: memoryUrn,
    name: 'Large',
    organizationId: 'org-1',
  };
  return { memory, nodes, edges, usage };
}

// The server clamps a page to 2000 rows, like production (GRAPH_PAGE).
const SERVER_PAGE = 2000;

type QueryStat = { calls: number; responseBytes: number };

// `countBytes` is off during the timed loads: JSON.stringify per response is
// instrumentation the real client's returned-object path does not pay, so it
// runs only in a separate, untimed load.
function serve(world: ReturnType<typeof synthMemory>, stats: Map<string, QueryStat>, opts: { countBytes: boolean }) {
  const note = (name: string, payload: unknown) => {
    const s = stats.get(name) ?? { calls: 0, responseBytes: 0 };
    s.calls += 1;
    if (opts.countBytes) s.responseBytes += JSON.stringify(payload).length;
    stats.set(name, s);
    return payload;
  };
  mockRequest.mockImplementation(async (query: string, vars: Record<string, unknown>) => {
    const limit = Math.min(Number(vars?.limit ?? 1000), SERVER_PAGE);
    const offset = Number(vars?.offset ?? 0);
    if (query === MEMORY_BY_ID_QUERY) return note('memory', { memory: world.memory });
    if (query === SELF_CAN_WRITE_QUERY) return note('canWrite', { effectiveAccess: { canWrite: true } });
    if (query === ORGANIZATION_QUERY) return note('organization', { organization: null });
    if (query === MEMORY_USAGE_SUMMARY_QUERY) return note('usage', { memoryUsageSummary: world.usage });
    if (query === MEMORY_NODES_QUERY) {
      return note('memoryNodes', { memoryNodes: { nodes: world.nodes.slice(offset, offset + limit), total: world.nodes.length } });
    }
    if (query === MEMORY_EDGES_QUERY) {
      return note('memoryEdges', { memoryEdges: { edges: world.edges.slice(offset, offset + limit), total: world.edges.length } });
    }
    throw new Error(`unexpected query in profile stub: ${String(query).slice(0, 60)}`);
  });
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const KEYS = ['org', 'graph', 'canWriteMemory', 'graphNodes', 'nodesTotal', 'nodesFailed', 'treeEntries', 'graphViewData', 'usageByNode'] as const;

export async function profile(nodeCount: number, runs = 3) {
  const world = synthMemory(nodeCount);
  const stats = new Map<string, QueryStat>();
  const opts = { countBytes: false };
  serve(world, stats, opts);
  const { load } = await import('../src/routes/app/memories/[id]/+layout.server');
  const event = { params: { id: world.memory.id }, locals: { token: 't', user: { id: 'u' } } } as never;

  await load(event); // warm-up: JIT and module init are not the cost being measured
  stats.clear();
  mockRequest.mockClear();

  const loadMs: number[] = [];
  let result: Record<string, unknown> = {};
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    result = (await load(event)) as Record<string, unknown>;
    loadMs.push(performance.now() - t0);
  }
  // Page counts accumulated over the `runs` timed loads (no byte counting).
  const pages = { nodes: (stats.get('memoryNodes')?.calls ?? 0) / runs, edges: (stats.get('memoryEdges')?.calls ?? 0) / runs };
  // One extra, untimed load measures response bytes.
  stats.clear();
  opts.countBytes = true;
  await load(event);

  // The builders again, on the same input, to split their share out of the load.
  const nodes = result.graphNodes as Parameters<typeof buildTreeEntries>[0];
  const treeMs: number[] = [];
  const graphMs: number[] = [];
  for (let i = 0; i < runs; i++) {
    let t = performance.now();
    buildTreeEntries(nodes, world.memory.urn);
    treeMs.push(performance.now() - t);
    t = performance.now();
    buildGraphViewData(nodes, world.memory.urn);
    graphMs.push(performance.now() - t);
  }

  const keyRows = KEYS.map((key) => {
    const value = result[key];
    const html = devalue.uneval(value);
    const unevalSamples: number[] = [];
    const jsonSamples: number[] = [];
    let json = '';
    for (let i = 0; i < runs; i++) {
      let t = performance.now();
      devalue.uneval(value);
      unevalSamples.push(performance.now() - t);
      t = performance.now();
      json = JSON.stringify(value) ?? '';
      jsonSamples.push(performance.now() - t);
    }
    const unevalMs = median(unevalSamples);
    const jsonMs = median(jsonSamples);
    return {
      key,
      unevalBytes: Buffer.byteLength(html),
      jsonBytes: Buffer.byteLength(json),
      unevalMs,
      jsonMs,
      gzipBytes: gzipSync(html).length,
      brotliBytes: brotliCompressSync(html, { params: { [zc.BROTLI_PARAM_QUALITY]: 5 } }).length,
    };
  });
  const whole = devalue.uneval(result);
  const wholeSamples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    devalue.uneval(result);
    wholeSamples.push(performance.now() - t);
  }
  const wholeUnevalMs = median(wholeSamples);

  return {
    nodeCount,
    edgeCount: world.edges.length,
    usageEntries: world.usage.length,
    runs,
    loadMsMedian: median(loadMs),
    treeMsMedian: median(treeMs),
    graphMsMedian: median(graphMs),
    pages,
    responseBytes: Object.fromEntries([...stats].map(([k, v]) => [k, v.responseBytes])),
    keyRows,
    wholeBytes: Buffer.byteLength(whole),
    wholeUnevalMs,
    wholeGzip: gzipSync(whole).length,
    wholeBrotli: brotliCompressSync(whole, { params: { [zc.BROTLI_PARAM_QUALITY]: 5 } }).length,
  };
}

const mib = (n: number) => (n / 1048576).toFixed(2);
const kb = (n: number) => (n / 1024).toFixed(1);

const PRODUCTION_REPORTED_MB_AT_32920: Record<string, number> = { graphNodes: 18.8, graphViewData: 9.3, usageByNode: 4.0, treeEntries: 3.7 };

export function renderProfile(p: Awaited<ReturnType<typeof profile>>): string {
  const lines: string[] = [];
  lines.push(`### ${p.nodeCount} nodes, ${p.edgeCount} edges, ${p.usageEntries} usage entries (median of ${p.runs} samples per timing)`);
  lines.push('');
  lines.push(`- layout \`load\` elapsed wall time (portal side, stub server answers instantly; byte accounting off): **${p.loadMsMedian.toFixed(0)} ms**`);
  lines.push(`  - of which \`buildTreeEntries\` ${p.treeMsMedian.toFixed(0)} ms + \`buildGraphViewData\` ${p.graphMsMedian.toFixed(0)} ms (timed separately on the same input; wall time)`);
  lines.push(`  - remainder (paging loop, reconstructNodes, usage map): ${(p.loadMsMedian - p.treeMsMedian - p.graphMsMedian).toFixed(0)} ms (estimate: load minus separately timed builders, not an isolated measurement)`);
  lines.push(`- graph pages per load: ${p.pages.nodes} node pages + ${p.pages.edges} edge pages, ${SERVER_PAGE} rows each, issued as two sequential chains`);
  lines.push(`- server response bytes per load (JSON, measured in one extra untimed load): ` +
    Object.entries(p.responseBytes).map(([k, v]) => `${k} ${mib(v)} MiB`).join(', '));
  lines.push('');
  lines.push('| key | devalue uneval (HTML) | JSON | gzip | brotli | uneval wall ms (median of samples) |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  for (const r of [...p.keyRows].sort((a, b) => b.unevalBytes - a.unevalBytes)) {
    lines.push(`| ${r.key} | ${mib(r.unevalBytes)} MiB | ${mib(r.jsonBytes)} MiB | ${kb(r.gzipBytes)} KB | ${kb(r.brotliBytes)} KB | ${r.unevalMs.toFixed(0)} |`);
  }
  lines.push(`| **whole layout** | **${mib(p.wholeBytes)} MiB** | | **${kb(p.wholeGzip)} KB** | **${kb(p.wholeBrotli)} KB** | ${p.wholeUnevalMs.toFixed(0)} |`);
  lines.push('');
  lines.push(`Calibration: bytes per node against the production sizes Cloe reported at 32,920 nodes (graphNodes 18.8, graphViewData 9.3, usageByNode 4.0, treeEntries 3.7; the report's unit is unspecified, so this assumes its MB meant MiB). The fixture is a stand-in, not that memory.`);
  lines.push('');
  lines.push('| key | this fixture B/node | production B/node (assuming MB = MiB) | ratio |');
  lines.push('|---|---:|---:|---:|');
  for (const [key, mbReported] of Object.entries(PRODUCTION_REPORTED_MB_AT_32920)) {
    const row = p.keyRows.find((r) => r.key === key)!;
    const mine = row.unevalBytes / p.nodeCount;
    const prod = (mbReported * 1048576) / 32920;
    lines.push(`| ${key} | ${mine.toFixed(0)} | ${prod.toFixed(0)} | ${(mine / prod).toFixed(2)} |`);
  }
  return lines.join('\n');
}

// Braces: a returned vi.fn would be run by vitest as the teardown hook.
beforeEach(() => {
  mockRequest.mockReset();
});

describe('portal#1380 memory-entry profile harness', () => {
  // Positive control: the harness must be able to see the thing it measures.
  it('sees the page count, the keys, and a size that grows with the memory', async () => {
    const small = await profile(300, 1);
    const big = await profile(4500, 1);
    expect(small.pages.nodes).toBe(1);
    expect(big.pages.nodes).toBe(Math.ceil(4500 / SERVER_PAGE));
    expect(big.pages.edges).toBe(Math.ceil(Math.round(4500 * DEFAULT_SHAPE.edgesPerNode) / SERVER_PAGE));
    expect(small.keyRows.map((r) => r.key).sort()).toEqual([...KEYS].sort());
    const bytesOf = (p: typeof small, key: string) => p.keyRows.find((r) => r.key === key)!.unevalBytes;
    expect(bytesOf(big, 'graphNodes')).toBeGreaterThan(bytesOf(small, 'graphNodes') * 10);
    // The independent oracle: JSON and devalue agree within a factor of two.
    const g = big.keyRows.find((r) => r.key === 'graphNodes')!;
    expect(g.unevalBytes / g.jsonBytes).toBeGreaterThan(0.5);
    expect(g.unevalBytes / g.jsonBytes).toBeLessThan(2);
  }, 120_000);

  it.skipIf(!process.env.HADRON_PROFILE_MEMORY_ENTRY)('prints the profile', async () => {
    const sizes = (process.env.HADRON_PROFILE_NODES ?? '1000,8000,32920').split(',').map(Number);
    const out: string[] = [];
    for (const n of sizes) out.push(renderProfile(await profile(n)));
    process.stdout.write(`\n${out.join('\n\n')}\n`);
  }, 600_000);
});
