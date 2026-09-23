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
 * hadron-server#1227 was FIXED on the server: `updateNodeProperties` now
 * applies `exports` as a JSON Merge Patch under a per-node lock, so two
 * clients toggling different hosts both land. The portal CANNOT use it for
 * skills, though, and the reason is structural: a skill exports only from a
 * RUNNABLE node, a runnable node is a governed `task`, and
 * `updateNodeProperties` writes through the generic door, which refuses any
 * edit to a governed node (`assertGovernedWrite`, "edits"). The atomic merge
 * is unreachable for exactly the nodes whose `exports` matter. Reported for
 * the server (portal#890); until a task-door equivalent exists, the only write
 * available is `updateTaskNode` with the WHOLE bag.
 *
 * So these helpers never produce a patch. They read the whole bag and return
 * the whole bag, computed from the freshest read the caller can make.
 * Read-modify-write is not a preference here: it is the only write the door
 * allows, and it keeps every sibling host and property the read saw. What it
 * cannot do is protect a concurrent writer between the read and the write.
 */

import { t } from '$lib/i18n/t';

/** The host D12 shipped, and the only one the server judges today. */
export const CLAUDE_SKILL_HOST = 'claudeSkill';

/**
 * #878 / #888 — the Codex host key: `codexSkill`, the pair of `claudeSkill`.
 *
 * #887 shipped `codex`, which no host recognizes: server#1254/#1280 and
 * cli#622 all declare `exports.codexSkill`, so the checkbox showed "for Claude
 * and Codex" while Codex silently never got the skill (Eli's measurement on
 * #888). A declaration is per-host (D12), so one checkbox that exports
 * everywhere declares under EVERY host key — and the key is the contract, so
 * the literal payload is pinned in `skill-export.test.ts` against #888.
 */
export const CODEX_HOST = 'codexSkill';

/** Every host one checkbox declares, in display order. */
export const SKILL_HOSTS: readonly string[] = [CLAUDE_SKILL_HOST, CODEX_HOST];

/** The server's skill-name grammar (hadron-server `skilldoc/name.ts`). */
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const NAME_MAX = 64;

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
  // A field of the WRONG TYPE is not something this form can edit, and
  // coercing it to '' would silently overwrite the stored value on the next
  // save (@copilot on #867). `readableDeclaration` is the gate: anything this
  // cannot represent faithfully is left to the raw editor.
  if (!isReadableDeclaration(decl)) return null;
  return {
    name: typeof decl.name === 'string' ? decl.name : '',
    description: typeof decl.description === 'string' ? decl.description : '',
    // Absent `enable` reads as OFF, matching the platform default. A
    // declaration is not published because someone forgot the key.
    enable: decl.enable === true,
  };
}

/**
 * Can this entry be shown in the typed form WITHOUT losing anything?
 *
 * Absent fields are fine — a hand-typed declaration legitimately omits
 * `enable`, and filling that in is the point. A field of the wrong TYPE is not:
 * `{ name: 42 }` would render as an empty name and write `''` back over the 42
 * on the next save, destroying a value the user was never shown.
 *
 * So the rule matches the one on `writeDeclaration`: this editor handles only
 * what it can represent faithfully, and leaves everything else to the raw JSON
 * editor, which shows it verbatim.
 */
function isReadableDeclaration(decl: Record<string, unknown>): boolean {
  const okString = (v: unknown) => v === undefined || typeof v === 'string';
  const okBool = (v: unknown) => v === undefined || typeof v === 'boolean';
  // A key this form does not model is not representable either: the form
  // writes back exactly name/description/enable, so an extra key would be
  // dropped by a Save that touched nothing (@copilot on #887). Such an entry
  // is left to the raw editor, verbatim, like a wrongly-typed one.
  const onlyKnownKeys = Object.keys(decl).every((k) => DECLARATION_KEYS.has(k));
  return onlyKnownKeys && okString(decl.name) && okString(decl.description) && okBool(decl.enable);
}

