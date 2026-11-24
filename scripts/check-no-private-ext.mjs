// #2566 (C1) — keep a private extension out of this public repository.
//
// A deployment adds its own screens by dropping a directory under
// `src/lib/ext/<id>/` (see src/lib/ext/README.md). `.gitignore` keeps such a
// directory untracked, but a force-add or a route file carrying a private
// module's marker would still publish it, and `.gitignore` is advisory. So this
// fails when:
//   - `git ls-files` shows any directory under `src/lib/ext/` (the registry's own
//     files sit directly in it and stay tracked), or
//   - a tracked file contains the private marker.
//
// It reads TRACKED files only (`git ls-files`, `git grep`), never the working
// tree: a composed overlay keeps its files untracked on purpose, and they must
// not trip it.
//
// The marker is assembled below, so this file never holds it literally and
// needs no exclusion list (a list is where a real offender hides).
import { execFileSync } from 'node:child_process';

export const MARKER = '@portal-' + 'private-extension';

const EXT_ROOT = 'src/lib/ext/';

/** Tracked paths that put a directory under `src/lib/ext/`. */
export function trackedExtDirs(paths) {
  const dirs = new Set();
  for (const p of paths) {
    if (!p.startsWith(EXT_ROOT)) continue;
    const rest = p.slice(EXT_ROOT.length).split('/');
    if (rest.length > 1) dirs.add(EXT_ROOT + rest[0]);
  }
  return [...dirs].sort();
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

/** Tracked files whose working-tree contents hold the marker. */
function filesWithMarker() {
  try {
    return git(['grep', '-z', '-l', '-F', '-e', MARKER]).split('\0').filter(Boolean).sort();
  } catch (err) {
    // `git grep` exits 1 when nothing matches; anything else is a real failure.
    if (err.status === 1) return [];
    throw err;
  }
}

export function main() {
  const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean);
  const dirs = trackedExtDirs(tracked);
  const marked = filesWithMarker();

  for (const d of dirs) {
    console.error(
      `::error file=${d}::A directory under src/lib/ext/ is tracked. An extension lives there untracked (see src/lib/ext/README.md).`,
    );
  }
  for (const f of marked) {
    console.error(`::error file=${f}::This tracked file holds the private-extension marker. Keep it out of this repository.`);
  }
  if (dirs.length + marked.length > 0) {
    console.error(`\n${dirs.length} tracked extension director${dirs.length === 1 ? 'y' : 'ies'}, ${marked.length} marked file(s).`);
    return 1;
  }
  console.log(`OK — no tracked extension directory and no marker in ${tracked.length} tracked files.`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
