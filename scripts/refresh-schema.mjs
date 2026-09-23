#!/usr/bin/env node
/**
 * Refresh the committed SDL snapshot (schema/schema.graphql) from hadron-server
 * (#681) — from an EXPLICIT GIT REVISION, never from a working tree (#891).
 *
 *   pnpm gql:schema                          # ../hadron-server @ origin/main
 *   pnpm gql:schema --rev <sha|ref>          # any revision, e.g. a PR branch
 *   pnpm gql:schema --server <dir>           # or HADRON_SERVER_DIR
 *
 * ## Why a revision and not the checkout (#891)
 *
 * The old script ran the exporter INSIDE `../hadron-server`, so the snapshot
 * was whatever that tree happened to hold. In a shared workspace that tree is
 * another worker's branch, often with uncommitted edits: on 2026-09-23 it was
 * `codex/1268-sentry-scrub` behind main by #1283, and a refresh would have
 * committed a snapshot of code nobody meant to ship — with no error, because
 * the export itself succeeded. The source was an ASSUMPTION the script never
 * stated.
 *
 * So the source is now a named revision (default `origin/main`), resolved to a
 * SHA, printed, and stamped into the snapshot's first line. The two files the
 * exporter needs are read from git's OBJECT STORE (`git show <sha>:<path>`):
 * the checkout's branch, index, uncommitted edits and node_modules play no part,
 * and nothing is written into the server directory. The default is refused
 * when the local `origin/main` lags the real remote (checked read-only with
 * `git ls-remote`), since "main" that is a day old is the same silent-staleness
 * problem one step removed.
 *
 * ## Why no pnpm and no server dependencies (#891)
 *
 * Borrowing the server's node_modules — the obvious workaround — made `pnpm
 * tsx` in a temporary worktree ask to REMOVE that node_modules, which was a
 * symlink into another worker's checkout; it aborted only for want of a TTY.
 * This script never runs a package manager and never touches the server's
 * dependencies. The exporter is two files — `scripts/export-graphql-sdl.mjs`
 * and `src/api/graphql/schema/typeDefs.ts`, a self-contained SDL string (the
 * same pair schema-drift.yml sparse-checks-out) — and its only runtime import is
 * `graphql`, which the portal already has. They run under plain `node` (22.18+
 * strips TypeScript types natively) from a temp directory inside THIS repo
 * (`.gql-schema-export/`, gitignored), so `graphql` resolves to the portal's
 * own copy.
 *
 * ## What is kept from the old script
 *
 * The snapshot is swapped in only on success: an export that fails, or that
 * produces nothing, leaves schema/schema.graphql exactly as it was, so
 * `pnpm gql:validate` stays usable.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The files the exporter needs, as paths inside hadron-server. */
export const EXPORTER = 'scripts/export-graphql-sdl.mjs';
export const TYPEDEFS = 'src/api/graphql/schema/typeDefs.ts';

export const DEFAULT_REV = 'origin/main';

/** A refusal the CLI prints as-is and exits non-zero on — never a stack trace. */
export class RefreshError extends Error {}