const DECLARATION_KEYS = new Set(['name', 'description', 'enable']);

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
  const raw = isObject(properties) ? properties.exports : undefined;
  const readable = isObject(raw);

  // REMOVING WHAT IS NOT THERE MUST BE A NO-OP, and that is not a nicety.
  //
  // The edit page seeds its raw-properties editor with `withoutSkillExport`,
  // which calls `writeDeclaration(props, null, host)` once per host — "the bag
  // minus the part I own". Without this guard that call
  // DELETED an `exports` the editor cannot represent and the user never
  // touched: a malformed value (`exports: "oops"`), or a host entry that is not
  // an object. Opening such a node and pressing Save destroyed it silently
  // (@copilot on #867).
  //
  // So a removal only acts on what the editor could DISPLAY — the host present
  // AND its entry an object. An unreadable entry renders as "absent", so
  // removing it would delete something the user was never shown and never
  // asked about. The invariant is: this function removes only what
  // `readDeclaration` can return.
  const entry = readable ? (raw as Record<string, unknown>)[host] : undefined;
  const removable = isObject(entry) && isReadableDeclaration(entry);
  if (decl === null && !removable) return base;

  // A non-null declaration on an unreadable `exports` REPLACES it — there is no
  // way to merge into a string, and the user explicitly asked for a
  // declaration. That is the one case where this function discards something,
  // and it takes a deliberate act to reach.
  const exports = { ...(readable ? (raw as Record<string, unknown>) : {}) };

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
export function declarationProblems(
  decl: SkillDeclaration,
  opts: { runnable?: boolean } = {},
): string[] {
  const out: string[] = [];
  const name = decl.name.trim();
  if (decl.enable && !name) {
    out.push(
      t('skill-export.problem.name-missing', 'An enabled export needs a name — without one there is nothing to write.'),
    );
  } else if (name && !validSkillName(decl.name)) {
    out.push(
      t(
        'skill-export.problem.name-invalid',
        'A skill name uses lowercase letters, digits and single hyphens, up to {max} characters.',
        { max: NAME_MAX },
      ),
    );
  }
  if (decl.enable && !decl.description.trim()) {
    out.push(
      t(
        'skill-export.problem.description-missing',
        'An enabled export needs a description — it tells the agent when to use the skill.',
      ),
    );
  }
  const used = codePoints(decl.description);
  if (used > DESCRIPTION_MAX) {
    out.push(
      t(
        'skill-export.problem.description-too-long',
        'The description is {used} characters; the limit is {max}.',
        { used, max: DESCRIPTION_MAX },
      ),
    );
  }
  if (decl.enable && opts.runnable === false) {
    // Names no control: the edit page has none since #878 (Runnable is on the
    // Settings tab), and the editor renders its own "Mark it runnable" action
    // beside this message (@copilot on #887).
    out.push(
      t('skill-export.problem.not-runnable', 'Only a runnable node is exported, and this one is not runnable.'),
    );
  }
  return out;
}

/**
 * Length the way the server measures it: in CODE POINTS, not UTF-16 units.
 * `String.length` counts an emoji as two, so a description the server accepts
 * would be reported over the cap here.
 */
export function codePoints(s: string): number {
  return Array.from(s).length;
}

/** Whether `name` satisfies the server's skill-name grammar and cap. */
export function validSkillName(name: string): boolean {
  return codePoints(name) <= NAME_MAX && NAME_RE.test(name);
}

function slugify(source: string): string {
  const slug = source
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= NAME_MAX) return slug;
  // Cut at the last hyphen inside the cap so a word is not split mid-way;
  // a single over-long word has no hyphen to cut at and is cut hard.
  const cut = slug.slice(0, NAME_MAX);
  const atHyphen = cut.lastIndexOf('-');
  return (atHyphen > 0 ? cut.slice(0, atHyphen) : cut).replace(/-+$/, '');
}

