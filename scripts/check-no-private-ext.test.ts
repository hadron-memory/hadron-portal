import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * #2566 (C1) — the publication guard's own test.
 *
 * The guard is shown to FAIL through its real entry point on throwaway git
 * repositories, and to PASS on this checkout, which is also how "it does not
 * match its own files" is proven: a script or test that spelled the marker
 * literally would flag itself here
 * (`hrn:node:hadronmemory.com:hadron-portal:review:guard-must-be-proven-to-fail`).
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const script = join(here, 'check-no-private-ext.mjs');

// Assembled, so this file never holds the marker literally.
const MARKER = '@portal-' + 'private-extension';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function scratchRepo(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'no-private-ext-'));
  dirs.push(dir);
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 't');
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  git(dir, 'add', '-f', '-A');
  return dir;
}

function run(cwd: string) {
  const r = spawnSync('node', [script], { cwd, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe('check-no-private-ext', () => {
  it('fails when a directory under src/lib/ext/ is tracked', () => {
    const dir = scratchRepo({ 'src/lib/ext/foo/index.ts': 'export default { id: "foo" };\n' });
    const r = run(dir);
    expect(r.code).toBe(1);
    expect(r.err).toContain('::error');
    expect(r.err).toContain('src/lib/ext/foo');
  });

  it('fails when a tracked file anywhere holds the marker', () => {
    const dir = scratchRepo({ 'src/routes/x/+page.svelte': `<!-- ${MARKER} -->\n` });
    const r = run(dir);
    expect(r.code).toBe(1);
    expect(r.err).toContain('::error');
    expect(r.err).toContain('src/routes/x/+page.svelte');
  });

  it('passes on a repo holding only the tracked top-level files of src/lib/ext/', () => {
    const dir = scratchRepo({
      'src/lib/ext/types.ts': 'export {};\n',
      'src/lib/ext/registry.ts': 'export {};\n',
      'src/lib/ext/README.md': '# ext\n',
      'src/lib/ext/registry.test.ts': 'export {};\n',
    });
    const r = run(dir);
    expect(r.code).toBe(0);
  });

  it('ignores an untracked file that holds the marker', () => {
    const dir = scratchRepo({ 'a.txt': 'x\n' });
    writeFileSync(join(dir, 'overlay.ts'), MARKER);
    expect(run(dir).code).toBe(0);
  });

  it('passes on the real checkout, scanning a non-zero number of files', () => {
    const r = run(repoRoot);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    const scanned = Number(/(\d+) tracked files/.exec(r.out)?.[1] ?? 0);
    expect(scanned).toBeGreaterThan(100);
  });
});

describe('the lines that keep a private extension out of this repository', () => {
  it('.gitignore ignores a directory under src/lib/ext/', () => {
    const r = spawnSync('git', ['check-ignore', '-q', 'src/lib/ext/sample/index.ts'], { cwd: repoRoot });
    expect(r.status).toBe(0);
  });

  it('.gitignore does not ignore the registry files that stay tracked', () => {
    for (const f of ['types.ts', 'registry.ts', 'README.md', 'registry.test.ts']) {
      const r = spawnSync('git', ['check-ignore', '-q', `src/lib/ext/${f}`], { cwd: repoRoot });
      expect(r.status, f).toBe(1);
    }
  });

  it('src/app.css holds an uncommented @source line for src/lib/ext', () => {
    const css = readFileSync(join(repoRoot, 'src/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/^@source\s+["']\.\/lib\/ext["'];\s*$/m);
  });
});