/** Raw stdout of a read-only git command in `dir`. */
function gitRaw(dir, args) {
  // GIT_OPTIONAL_LOCKS=0: even a read-only git command may take the index lock
  // to refresh stat data. This directory is someone else's checkout; never
  // contend for its lock.
  return execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** A git answer (a SHA, a subject) — trimmed. File CONTENTS use gitRaw. */
function git(dir, args) {
  return gitRaw(dir, args).trim();
}

function tryGit(dir, args) {
  try {
    return { ok: true, out: git(dir, args) };
  } catch (e) {
    return { ok: false, err: String(e?.stderr ?? e?.message ?? e).trim() };
  }
}

/**
 * Resolve `rev` in `serverDir` to a commit, with what a reader needs to judge
 * it: the SHA, its subject and date. Throws a RefreshError naming the fix.
 */
export function resolveSource(serverDir, rev) {
  if (!existsSync(serverDir)) {
    throw new RefreshError(`no hadron-server checkout at ${serverDir} — pass --server <dir> or set HADRON_SERVER_DIR`);
  }
  if (!tryGit(serverDir, ['rev-parse', '--git-dir']).ok) {
    throw new RefreshError(`${serverDir} is not a git repository — the schema is read from a git revision, not from files`);
  }
  const sha = tryGit(serverDir, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
  if (!sha.ok || !sha.out) {
    throw new RefreshError(
      `revision "${rev}" does not exist in ${serverDir}` +
        (rev === DEFAULT_REV ? ` — fetch it (git -C ${serverDir} fetch origin main) or pass --rev <sha>` : ''),
    );
  }
  const [subject, date] = git(serverDir, ['log', '-1', '--format=%s%x00%cI', sha.out]).split('\0');
  for (const path of [EXPORTER, TYPEDEFS]) {
    if (!tryGit(serverDir, ['cat-file', '-e', `${sha.out}:${path}`]).ok) {
      throw new RefreshError(`${rev} (${sha.out.slice(0, 7)}) has no ${path} — is ${serverDir} really hadron-server?`);
    }
  }
  return { sha: sha.out, subject, date };
}

/**
 * Is the local `origin/main` what the remote has? Read-only (`ls-remote`
 * fetches nothing and moves no ref). `unknown` when the remote cannot be asked
 * (offline, no remote) — the caller then SAYS so rather than guessing.
 */
export function remoteFreshness(serverDir, localSha) {
  const r = tryGit(serverDir, ['ls-remote', '--exit-code', 'origin', 'refs/heads/main']);
  if (!r.ok) return { state: 'unknown', detail: r.err.split('\n')[0] || 'ls-remote failed' };
  const remoteSha = r.out.split(/\s+/)[0];
  return remoteSha === localSha ? { state: 'current' } : { state: 'stale', remoteSha };
}

/**
 * Run the exporter for commit `sha` and return the SDL. Nothing is written in
 * `serverDir`; the files are copied out of git into `workRoot`, run with the
 * portal's own `graphql`, and removed again whatever happens.
 */
export function exportSdl(serverDir, sha, workRoot) {
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, 'export-'));
  try {
    for (const path of [EXPORTER, TYPEDEFS]) {
      const target = join(work, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, gitRaw(serverDir, ['show', `${sha}:${path}`]));
    }
    // The exporter imports `typeDefs.js` — the TypeScript-emit spelling — and
    // node does not map .js to .ts. A one-line module bridges it; importing a
    // .ts file by its real name is what native type stripping supports.
    writeFileSync(join(work, TYPEDEFS.replace(/\.ts$/, '.js')), "export * from './typeDefs.ts';\n");

    const run = spawnSync(process.execPath, [join(work, EXPORTER)], {
      cwd: work,
      encoding: 'utf8',
      // Type stripping is on by default from Node 22.18 / 23.6; the flag makes
      // an older 22.x work too and is accepted (with a warning) by newer ones.
      env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --experimental-strip-types`.trim() },
      maxBuffer: 64 * 1024 * 1024,
    });
    if (run.status !== 0) {
      throw new RefreshError(`the exporter failed at ${sha.slice(0, 7)}:\n${(run.stderr || run.stdout || '').trim()}`);
    }
    if (!run.stdout.trim()) {
      throw new RefreshError(`the exporter produced no output at ${sha.slice(0, 7)}`);
    }
    return run.stdout;
  } finally {
    rmSync(work, { recursive: true, force: true });
    // The root too, when this run was its only user — a concurrent run's
    // directory keeps it, and rmdir refuses a non-empty one.
    try {
      rmdirSync(workRoot);
    } catch {
      /* not empty, or already gone */
    }
  }
}

/** The provenance line stamped at the top of the snapshot. A comment: legal SDL. */
export function provenanceLine(source) {
  return `# Exported from hadron-server ${source.sha} (${source.rev}, ${source.date}) by pnpm gql:schema — do not edit.`;
}

/**
 * Write the snapshot atomically: a temp file beside it, renamed over it. A
 * crash or a failure before the rename leaves the old snapshot byte-identical.
 */
export function writeSnapshot(outPath, sdl, source) {
  const tmp = `${outPath}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, `${provenanceLine(source)}\n${sdl.endsWith('\n') ? sdl : sdl + '\n'}`);
    renameSync(tmp, outPath);
  } finally {
    rmSync(tmp, { force: true });
  }
}

export function parseArgs(argv, env = process.env) {
  const opts = { server: env.HADRON_SERVER_DIR || null, rev: null, allowStale: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new RefreshError(`${a} needs a value`);
      return v;
    };
    if (a === '--server') opts.server = value();
    else if (a === '--rev') opts.rev = value();
    else if (a === '--allow-stale') opts.allowStale = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new RefreshError(`unknown argument ${a} — see --help`);
  }
  return opts;
}

/**
 * The whole refresh. `log` receives the human-readable account; the return
 * value is what was written. Every refusal is a RefreshError.
 */
export function refresh({ portalRoot, server, rev, allowStale = false, log = console.log, workRoot }) {
  const serverDir = resolve(portalRoot, server ?? '../hadron-server');
  const wantRev = rev ?? DEFAULT_REV;
  const source = { ...resolveSource(serverDir, wantRev), rev: wantRev };

  // Only the DEFAULT is checked against the remote. An explicit --rev is the
  // caller's statement of what they want — a PR branch, a pinned SHA — and
  // second-guessing it would make it impossible to export anything but main.
  if (rev == null) {
    const fresh = remoteFreshness(serverDir, source.sha);
    if (fresh.state === 'stale' && !allowStale) {
      throw new RefreshError(
        `${serverDir}'s origin/main is ${source.sha.slice(0, 7)}, but the remote main is ${fresh.remoteSha.slice(0, 7)}.\n` +
          `  Update the remote-tracking ref (touches no branch, index or working tree):\n` +
          `    git -C ${serverDir} fetch origin main\n` +
          `  or export this exact commit on purpose:  pnpm gql:schema --rev ${source.sha.slice(0, 7)}`,
      );
    }
    if (fresh.state === 'stale') log(`! origin/main lags the remote (${fresh.remoteSha.slice(0, 7)}); exporting it anyway (--allow-stale)`);
    if (fresh.state === 'unknown') log(`! could not ask the remote whether origin/main is current (${fresh.detail}) — exporting the local ref`);
  }

  log(`→ exporting from ${serverDir}`);
  log(`  at ${source.sha.slice(0, 12)}  (${wantRev})  ${source.date}  ${source.subject}`);
  log('  read from git objects — that checkout\'s branch, uncommitted edits and node_modules are not used');

  // Inside THIS repo so `graphql` resolves to the portal's copy by the normal
  // ancestor walk — but NOT under node_modules: node refuses to strip types
  // for any file below a node_modules directory
  // (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). Gitignored.
  const sdl = exportSdl(serverDir, source.sha, workRoot ?? join(portalRoot, '.gql-schema-export'));
  const outPath = join(portalRoot, 'schema', 'schema.graphql');
  writeSnapshot(outPath, sdl, source);
  log(`✓ refreshed schema/schema.graphql from hadron-server ${source.sha.slice(0, 7)}`);
  log("  Now run 'pnpm gql:validate' and reconcile any operation the server changed.");
  return { ...source, outPath };
}

