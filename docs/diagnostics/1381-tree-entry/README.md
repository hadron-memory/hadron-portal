# Tree entry diagnostic — Slice 1 of portal#1381

Refs #1381. Diagnostic only: no production TreeView, route, access or navigation behavior is changed. Slice 2 still needs its design attach, gate and dispatch.

## Reproduce

From the portal checkout, with dependencies and the existing Playwright Chromium installed:

```sh
DISPLAY=:99 node scripts/diagnostics/tree-entry/run.mjs /tmp/tree-entry-diagnostic
```

Use an available display (this run used Xvfb). The runner builds a production/minified standalone fixture around the **real TreeView** and serves only that fixture on a loopback ephemeral port. It launches headed Chromium in a clean browser process with extensions disabled, then uses a fresh context/page for every run. It closes the browser/contexts and server in `finally`. Output stays outside the checkout. No login, API, server database, real memory or credential is used.

The fixture preloads entries before the timed click. The initial view is a placeholder for an already-loaded memory; clicking Enter Tree mounts TreeView. This isolates **component entry with cached data**, not the authenticated Nodes route or MemoryBrowser switching/teardown. CSS is TreeView's compiled component CSS plus a fixed 1000×720 pane; the whole app stylesheet/chrome is not loaded. Viewport 1280×900. All measured runs assert document.visibilityState=visible and document.hasFocus()=true before/after. Virtual foreground on Xvfb is not a physical user display.

## Source and dataset

Production source: fresh main `184bd51474160d9ec3f45fc6681985f9635fc60a`, which already contains Gino's #1423 diagnostic. The source hash map in [results.json](results.json) pins TreeView, graph-utils, runner, harness and generator as actually measured, including the then-uncommitted diagnostic files. Subsequent report/docs commits do not change that production source.

The seeded case reuses **exactly the same synthMemory, DEFAULT_SHAPE and seed=1380** as #1423. The pure generator was extracted unchanged into `scripts/fixtures/synthetic-memory.ts`; #1423's test imports/re-exports it, preserving its API. There are 32,920 real nodes; buildTreeEntries runs before timing and synthesizes virtual parents, yielding **60,194 entries and 27,092 initially rendered rows**. The generator also creates its original edges/usage to preserve seed consumption, but these are not passed to TreeView or kept as full layout projections. This is the same data seed/count, **not a calibrated match to production tree topology**.

Additional deterministic shapes separate count from initial expansion:

- small: 3,292 real entries, 50 roots × 10 children, remainder grandchildren; 550 visible rows.
- large: 32,920 real entries, 500 roots × 10 children, remainder grandchildren; 5,500 visible rows (matches reported row scale).
- compact: 32,920 real entries, one root × 10 children, remainder grandchildren; 11 visible rows.

Parents sort before descendants. TreeView's actual default expansion opens top-level roots only; no search or active-node expansion is injected. Expected row counts are calculated on plain data before assignment to reactive state: traversing the reactive entries during preparation would pre-materialize proxies and bias the entry cost downward.

## Method and results

Chromium **145.0.7632.6**, Linux 6.12.94+deb13-amd64 x64, AMD Ryzen 9 7950X3D. No CPU/network throttling, no extensions; shared host load was not isolated. One discarded fresh-page warm-up per scenario, then **five measured runs per scenario** in the fixed order below. Fresh contexts do not establish a hot-JIT steady state. Trace categories: devtools.timeline,toplevel,v8,blink.user_timing; screenshots/CPU sampling are not enabled. Trace overhead is unquantified.

Median / worst (ms):

| Shape | Real nodes | Rendered rows | DOM elements | Largest long task | TBT (sum of task excess over 50ms) | Entry through two rAF |
|---|---:|---:|---:|---:|---:|---:|
| small | 3,292 | 550 | 3,314 | 65.0 / 66.0 | 15.0 / 16.0 | 69.1 / 69.5 |
| large | 32,920 | 5,500 | 33,014 | 706.0 / 1319.0 | 656.0 / 1269.0 | 748.8 / 1346.4 |
| compact | 32,920 | 11 | 80 | 203.0 / 222.0 | 153.0 / 172.0 | 204.5 / 223.4 |
| seeded | 32,920 | 27,092 | 162,566 | 2375.0 / 2489.0 | 2382.0 / 2509.0 | 2484.7 / 2614.1 |