/**
 * #878 — the name a freshly checked export starts with.
 *
 * The loc's LAST segment first, because that is what a node is already called
 * in its tree (a loc whose last segment is drive-pr-home gives
 * `drive-pr-home`) and is usually kebab-case already; then the node name.
 * Either is reduced to the server's grammar, so the default is a name the
 * server accepts — a default the user then has to fix is not a default.
 *
 * When neither has an ASCII letter or digit (a loc and name of only emoji or
 * non-Latin script slugify to nothing), the node's id is the last resort:
 * `skill-<id>`, which is always in the grammar and unique to the node
 * (@copilot on #887). Only an id with nothing usable yields ''.
 */
export function defaultSkillName(loc: string, nodeName: string, nodeId = ''): string {
  const last = loc.split(':').pop() ?? '';
  const fromNode = slugify(last) || slugify(nodeName);
  if (fromNode) return fromNode;
  const id = slugify(nodeId);
  return id ? slugify(`skill-${id}`) : '';
}

/** The skill export the edit page owns: ONE declaration, written to `hosts`. */
export interface SkillExport {
  declaration: SkillDeclaration;
  /** The hosts it is written to. Checking the box writes every host. */
  hosts: string[];
}

/**
 * The node's skill export as the one-checkbox editor sees it.
 *
 * `divergent` means the stored host entries cannot be shown as ONE
 * declaration — they disagree, or one is present but unreadable. The editor
 * then owns none of them and leaves the whole `exports` to the raw properties
 * editor, because writing one declaration back would overwrite the other host
 * with values the user was never shown.
 */
export function readSkillExport(properties: unknown): {
  value: SkillExport | null;
  divergent: boolean;
} {
  const exports = readExports(properties);
  const hosts: string[] = [];
  const decls: SkillDeclaration[] = [];
  for (const host of SKILL_HOSTS) {
    if (exports[host] === undefined) continue;
    const decl = readDeclaration(properties, host);
    if (!decl) return { value: null, divergent: true };
    hosts.push(host);
    decls.push(decl);
  }
  if (decls.length === 0) return { value: null, divergent: false };
  const [first] = decls;
  const same = decls.every(
    (d) => d.name === first.name && d.description === first.description && d.enable === first.enable,
  );
  if (!same) return { value: null, divergent: true };
  return { value: { declaration: first, hosts }, divergent: false };
}

/**
 * The bag minus the host entries the editor owns — what the raw properties
 * editor is seeded with. A divergent bag is returned whole: the editor owns
 * nothing in it.
 */
export function withoutSkillExport(properties: unknown): Record<string, unknown> {
  const base = isObject(properties) ? { ...properties } : {};
  if (readSkillExport(properties).divergent) return base;
  return SKILL_HOSTS.reduce<Record<string, unknown>>(
    (bag, host) => writeDeclaration(bag, null, host),
    base,
  );
}

/** `rest` with the editor's declaration written to each of its hosts. */
export function writeSkillExport(
  rest: unknown,
  value: SkillExport | null,
): Record<string, unknown> {
  const base = isObject(rest) ? { ...rest } : {};
  if (!value) return base;
  return value.hosts.reduce<Record<string, unknown>>(
    (bag, host) => writeDeclaration(bag, value.declaration, host),
    base,
  );
}

/**
 * #878 — what checking the box does. It turns the export ON, for EVERY host,
 * and fills any empty field with its default. A field the user already wrote is
 * kept: re-checking after an uncheck must not replace their name.
 */
export function enableSkillExport(
  value: SkillExport | null,
  defaults: { name: string; description: string },
): SkillExport {
  const d = value?.declaration;
  return {
    declaration: {
      name: d?.name.trim() ? d.name : defaults.name,
      description: d?.description.trim() ? d.description : defaults.description,
      enable: true,
    },
    hosts: [...SKILL_HOSTS],
  };
}

