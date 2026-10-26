import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('enforces the Last changed midnight boundary in an isolated timezone', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  // Never mutate this worker's TZ or change the suite's timezone policy.
  // Target only the original file, not this wrapper, so no recursive runs.
  const child = spawnSync(process.execPath, [
    resolve(root, 'node_modules/vitest/vitest.mjs'),
    'run', '--project', 'node', '--maxWorkers', '1',
    'src/lib/components/NodeList.timestamps.test.ts',
  ], {
    cwd: root,
    env: { ...process.env, TZ: 'America/Los_Angeles', NODELIST_TIMEZONE_BOUNDARY: '1' },
    encoding: 'utf8', timeout: 90_000,
  });
  expect(child.error, `${child.stdout}\n${child.stderr}`).toBeUndefined();
  expect(child.status, `${child.stdout}\n${child.stderr}`).toBe(0);
}, 100_000);
