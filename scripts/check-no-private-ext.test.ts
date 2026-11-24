import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

// A vitest run inside a git hook inherits GIT_DIR / GIT_INDEX_FILE, which would
// point these throwaway repos at the real one.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: cleanEnv });
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

function run(cwd: string, entry = script) {
  const r = spawnSync(process.execPath, [entry], { cwd, encoding: 'utf8', env: cleanEnv });
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

  it('fails from a subdirectory of the repository too', () => {
    const dir = scratchRepo({ 'src/lib/ext/foo/index.ts': 'x\n', 'sub/keep.txt': 'x\n' });
    expect(run(join(dir, 'sub')).code).toBe(1);
  });

  it('fails, rather than silently doing nothing, when the script is reached by a path with a space or a symlink', () => {
    const offender = scratchRepo({ 'src/lib/ext/foo/index.ts': 'x\n' });
    const holder = mkdtempSync(join(tmpdir(), 'no private ext '));
    dirs.push(holder);
    const spaced = join(holder, 'check no private ext.mjs');
    copyFileSync(script, spaced);
    expect(run(offender, spaced).code).toBe(1);
    const linked = join(holder, 'link.mjs');
    symlinkSync(script, linked);
    expect(run(offender, linked).code).toBe(1);
  });

  it('judges the index: a staged marker edited out of the working copy still fails', () => {
    const dir = scratchRepo({ 'a.txt': `${MARKER}\n` });
    writeFileSync(join(dir, 'a.txt'), 'clean\n');
    expect(run(dir).code).toBe(1);
  });

  it('flags a tracked symlink at the extension root', () => {
    const dir = mkdtempSync(join(tmpdir(), 'no-private-ext-'));
    dirs.push(dir);
    git(dir, 'init', '-q');
    mkdirSync(join(dir, 'src/lib/ext'), { recursive: true });
    symlinkSync('/somewhere/else', join(dir, 'src/lib/ext/foo'));
    git(dir, 'add', '-f', '-A');
    const r = run(dir);
    expect(r.code).toBe(1);
    expect(r.err).toContain('src/lib/ext/foo');
  });

  it('escapes a path in the annotation', () => {
    const dir = scratchRepo({ 'src/a,b%c.txt': `${MARKER}\n` });
    const r = run(dir);
    expect(r.code).toBe(1);
    expect(r.err).toContain('file=src/a%2Cb%25c.txt::');
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
