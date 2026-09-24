/**
 * #909 — the Claude plugin's version, derived from its content.
 *
 * The SAME recipe as the CLI's `hadron skill plugin` (hadron-cli#707,
 * `buildArtifact` in internal/cmd/skill/plugin.go), so one rule answers "did
 * this plugin change?" whichever producer built it. Claude Code updates an
 * installed plugin on ANY version change, a lower-sorting one included
 * (measured on 2.1.143, cli#707 C4), so a hash is a valid version and needs no
 * counter anywhere.
 *
 * The hash covers everything the version stands for: the manifest's name and
 * description, then every skill in name order, name before body. Each part is
 * written as `<byte length>:<value>`, so no body can be read as the next name.
 * Lengths are UTF-8 BYTES, as Go's `len` counts them, and names sort by bytes,
 * as Go's `sort.Strings` does — a UTF-16 length or `localeCompare` order would
 * silently disagree with the CLI on the first non-ASCII body.
 *
 * `0.0.0-h<12 hex>`: the `h` keeps the pre-release identifier alphanumeric,
 * since an all-digit one with a leading zero is not valid semver.
 *
 * Server-only (node:crypto); `planBundle` takes it as an argument so
 * `$lib/skill-bundle` stays importable in the browser.
 */

import { createHash } from 'node:crypto';

const utf8 = new TextEncoder();

function byteCompare(a: string, b: string): number {
  const x = utf8.encode(a);
  const y = utf8.encode(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}

export function pluginVersion(name: string, description: string, skills: Record<string, string>): string {
  const sum = createHash('sha256');
  const part = (v: string) => {
    const bytes = utf8.encode(v);
    sum.update(`${bytes.length}:`);
    sum.update(bytes);
  };
  part(name);
  part(description);
  for (const n of Object.keys(skills).sort(byteCompare)) {
    part(n);
    part(skills[n]);
  }
  return `0.0.0-h${sum.digest('hex').slice(0, 12)}`;
}
