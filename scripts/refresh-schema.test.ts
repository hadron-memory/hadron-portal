/**
 * #891 — `pnpm gql:schema` exports a NAMED git revision, never a working tree.
 *
 * Every fixture is disposable: a bare "remote" and clones of it in the OS temp
 * directory, built per test. Nothing here touches a real hadron-server checkout,
 * which is the whole point of the change — the old script read whatever that
 * checkout held, and in a shared workspace that was another worker's branch.
 *
 * The exporter in the fixtures is the server's own, verbatim, so what runs is
 * what `pnpm gql:schema` runs: two files out of git, the portal's `graphql`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPORTER, OPTIONAL_IMPORTS, RefreshError, TYPEDEFS, parseArgs, readProvenance, refresh } from './refresh-schema.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Inside the repo, so the fixtures' `graphql` import resolves to the portal's
// copy exactly as it does for a real run. Gitignored, and removed after each run.
const WORK_ROOT = join(REPO, '.gql-schema-export');

/** hadron-server's exporter, verbatim (scripts/export-graphql-sdl.mjs). */
const REAL_EXPORTER = `import { buildSchema, printSchema, lexicographicSortSchema } from 'graphql';
import { typeDefs } from '../src/api/graphql/schema/typeDefs.js';

try {
  const schema = lexicographicSortSchema(buildSchema(typeDefs));
  process.stdout.write(printSchema(schema) + '\\n');
} catch (e) {
  console.error('✗ GraphQL SDL failed to build:');
  console.error(e);
  process.exit(1);
}
`;

// A type annotation on purpose: the fixture must exercise type stripping, not
// pass because today's typeDefs.ts happens to be plain JavaScript.
const typeDefs = (field: string) => `export const typeDefs: string = \`#graphql
  type Query {
    ${field}: String
  }
\`;
`;

const temps: string[] = [];
function temp(prefix: string) {
  const d = mkdtempSync(join(tmpdir(), `gil-891-${prefix}-`));
  temps.push(d);
  return d;
}
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