/** Read a snapshot's provenance line back — what it was exported from. */
export function readProvenance(outPath) {
  const first = readFileSync(outPath, 'utf8').split('\n', 1)[0];
  const m = first.match(/^# Exported from hadron-server ([0-9a-f]{40}) \(([^,]+), ([^)]+)\)/);
  return m ? { sha: m[1], rev: m[2], date: m[3] } : null;
}

const HELP = `Refresh schema/schema.graphql from a hadron-server git revision (#891).

  pnpm gql:schema [--rev <sha|ref>] [--server <dir>] [--allow-stale]

  --rev <ref>     the revision to export (default: origin/main, checked against the remote)
  --server <dir>  the hadron-server git checkout to read (default: HADRON_SERVER_DIR, then ../hadron-server)
  --allow-stale   export the local origin/main even when the remote has moved on

The files are read from git objects, so the checkout's branch and uncommitted
edits do not matter, and nothing is written into it.`;

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
      console.log(HELP);
    } else {
      refresh({ portalRoot: resolve(dirname(fileURLToPath(import.meta.url)), '..'), ...opts });
    }
  } catch (e) {
    if (e instanceof RefreshError) {
      console.error(`✗ ${e.message}`);
      console.error('  schema/schema.graphql was left untouched.');
      process.exit(1);
    }
    throw e;
  }
}