“Entry” is click-handler mark through Svelte tick and two animation frames: a rendering-opportunity proxy, not a directly observed first-paint timestamp. Largest long task is the full duration of any Long Tasks API entry overlapping those marks; TBT is a separate derived metric and must not be added to it. CDP renderer-main ThreadControllerImpl::RunTask events corroborate the durations (see traceLargestTaskMs per run). Nested/inclusive trace events are never summed. There were no page errors; all visibility/focus and row-count assertions passed.

Heap, decimal MB, median / worst:

| Shape | Before mount, post-GC | After entry, pre-GC | Retained after forced GC | Retained minus before |
|---|---:|---:|---:|---:|
| small | 1.78 / 1.78 | 12.40 / 12.51 | 11.31 / 11.31 | 9.53 / 9.53 |
| large | 5.82 / 5.90 | 91.86 / 96.50 | 89.30 / 89.31 | 83.49 / 83.49 |
| compact | 5.93 / 5.95 | 55.20 / 68.97 | 48.04 / 48.05 | 42.11 / 42.11 |
| seeded | 16.87 / 16.87 | 284.55 / 310.62 | 281.15 / 281.17 | 264.28 / 264.30 |

Heap is CDP Runtime.getHeapUsage.usedSize (JS heap), not total process memory. Forced GC happens outside the entry interval. Raw traces may include the explicit **post-end** GC operation; it must not be counted as entry blocking. Retained growth includes the mounted tree and its derived/proxied data; this is not a leak test or a post-unmount retention claim.

## Evidence and interpretation

[results.json](results.json) contains all 20 measured runs and medians/worsts. [trace-slices.json](trace-slices.json) preserves start/end user marks, overlapping renderer-main top-level task events and SHA-256 for all 20 raw traces. Two complete synthetic raw traces are preserved compressed: [seeded run 1](trace-seeded-1.json.gz), [large run 1](trace-large-1.json.gz). Gunzip to open in Chrome DevTools Performance. Other full raw traces remain at `/tmp/greta-1381-diagnostic-evidence`; the runner reproduces them. No production trace or real data is included.

The effect is reproduced without installed extensions: rendering thousands of rows is expensive even after data is cached. The same-count compact control is much smaller but still pays substantial data processing/proxy/tree costs; **virtualizing DOM alone is not proven to meet the target**. Topology and visible expanded count must accompany “node count” in future comparisons. The seeded case deliberately exposes more rows than Holger's report, so its timing is not a reproduction of his exact route/topology.

Against the proposed Slice 2 bounds, the large and seeded cases exceed 200ms median/400ms worst largest-task and 3,000 DOM elements. Heap is reported but “no growth over baseline” cannot be certified against Holger's whole-app 317MB figure with this component-only heap metric. **No fix, improvement percentage, extension-cost subtraction or acceptance pass is claimed.** Chrome145/Linux hardware differs from Holger's Chrome153/Mac, his exact deployed commit/topology is unknown, and this fixture omits whole-route component teardown, focus, app styles, network and other layout projections.

Initial exploratory batches are not pooled with this final measurement: the first 5,500-row batch measured 729/761ms; an intermediate harness traversed reactive entries before measurement, which moved proxy work out of entry and was corrected. The preliminary note is `hrn:node:hadronmemory.com:hadron-dev-team-greta:investigations:portal-1381-slice1-preliminary`. Shared-host/trace variability is visible in the final worst run and is retained, not discarded.

## Slice 2 handoff (proposal, not authorization)

Compare a flattened **visible-expanded** tree with a virtual row window against incremental branch materialization, including data/proxy/tree construction in the budget. Benchmark both the calibrated 5,500-row case and the exact shared seed, plus compact/expanded controls. Preserve existing expand/collapse, active ancestor expansion, focus/selection, keyboard/screen-reader behavior, real/virtual link distinctions and drag/reorder interactions. Add the gate's red component row-bound pin, foreground n≥5 median/worst and heap controls after choosing a design. Re-gate the attach before implementation. Independent of #1380's payload fix; do not count removed network/projection cost as a tree-mount fix.