function git(dir: string, ...args: string[]) {
  return execFileSync(
    'git',
    ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}

function commitFiles(dir: string, files: Record<string, string>, message: string) {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

/**
 * A bare "remote" whose main holds `field`, and a clone of it — the clone's
 * origin/main is current until the remote moves.
 */
function serverFixture(field = 'alpha') {
  const remote = temp('remote');
  git(remote, 'init', '-q', '--bare');
  const seed = temp('seed');
  git(seed, 'init', '-q');
  const sha = commitFiles(seed, { [EXPORTER]: REAL_EXPORTER, [TYPEDEFS]: typeDefs(field) }, `schema ${field}`);
  git(seed, 'push', '-q', remote, 'HEAD:refs/heads/main');
  const server = temp('server');
  execFileSync('git', ['clone', '-q', remote, server], { stdio: 'ignore' });
  return { remote, seed, server, sha };
}

/** A throwaway portal root holding only the snapshot the refresh writes. */
function portalFixture(existing = '# the old snapshot\ntype Query { old: String }\n') {
  const root = temp('portal');
  mkdirSync(join(root, 'schema'));
  writeFileSync(join(root, 'schema', 'schema.graphql'), existing);
  return root;
}

const snapshot = (root: string) => readFileSync(join(root, 'schema', 'schema.graphql'), 'utf8');

function run(opts: { portalRoot: string; server: string; rev?: string; allowStale?: boolean }) {
  const log: string[] = [];
  const result = refresh({ ...opts, workRoot: WORK_ROOT, log: (l: string) => log.push(l) });
  return { result, log };
}

describe('the source is a git revision, never the working tree', () => {
  it('exports the NAMED commit — not the checked-out branch, not uncommitted edits', () => {
    const { server, sha } = serverFixture('alpha');
    // The shared-checkout shape #891 is about: somebody else's branch, and
    // uncommitted work on top of it.
    git(server, 'switch', '-q', '-c', 'someone-elses-branch');
    commitFiles(server, { [TYPEDEFS]: typeDefs('branchOnly') }, 'branch work');
    writeFileSync(join(server, TYPEDEFS), typeDefs('uncommitted'));

    const portal = portalFixture();
    run({ portalRoot: portal, server, rev: sha });

    const out = snapshot(portal);
    expect(out).toContain('alpha: String');
    expect(out).not.toContain('branchOnly');
    expect(out).not.toContain('uncommitted');
    expect(readProvenance(join(portal, 'schema', 'schema.graphql'))).toMatchObject({ sha, rev: sha });
  });

  it('defaults to origin/main and exports it when it matches the remote', () => {
    const { server, sha } = serverFixture('alpha');
    git(server, 'switch', '-q', '-c', 'elsewhere');
    commitFiles(server, { [TYPEDEFS]: typeDefs('branchOnly') }, 'branch work');

    const portal = portalFixture();
    const { log } = run({ portalRoot: portal, server });
    expect(snapshot(portal)).toContain('alpha: String');
    expect(readProvenance(join(portal, 'schema', 'schema.graphql'))).toMatchObject({ sha, rev: 'origin/main' });
    // The source is SAID, not assumed.
    expect(log.join('\n')).toContain(sha.slice(0, 12));
    expect(log.join('\n')).not.toContain('lags the remote');
  });

  it('writes nothing into the server checkout, and leaves a symlinked node_modules alone', () => {
    const { server, sha } = serverFixture('alpha');
    // A node_modules that is a symlink into someone else's tree — the shape
    // pnpm offered to delete during #879.
    const deps = temp('someone-elses-deps');
    writeFileSync(join(deps, 'sentinel'), 'do not touch');
    symlinkSync(deps, join(server, 'node_modules'));
    const before = { status: git(server, 'status', '--porcelain', '--ignored'), files: readdirSync(server).sort() };

    run({ portalRoot: portalFixture(), server, rev: sha });

    expect(git(server, 'status', '--porcelain', '--ignored')).toBe(before.status);
    expect(readdirSync(server).sort()).toEqual(before.files);
    expect(lstatSync(join(server, 'node_modules')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(server, 'node_modules'))).toBe(deps);
    expect(readFileSync(join(deps, 'sentinel'), 'utf8')).toBe('do not touch');
  });
});

describe('a module typeDefs imports comes along when the revision has it', () => {
  // hadron-server#4848: typeDefs.ts imports the team-metrics caps by their `.js` spelling.
  const CAPS = 'export const METRICS_IDS_CAP = 200;\n';
  const withCaps = `import { METRICS_IDS_CAP } from '../../../lib/agentTasks/teamMetricsCaps.js';
export const typeDefs: string = \`#graphql
  type Query {
    ids: String
    "at most \${METRICS_IDS_CAP}"
    capped: String
  }
\`;
`;

  it('exports a typeDefs that imports the caps module', () => {
    const fx = serverFixture('alpha');
    const sha = commitFiles(fx.seed, { [TYPEDEFS]: withCaps, [OPTIONAL_IMPORTS[0]]: CAPS }, 'caps');
    git(fx.seed, 'push', '-q', fx.remote, 'HEAD:refs/heads/main');
    git(fx.server, 'fetch', '-q', 'origin');

    const portal = portalFixture();
    run({ portalRoot: portal, server: fx.server, rev: sha });
    expect(snapshot(portal)).toContain('at most 200');
  });

  it('still refuses loudly when the revision imports a module nobody copies', () => {
    const fx = serverFixture('alpha');
    const sha = commitFiles(fx.seed, { [TYPEDEFS]: withCaps }, 'caps import without the module');
    git(fx.seed, 'push', '-q', fx.remote, 'HEAD:refs/heads/main');
    git(fx.server, 'fetch', '-q', 'origin');

    const portal = portalFixture();
    expect(() => run({ portalRoot: portal, server: fx.server, rev: sha })).toThrow(RefreshError);
    expect(snapshot(portal)).toContain('the old snapshot');
  });
});

describe('a stale default is refused, an explicit revision is not', () => {
  function advanceRemote(fx: ReturnType<typeof serverFixture>) {
    const newer = commitFiles(fx.seed, { [TYPEDEFS]: typeDefs('newer') }, 'newer');
    git(fx.seed, 'push', '-q', fx.remote, 'HEAD:refs/heads/main');
    return newer;
  }

  it('refuses origin/main when the remote has moved on, naming both commits — snapshot untouched', () => {
    const fx = serverFixture('alpha');
    const newer = advanceRemote(fx);
    const portal = portalFixture();
    const before = snapshot(portal);

    expect(() => run({ portalRoot: portal, server: fx.server })).toThrow(RefreshError);
    try {
      run({ portalRoot: portal, server: fx.server });
    } catch (e) {
      expect(String((e as Error).message)).toContain(fx.sha.slice(0, 7));
      expect(String((e as Error).message)).toContain(newer.slice(0, 7));
      expect(String((e as Error).message)).toContain('fetch origin main');
    }
    expect(snapshot(portal)).toBe(before);
  });

  it('--allow-stale exports the local ref anyway, and says so', () => {
    const fx = serverFixture('alpha');
    advanceRemote(fx);
    const portal = portalFixture();
    const { log } = run({ portalRoot: portal, server: fx.server, allowStale: true });
    expect(snapshot(portal)).toContain('alpha: String');
    expect(log.join('\n')).toContain('lags the remote');
  });

  it('an explicit --rev is the caller\'s choice and is not second-guessed against the remote', () => {
    const fx = serverFixture('alpha');
    advanceRemote(fx);
    const portal = portalFixture();
    run({ portalRoot: portal, server: fx.server, rev: fx.sha });
    expect(snapshot(portal)).toContain('alpha: String');
  });

  it('when the remote cannot be asked, it exports and SAYS it could not check', () => {
    const fx = serverFixture('alpha');
    rmSync(fx.remote, { recursive: true, force: true }); // offline, in effect
    const portal = portalFixture();
    const { log } = run({ portalRoot: portal, server: fx.server });
    expect(snapshot(portal)).toContain('alpha: String');
    expect(log.join('\n')).toContain('could not ask the remote');
  });
});

describe('failures leave the snapshot exactly as it was', () => {
  it('a revision whose SDL does not build', () => {
    const fx = serverFixture('alpha');
    const bad = commitFiles(fx.server, { [TYPEDEFS]: 'export const typeDefs: string = `type Query {`;\n' }, 'broken');
    const portal = portalFixture();
    const before = snapshot(portal);
    expect(() => run({ portalRoot: portal, server: fx.server, rev: bad })).toThrow(/exporter failed/);
    expect(snapshot(portal)).toBe(before);
    expect(existsSync(WORK_ROOT)).toBe(false);
  });

  it('an exporter that succeeds with no output', () => {
    const fx = serverFixture('alpha');
    const silent = commitFiles(fx.server, { [EXPORTER]: 'process.exit(0);\n' }, 'silent');
    const portal = portalFixture();
    const before = snapshot(portal);
    expect(() => run({ portalRoot: portal, server: fx.server, rev: silent })).toThrow(/no output/);
    expect(snapshot(portal)).toBe(before);
  });

  it('a revision that does not exist, or a repository that is not hadron-server', () => {
    const fx = serverFixture('alpha');
    const portal = portalFixture();
    expect(() => run({ portalRoot: portal, server: fx.server, rev: 'no-such-branch' })).toThrow(/does not exist/);
    const other = temp('not-server');
    git(other, 'init', '-q');
    commitFiles(other, { 'README.md': 'hi' }, 'unrelated');
    expect(() => run({ portalRoot: portal, server: other, rev: 'HEAD' })).toThrow(/really hadron-server/);
    expect(() => run({ portalRoot: portal, server: join(other, 'missing') })).toThrow(/no hadron-server checkout/);
  });

  it('a default origin/main that was never fetched names the fix', () => {
    const lone = temp('lone');
    git(lone, 'init', '-q');
    commitFiles(lone, { [EXPORTER]: REAL_EXPORTER, [TYPEDEFS]: typeDefs('alpha') }, 'no remote');
    expect(() => run({ portalRoot: portalFixture(), server: lone })).toThrow(/origin\/main.*does not exist.*--rev/s);
  });
});

describe('parseArgs', () => {
  it('reads --rev, --server and --allow-stale, and HADRON_SERVER_DIR as the default server', () => {
    expect(parseArgs(['--rev', 'abc', '--allow-stale'], { HADRON_SERVER_DIR: '/s' })).toMatchObject({
      rev: 'abc',
      server: '/s',
      allowStale: true,
    });
    expect(parseArgs(['--server', '/x'], { HADRON_SERVER_DIR: '/s' }).server).toBe('/x');
  });

  it('refuses a flag without its value and anything it does not know', () => {
    expect(() => parseArgs(['--rev'], {})).toThrow(RefreshError);
    expect(() => parseArgs(['--rev', '--allow-stale'], {})).toThrow(RefreshError);
    expect(() => parseArgs(['--force'], {})).toThrow(/unknown argument/);
  });
});
