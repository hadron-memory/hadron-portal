// portal#1925: the repeatable check of test-task-history-links-layout.mjs's TH_EXTRA_ANCHOR hook.
// Each case injects one same-origin anchor and pins the probe's exit code and what it says:
//   1 = killed, with a diagnostic that names the injected link (an unclassified in-app anchor)
// There is no survivor control: the hook adds a bare anchor, which a coarse pointer's 44px check
// would fail even for a known kind, so a known-kind injection ends the run for another reason (exit 3).
// Run: pnpm test:task-history-links-layout:mutants   (real Chromium, like the probe itself)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const probe = fileURLToPath(new URL('./test-task-history-links-layout.mjs', import.meta.url));

const cases = [
  // An unknown same-origin path, and each shape the old substring match or the old prefix match let through.
  { anchor: '/app/elsewhere', exit: 1, why: 'an unknown in-app path' },
  { anchor: '/app/memories/x/runs/y', exit: 1, why: 'a path that merely contains /runs/' },
  { anchor: '/app/memories/x/tasks/y', exit: 1, why: 'a path that merely contains /tasks/' },
  { anchor: '/app/u/hrn:example/extra', exit: 1, why: 'a chip-looking path with an extra segment' },
  { anchor: '/app/u/hrn:', exit: 1, why: 'a chip-looking path with an empty URN' },
];

for (const c of cases) {
  const r = spawnSync(process.execPath, [probe], { env: { ...process.env, TH_EXTRA_ANCHOR: c.anchor }, encoding: 'utf8' });
  const out = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, c.exit, `${c.why} (${c.anchor}): expected exit ${c.exit}, got ${r.status}\n${out.slice(-600)}`);
  if (c.exit === 1) assert.ok(out.includes(`"href":${JSON.stringify(c.anchor)}`), `${c.why}: the diagnostic does not name ${c.anchor}\n${out.slice(-600)}`);
  console.log(`ok ${c.why} -> exit ${r.status}`);
}
