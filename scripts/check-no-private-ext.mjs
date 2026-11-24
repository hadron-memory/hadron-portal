// #2566 (C1) — keep a private extension out of this public repository.
//
// A deployment adds its own screens by dropping a directory under
// `src/lib/ext/<id>/` (see src/lib/ext/README.md). `.gitignore` keeps such a
// directory untracked, but a force-add or a route file carrying a private
// module's marker would still publish it, and `.gitignore` is advisory. So this
// fails when:
//   - the index holds a directory, symlink or submodule under `src/lib/ext/` (the
//     registry's own files sit directly in it and stay tracked), or
//   - a tracked file contains the private marker.
//
// It reads the INDEX only (`git ls-files -s`, `git grep --cached`), never the
// working tree: a composed overlay keeps its files untracked on purpose, and they
// must not trip it. It judges the tree as it stands; history is out of its scope.
//
// It resolves the repository root itself, so it gives the same answer from any
// subdirectory, and it compares real paths so it cannot silently not run.
//
// The marker is assembled below, so this file never holds it literally and
// needs no exclusion list (a list is where a real offender hides).
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const MARKER = '@portal-' + 'private-extension';

const EXT_ROOT = 'src/lib/ext/';

/**
 * Directories, symlinks and submodules that index entries (`{ path, mode }`) put
 * under `src/lib/ext/`. The registry's own files are regular files sitting
 * directly in it.
 */
export function trackedExtDirs(entries) {
  const found = new Set();
  for (const { path, mode } of entries) {
    if (!path.startsWith(EXT_ROOT)) continue;
    const rest = path.slice(EXT_ROOT.length).split('/');
    if (rest.length > 1 || mode === '120000' || mode === '160000') found.add(EXT_ROOT + rest[0]);
  }
  return [...found].sort();
}

/** Escape per the Actions workflow-command spec, so a filename cannot inject one. */
export function escapeProperty(value) {
  return String(value)
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')
    .replace(/:/g, '%3A')
    .replace(/,/g, '%2C');
}
export function escapeMessage(value) {
  return String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

/** Index entries, whatever directory the script was started in. */
function indexEntries(root) {
  return git(root, ['ls-files', '-s', '-z'])
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      return { mode: line.slice(0, 6), path: line.slice(tab + 1) };
    });
}

/** Tracked files whose indexed contents hold the marker. */
function filesWithMarker(root) {
  try {
    return git(root, ['grep', '--cached', '-a', '-z', '-l', '-F', '-e', MARKER]).split('\0').filter(Boolean).sort();
  } catch (err) {
    // `git grep` exits 1 when nothing matches; anything else is a real failure.
    if (err.status === 1) return [];
    throw err;
  }
}

export function main() {
  const root = git(process.cwd(), ['rev-parse', '--show-toplevel']).trim();
  const entries = indexEntries(root);
  const dirs = trackedExtDirs(entries);
  const marked = filesWithMarker(root);

  for (const d of dirs) {
    console.error(
      `::error file=${escapeProperty(d)}::${escapeMessage('A directory, symlink or submodule under src/lib/ext/ is tracked. An extension lives there untracked (see src/lib/ext/README.md).')}`,
    );
  }
  for (const f of marked) {
    console.error(
      `::error file=${escapeProperty(f)}::${escapeMessage('This tracked file holds the private-extension marker. Keep it out of this repository.')}`,
    );
  }
  if (dirs.length + marked.length > 0) {
    console.error(`\n${dirs.length} tracked extension entr${dirs.length === 1 ? 'y' : 'ies'}, ${marked.length} marked file(s).`);
    return 1;
  }
  console.log(`OK — no tracked extension directory and no marker in ${entries.length} tracked files.`);
  return 0;
}

// Compare real paths as URLs: a space or a symlink in the path must not turn a
// guard into a no-op that exits 0.
function isEntryPoint() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exit(main());
}
