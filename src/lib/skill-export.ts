/**
 * portal#864 Part A — the `properties.exports.<host>` skill declaration.
 *
 * Shape settled by D12 (hadron-cli#627/#628, hadron-server#1225):
 *
 *   { "exports": { "claudeSkill": { name, description, enable } } }
 *
 * Keyed by host, so one-export-per-host is structural. The name is stored
 * WHOLE — no prefix, no derivation. `enable` must be true to publish and
 * DEFAULTS TO OFF, which is what makes a mistyped declaration silent: it
 * simply never exports, with no error and no file.
 *
 * ## Why every function here takes and returns the WHOLE properties bag
 *
 * hadron-server#1227: `updateNodeProperties` merges exactly ONE level
 * (`{ ...existing, ...patch }`), and D12 made `exports` two. A client that
 * patches one host writes `{ exports: { claudeSkill: … } }`, the shallow merge
 * replaces the whole `exports` value, and **every sibling host declaration is
 * destroyed** — silently, because nothing errors and the only symptom is a
 * skill that stops exporting for a host nobody touched.
 *
 * There is no live instance today: `claudeSkill` is the only host. That is
 * precisely why it is cheap to get right now, and why the tests here construct
 * a sibling host that does not exist yet — no fixture in either repo has two,
 * which is exactly why every suite currently passes on code that would destroy
 * one.
 *
 * So these helpers never produce a patch. They read the whole bag and return
 * the whole bag, and the edit page submits it entire. Read-modify-write is not
 * a precaution here; it is the only shape that cannot lose a sibling.
 */

/** The one host that exists today. D12 makes a second one structural, not a rewrite. */
export const CLAUDE_SKILL_HOST = 'claudeSkill';

/**
 * The server's cap on a skill description.
 *
 * Six of the twenty declarations in the corpus already exceed it, and a user
 * has no way to discover that until an export fails — which is why the editor
 * counts against the LIVE value rather than validating on save.
 */
export const DESCRIPTION_MAX = 1024;

export interface SkillDeclaration {
  name: string;
  description: string;
  enable: boolean;
}

/** An absent declaration and a switched-off one are DIFFERENT states (#864). */
export type DeclarationState = 'absent' | 'declared-off' | 'declared-on';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The `exports` map as an object, or `{}`.
 *
 * Tolerates junk rather than throwing: `properties` is a free-form JSON bag a
 * user can hand-edit, and a malformed `exports` must not take the whole editor
 * down. A non-object is treated as absent — and `writeDeclaration` will then
 * replace it, which is the only honest option once it cannot be parsed.
 */
export function readExports(properties: unknown): Record<string, unknown> {
  if (!isObject(properties)) return {};
  const ex = properties.exports;
  return isObject(ex) ? ex : {};
}

/**
 * One host's declaration, or null when it is absent or unreadable.
 *
 * Missing fields are filled rather than rejected: a declaration a human typed
 * by hand into the raw textarea — which is how every one of them was written
 * until now — may legally be missing `enable`, and reading it as absent would
 * silently discard the `name` the user did write.
 */
export function readDeclaration(
  properties: unknown,
  host: string = CLAUDE_SKILL_HOST,
): SkillDeclaration | null {
  const decl = readExports(properties)[host];
  if (!isObject(decl)) return null;
  return {
    name: typeof decl.name === 'string' ? decl.name : '',
    description: typeof decl.description === 'string' ? decl.description : '',
    // Absent `enable` reads as OFF, matching the platform default. A
    // declaration is not published because someone forgot the key.
    enable: decl.enable === true,
  };
}

/** Absent / declared-but-off / declared-and-on — the distinction the UI must show. */
export function declarationState(
  properties: unknown,
  host: string = CLAUDE_SKILL_HOST,
): DeclarationState {
  const decl = readDeclaration(properties, host);
  if (!decl) return 'absent';
  return decl.enable ? 'declared-on' : 'declared-off';
}

/**
 * The whole properties bag with ONE host's declaration set, every sibling host
 * and every unrelated property key preserved.
 *
 * Passing `null` removes that host, and removes `exports` entirely when it was
 * the last one — an empty `exports: {}` left behind is a declaration a reader
 * cannot distinguish from a real one at a glance, and `listDeclaredIDs` would
 * have to special-case it.
 */
export function writeDeclaration(
  properties: unknown,
  decl: SkillDeclaration | null,
  host: string = CLAUDE_SKILL_HOST,
): Record<string, unknown> {
  const base = isObject(properties) ? { ...properties } : {};
  const exports = { ...readExports(properties) };

  if (decl === null) delete exports[host];
  else exports[host] = { name: decl.name, description: decl.description, enable: decl.enable };

  if (Object.keys(exports).length === 0) delete base.exports;
  else base.exports = exports;

  return base;
}

/**
 * Advisory problems with a declaration, for display beside the fields.
 *
 * Advisory on purpose — the server is the authority, and this editor must not
 * refuse to save something the platform would accept. It exists so a user
 * learns about the cap BEFORE an export fails rather than after.
 */
export function declarationProblems(decl: SkillDeclaration): string[] {
  const out: string[] = [];
  if (decl.enable && !decl.name.trim()) {
    out.push('An enabled export needs a name — without one there is nothing to write.');
  }
  if (decl.description.length > DESCRIPTION_MAX) {
    out.push(
      `The description is ${decl.description.length} characters; the limit is ${DESCRIPTION_MAX}.`,
    );
  }
  return out;
}
