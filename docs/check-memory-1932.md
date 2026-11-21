# Check memory budget (#1932)

The full `svelte-check --tsconfig ./tsconfig.json` graph exceeded the hosted
Node 22 default heap near 2 GiB and aborted with exit 134. Check now runs with
an explicit **4096 MiB old-space ceiling**, independently of sync and Build.
No source/test exclusions, diagnostic filters, strictness changes or dependency
changes are part of this fix. This addresses measured heap headroom; it does not
identify which historical change grew the type graph.

## Control and candidate

Isolated checkout based on main `620f5b2d5f509ab3b47ff167196ed0362eb930e9`,
Linux x64, Node **22.23.3**, pnpm **10.5.2**, svelte-check **4.4.5**, frozen lockfile.
The local host has 128290 MiB RAM; it is not a GitHub runner capacity test.
The independently retained hosted control log reports Node **22.23.4**, reaches
the heap ceiling and exits 134. Hosted candidate CI remains the runner-capacity
and end-to-end gate; local Node patch versions are not claimed identical.

| Run | Old-space cap | Exit | Wall time | Sampled heap peak / V8 total heap limit | Peak process RSS |
| --- | --- | --- | --- | --- | --- |
| Unchanged control | 2048 MiB | 134 (V8 OOM) | 49.61 s | fatal abort, no exit-hook report | 2343608 KiB (2289 MiB) |
| Candidate 1 | 4096 MiB | 0, 0 errors / 0 warnings | 34.26 s | 2058 / 4144 MiB (50%) | 2817408 KiB (2751 MiB) |
| Candidate 2 | 4096 MiB | 0, 0 errors / 0 warnings | 35.28 s | 2057 / 4144 MiB (50%) | 2821048 KiB (2755 MiB) |
| Candidate 3 (final telemetry) | 4096 MiB | 0, 0 errors / 0 warnings | 31.48 s | 2143 / 4144 MiB (52%) | 2760960 KiB (2696 MiB) |

The control uses `NODE_OPTIONS=--max-old-space-size=2048 pnpm check` on the
unchanged script, to reproduce the hosted heap ceiling rather than this local
host's ~4 GiB default. Candidate runs use `pnpm check` with no heap environment
override. Wall time and maximum child RSS were collected with Python
`subprocess.run`, `time.monotonic` and `resource.getrusage(RUSAGE_CHILDREN)` in a
fresh measurement process per run. Core dumps were disabled for the control.
The candidate preload independently reports the checker process's maxRSS.
V8's reported total limit includes young-generation overhead above old space.

Hosted control references (preserve failed attempts, not merely retries):

- Main: https://github.com/hadron-memory/hadron-portal/actions/runs/42968886778
- PR #1913: https://github.com/hadron-memory/hadron-portal/actions/runs/42969348884

## Visibility and limits

`check-heap-peak.mjs` samples main-thread heapUsed every 200 ms and reports it
alongside the **process** high-water RSS, both on stdout and in the CI job
summary. RSS includes native allocations; it is neither the heap ceiling nor
runner-wide memory. Synchronous type checking can prevent all timer samples during a long phase,
so the sampled heap value is a lower bound and can miss sustained pressure,
not just brief peaks. Kernel peak RSS remains observable during such work. A fatal V8 abort can
skip exit hooks, so absence of a report never means success: retain the raw
OOM and process exit status.

A GitHub warning when either sampled heap or kernel peak process RSS exceeds
**75% of the heap limit** exposes later growth. Comparing RSS (which includes
native memory) with the heap budget is deliberately conservative; it is not
a claim about V8 occupancy or the runner memory limit. Reporting and summary-write failures do not turn a
failed checker into success; regression tests preserve nonzero exit codes,
one main-thread report, worker silence and the warning boundary. The Build
script's own memory ceiling/report is untouched by this Check change.

## `check:watch` scope

`check:watch` is **not** outside this change. In `package.json` the two scripts
are identical except that `check:watch` appends ` --watch`:

```
check:       svelte-kit sync && node --max-old-space-size=4096 --import ./scripts/check-heap-peak.mjs node_modules/svelte-check/bin/svelte-check --tsconfig ./tsconfig.json
check:watch: svelte-kit sync && node --max-old-space-size=4096 --import ./scripts/check-heap-peak.mjs node_modules/svelte-check/bin/svelte-check --tsconfig ./tsconfig.json --watch
```

So watch also receives the 4096 MiB old-space flag and the `check-heap-peak.mjs`
preload. That was a side effect of replacing the package scripts, not a decision,
and it was first described wrongly (as unchanged). This guide held the wrong
claim; no other tracked file mentions `check:watch`.

Everything measured above is **batch** `pnpm check` (one run to completion,
exit 0 or 134). Interactive watch has **not** been measured: not its heap
growth across re-checks, not how the preload's exit-time report behaves in a
long-lived process, and not whether the 75% warning means anything there. Do not
read the batch table as watch evidence, and do not assume what watch does at the
ceiling (abort, or keep running) until it is measured.

**Open decision:** keep watch on the new flag and preload, or restore its previous
invocation. It is a separate, separately reviewed change, left by the #1939 gate
to the #1933 disposition (Marco/Xia). It has no tracking issue of its own yet;
nothing in this diff pins either invocation, so until it is decided the scripts
above are the current behaviour by default, not by choice.