/**
 * #879 — one task's export as the Task Nodes list shows it.
 *
 * `divergent` is its own state rather than a guess at "on" or "off": the hosts
 * disagree (a per-host setup made in the CLI or raw JSON), and a list checkbox
 * that picked a side would flatten it on the next click. The row offers the
 * node's edit page instead, where the raw properties editor shows every host.
 */
export type RowExportState =
  | { kind: 'none' }
  | { kind: 'off'; hosts: string[] }
  | { kind: 'on'; hosts: string[]; declaration: SkillDeclaration }
  | { kind: 'divergent' };

export function rowExportState(properties: unknown): RowExportState {
  const { value, divergent } = readSkillExport(properties);
  if (divergent) return { kind: 'divergent' };
  if (!value) return { kind: 'none' };
  return value.declaration.enable
    ? { kind: 'on', hosts: value.hosts, declaration: value.declaration }
    : { kind: 'off', hosts: value.hosts };
}

/** What the list's checkbox does to a node's stored properties. */
export type ToggleResult =
  | { kind: 'write'; properties: Record<string, unknown> }
  | { kind: 'unchanged' }
  | { kind: 'divergent' };

/**
 * #879 — the whole properties bag after the Task Nodes checkbox, computed from
 * the STORED bag (the action re-reads the node; the page's copy may be stale).
 *
 * Holger's design (#879, 2026-09-21): checked writes the declaration for BOTH
 * hosts with `enable: true`; unchecked sets `enable: false` "and no other
 * changes", so the name and description survive and re-checking restores them.
 * It is the same pair of transitions as the edit page's checkbox — the same
 * functions, so the two surfaces cannot drift.
 *
 * Unchecking does not add a host that is not declared, and asking for the state
 * the node is already in writes nothing: a double-submit or a stale second tab
 * must not create a node version for a no-op.
 */
export function toggleSkillExport(
  properties: unknown,
  enable: boolean,
  defaults: { name: string; description: string },
): ToggleResult {
  const { value, divergent } = readSkillExport(properties);
  if (divergent) return { kind: 'divergent' };
  const on = value?.declaration.enable === true;
  if (enable === on) return { kind: 'unchanged' };
  const rest = withoutSkillExport(properties);
  const next: SkillExport = enable
    ? enableSkillExport(value, defaults)
    : { ...value!, declaration: { ...value!.declaration, enable: false } };
  return { kind: 'write', properties: writeSkillExport(rest, next) };
}

/**
 * #879 — what the Task Nodes page receives about a row's export. Reduced from
 * the properties bag on the SERVER, so the page never gets the bag itself.
 */
export type TaskExport =
  | { kind: 'none' | 'off' | 'divergent' }
  | { kind: 'on'; hosts: string[] };

export function taskExport(properties: unknown): TaskExport {
  const s = rowExportState(properties);
  return s.kind === 'on' ? { kind: 'on', hosts: s.hosts } : { kind: s.kind };
}

const HOST_LABELS: Record<string, string> = { [CLAUDE_SKILL_HOST]: 'Claude', [CODEX_HOST]: 'Codex' };

/** A host key as a reader knows it — "Codex", not `codexSkill`. */
export function hostLabel(host: string): string {
  return HOST_LABELS[host] ?? host;
}

/**
 * The note a Task Nodes row renders beside (or instead of) its checkbox — and
 * therefore also what the grid's search must match for that row
 * (`hrn:node:hadronmemory.com:hadron-portal:review:everything-the-cell-renders-must-be-searchable`). ONE function for
 * both, so the cell and the filter cannot say different things. Empty for the
 * ordinary rows, which render a bare checkbox.
 */
export function taskExportNote(s: TaskExport): string {
  if (s.kind === 'divergent') return t('tasks.export.divergent', 'Differs per host');
  if (s.kind === 'on' && SKILL_HOSTS.some((h) => !s.hosts.includes(h))) {
    return t('tasks.export.only', '{hosts} only', { hosts: s.hosts.map(hostLabel).join(', ') });
  }
  return '';
}
