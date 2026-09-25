/**
 * #879 — the files in the Task Nodes download, per target host.
 *
 * Pure: takes the server's EXPORT plan and returns paths and contents. Zipping
 * is the endpoint's job, so every decision about WHAT goes in the archive is
 * testable without one.
 *
 * ## Two hosts, two shapes — measured, not assumed (#879 asked for exactly this)
 *
 * Checked against each host's own docs on 2026-09-23:
 *
 * - **Claude** (Cowork: Customize → Plugins → upload): a PLUGIN — the plugin
 *   root at the zip root, holding `.claude-plugin/plugin.json` (only `name` is
 *   required, kebab-case, ≤ 64) and one `skills/<name>/SKILL.md` per skill.
 *   https://code.claude.com/docs/en/plugins-reference,
 *   https://claude.com/docs/cowork/guide/plugins
 *
 * - **Codex**: reads a Claude-layout plugin, but installs plugins only through a
 *   marketplace added from a folder or a git repo — there is no documented zip
 *   install. What IS documented is skill discovery from `~/.agents/skills`, so
 *   the Codex download is a zip of `<name>/SKILL.md` folders to unzip there.
 *   https://learn.chatgpt.com/docs/build-skills,
 *   https://developers.openai.com/plugins/build/plugins
 *
 * "Codex has the same plugin support as Claude" held for the FORMAT and not for
 * the INSTALL, which is the half a non-technical user meets.
 */

import { t } from '$lib/i18n/t';
import { hostLabel, validSkillName } from '$lib/skill-export';

export type SkillBundleHost = 'claudeSkill' | 'codexSkill';

export const BUNDLE_HOSTS: readonly SkillBundleHost[] = ['claudeSkill', 'codexSkill'];

export function isBundleHost(v: unknown): v is SkillBundleHost {
  return typeof v === 'string' && (BUNDLE_HOSTS as readonly string[]).includes(v);
}

/** One entry of `skillPlan(intent: EXPORT)`, as SKILL_PLAN_EXPORT_QUERY selects it. */
export interface PlanEntry {
  nodeId: string;
  urn: string;
  name: string;
  class: string | null;
  renderedBody: string | null;
  /**
   * The server's planned action and its display-ready reasons. The reasons
   * are what explain a SKIP or FAIL that carries no error finding — a locked
   * memory, a name collision — so the report can say why without the portal
   * recreating server policy.
   */
  exportPlan?: { action: string; reasons: Array<{ code: string; message: string }> } | null;
  findings: Array<{ rule: string; severity: string; message: string }>;
}

/** A skill that is declared and enabled but NOT in the archive, and why. */
export interface SkippedSkill {
  name: string;
  urn: string;
  /** The server's error findings, or the portal's own refusal. */
  reasons: string[];
}

export interface SkillBundle {
  /** Archive path → file contents. */
  files: Record<string, string>;
  /** Suggested download filename. */
  filename: string;
  included: Array<{ name: string; urn: string }>;
  /**
   * The same skills as `included`, by node id — identity for joining other
   * plan lists, which a URN is not reliably (an emitted URN is lossy:
   * `hrn:node:hadronmemory.com:dev:findings:emitted-node-urn-is-lossy-compare-identity`).
   */
  includedNodeIds: string[];
  skipped: SkippedSkill[];
  /**
   * The Claude plugin's content-derived version (#909), `null` for Codex,
   * whose download is bare skill folders with no manifest to carry one.
   */
  version: string | null;
}

/**
 * Derives a plugin version from what the manifest stands for (#909). The
 * portal's is `pluginVersion` in `$lib/server/plugin-version`, passed in so
 * this module stays free of node:crypto and importable in the browser.
 */
export type PluginVersioner = (name: string, description: string, skills: Record<string, string>) => string;

const MAX_PLUGIN_NAME = 64;

/**
 * The plugin's name: `<org>-skills`, reduced to the plugin grammar (lowercase
 * words joined by single hyphens, ≤ 64). Falls back to `hadron-skills` for an
 * org name with nothing usable in it, rather than emitting an empty name the
 * install dialog would refuse.
 */
export function pluginName(orgName: string): string {
  const base = orgName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const suffix = '-skills';
  if (!base) return `hadron${suffix}`;
  const room = MAX_PLUGIN_NAME - suffix.length;
  const cut = base.length <= room ? base : base.slice(0, room).replace(/-+$/, '');
  return `${cut}${suffix}`;
}

/**
 * One plan entry's verdict: the body to ship, or why not. Shared by the org
 * download and the single-skill download (#911), so the two cannot disagree
 * about what is exportable.
 *
 * The server's own words come first — error findings, then the export plan's
 * reasons, deduplicated, since a finding can also be the plan's reason. The
 * portal adds two refusals of its own, both because a skill name becomes a
 * PATH: a name outside the skill grammar, and (`duplicate`) a name another
 * entry in the same archive also claims.
 */
function serverReasons(e: PlanEntry): string[] {
  return [
    ...new Set([
      ...e.findings.filter((f) => f.severity === 'error').map((f) => f.message),
      ...(e.exportPlan?.action && e.exportPlan.action !== 'WRITE' ? e.exportPlan.reasons.map((r) => r.message) : []),
    ]),
  ];
}

function judgeEntry(e: PlanEntry, duplicate: boolean): { ok: true; body: string } | { ok: false; reasons: string[] } {
  const errors = serverReasons(e);
  if (!validSkillName(e.name)) {
    return { ok: false, reasons: [...errors, t('skill-bundle.skip.invalid-name', '"{name}" is not a valid skill name.', { name: e.name })] };
  }
  if (duplicate) {
    return { ok: false, reasons: [...errors, t('skill-bundle.skip.duplicate-name', 'Another task is also named "{name}".', { name: e.name })] };
  }
  // A body is written only when the server both rendered one AND planned a
  // WRITE, explicitly: a body beside any other planned action is not ours to
  // ship, and neither is one with NO planned action — the schema promises an
  // exportPlan on every EXPORT entry, so its absence is a broken response,
  // not permission (@copilot on #912).
  if (!e.renderedBody || e.exportPlan?.action !== 'WRITE') {
    return {
      ok: false,
      reasons: errors.length > 0 ? errors : [t('skill-bundle.skip.not-exportable', 'Not exportable ({class}).', { class: e.class ?? 'unreadable' })],
    };
  }
  return { ok: true, body: e.renderedBody };
}

/**
 * Split the plan into what goes in the archive and what does not.
 *
 * The server withholds a body from anything it judged broken, so "no body" is
 * the server's verdict and the reasons are its error findings. The portal adds
 * two refusals of its own, both because a skill name becomes a PATH here:
 * a name outside the skill grammar is never used as a directory, and two
 * entries with one name are both left out — keeping either would silently
 * choose, and the server's collision lint normally catches this first.
 *
 * `disabled` entries are not skipped skills: the user unticked them, and
 * listing them as failures would report a choice as an error.
 */
export function planBundle(
  entries: PlanEntry[],
  host: SkillBundleHost,
  orgName: string,
  versionOf: PluginVersioner,
): SkillBundle {
  const plugin = pluginName(orgName);
  const files: Record<string, string> = {};
  /** Skill name → body: exactly what the version is derived from. */
  const skills: Record<string, string> = {};
  const included: SkillBundle['included'] = [];
  const includedNodeIds: string[] = [];
  const skipped: SkippedSkill[] = [];

  const wanted = entries.filter((e) => e.class !== 'disabled');
  const nameCount = new Map<string, number>();
  for (const e of wanted) nameCount.set(e.name, (nameCount.get(e.name) ?? 0) + 1);

  for (const e of wanted) {
    const v = judgeEntry(e, (nameCount.get(e.name) ?? 0) > 1);
    if (!v.ok) {
      skipped.push({ name: e.name, urn: e.urn, reasons: v.reasons });
      continue;
    }
    const path = host === 'claudeSkill' ? `skills/${e.name}/SKILL.md` : `${e.name}/SKILL.md`;
    files[path] = v.body;
    skills[e.name] = v.body;
    included.push({ name: e.name, urn: e.urn });
    includedNodeIds.push(e.nodeId);
  }

  let version: string | null = null;
  if (host === 'claudeSkill') {
    // #909: the name stays `<org>-skills` — an installed plugin's identity is
    // its name, and renaming it would strand every existing install. Only the
    // version is new, so Claude sees an update exactly when the content moved.
    const description = `Skills exported from ${orgName || 'Hadron'} on Hadron.`;
    version = versionOf(plugin, description, skills);
    files['.claude-plugin/plugin.json'] = JSON.stringify({ name: plugin, version, description }, null, 2) + '\n';
  }

  const filename = host === 'claudeSkill' ? `${plugin}.zip` : `${plugin}-codex.zip`;
  return { files, filename, included, includedNodeIds, skipped, version };
}

/** #911 — one task as one skill, for either host. */
export interface SkillDownload {
  /** Archive path → file contents; empty when nothing can be shipped. */
  files: Record<string, string>;
  /** `<name>.zip`, or null when nothing can be shipped. */
  filename: string | null;
  /** Why nothing was shipped — the server's words where it gave any. Empty on success. */
  reasons: string[];
}

/**
 * #911 — the file for ONE task's single-skill download: `<name>.zip` holding
 * the skill FOLDER, `<name>/SKILL.md`.
 *
 * The same artifact serves both hosts — measured against their docs, not
 * assumed (`hrn:node:hadronmemory.com:hadron-portal:findings:skill-download-artifact-shape-per-host`):
 * claude.ai's single-skill upload (Customize → Skills) wants the folder at the
 * zip root, and Codex discovers skill folders under `~/.agents/skills`. One
 * skill needs no plugin wrapper, so there is no manifest and no version.
 *
 * `entry` is this node's entry in its memory's EXPORT plan, or undefined when
 * the plan has none — the export was switched off after the page loaded, say.
 * The duplicate-name refusal does not apply: one entry cannot collide with
 * itself, and a collision with another node is the server's `collision` class.
 */
export function planSkillDownload(entry: PlanEntry | undefined, host: SkillBundleHost): SkillDownload {
  const none = (reasons: string[]): SkillDownload => ({ files: {}, filename: null, reasons });
  const hostName = hostLabel(host);
  if (!entry) {
    return none([t('skill-bundle.single.not-in-plan', 'The export plan has no {host} entry for this task. Its export may have been switched off since this page loaded; reload the page to see its current state.', { host: hostName })]);
  }
  if (entry.class === 'disabled') {
    // The server's own reasons when it gave any; the portal's sentence only
    // stands in when it gave none (@copilot on #912).
    const words = serverReasons(entry);
    return none(words.length > 0 ? words : [t('skill-bundle.single.disabled', 'This task’s {host} export is switched off.', { host: hostName })]);
  }
  const v = judgeEntry(entry, false);
  if (!v.ok) return none(v.reasons);
  return { files: { [`${entry.name}/SKILL.md`]: v.body }, filename: `${entry.name}.zip`, reasons: [] };
}

/** One item of `SkillPlan.unrecognized` (server#1296), as SKILL_PLAN_EXPORT_QUERY selects it. */
export interface PlanUnrecognized {
  nodeId: string;
  urn: string;
  /** The node's display name — an unrecognised key declares no skill name. */
  name: string;
  /** The TRUE number of unrecognised keys. `keys` is capped, so never count those. */
  keyCount: number;
  keys: string[];
  /** Warnings, attributed to no host: one per listed key, one for any unlisted. */
  findings: Array<{ rule: string; severity: string; message: string }>;
}

/** A node carrying export keys that name no host, as the download report shows it. */
export interface UnrecognizedNode {
  name: string;
  urn: string;
  /** Whether the node's skill is in THIS download (via a key a host does read). */
  inDownload: boolean;
  keyCount: number;
  /** The server's own warnings, verbatim. */
  messages: string[];
}

/**
 * server#1296 — the nodes whose `properties.exports` carries a key no host
 * reads (`codex` for `codexSkill`, say). Without this a node declaring ONLY
 * such keys is in neither the plan's entries nor the other-host list, so it
 * vanished from the report with nothing saying why — the failure #879 is
 * written against.
 *
 * The list is host-identical (the key belongs to no host), so one plan's copy
 * is the whole answer; it is still deduplicated by node id, per the contract.
 * `inDownload` joins on node id, never on URN. A node listed here may well be
 * in the zip through a key a host does read: the report says so rather than
 * calling it left out.
 */
export function unrecognizedReport(
  unrecognized: PlanUnrecognized[],
  includedNodeIds: readonly string[],
): UnrecognizedNode[] {
  const included = new Set(includedNodeIds);
  const seen = new Set<string>();
  const out: UnrecognizedNode[] = [];
  for (const u of unrecognized) {
    if (seen.has(u.nodeId)) continue;
    seen.add(u.nodeId);
    out.push({
      name: u.name,
      urn: u.urn,
      inDownload: included.has(u.nodeId),
      keyCount: u.keyCount,
      messages: u.findings.map((f) => f.message),
    });
  }
  return out;
}

/** The other host of the two — the one a download for `host` does not judge. */
export function otherBundleHost(host: SkillBundleHost): SkillBundleHost {
  return host === 'claudeSkill' ? 'codexSkill' : 'claudeSkill';
}

/**
 * #879 (@codex on #890) — tasks exported for the OTHER host but not judged for
 * this one: a single-host declaration. The EXPORT plan for `host` scans such a
 * node and leaves it out of `entries` entirely, so without this a checked
 * Claude-only task simply vanishes from a Codex download.
 *
 * `disabled` on the other host is excluded: switched off everywhere it is
 * declared, it was never going to export. A node the plan for `host` DID judge
 * (in any class) is excluded too — its own entry already says what happened.
 */
export function otherHostOnly(
  judged: Array<Pick<PlanEntry, 'nodeId'>>,
  other: Array<Pick<PlanEntry, 'nodeId' | 'urn' | 'name' | 'class'>>,
): Array<{ name: string; urn: string }> {
  const seen = new Set(judged.map((e) => e.nodeId));
  return other
    .filter((e) => e.class !== 'disabled' && !seen.has(e.nodeId))
    .map((e) => ({ name: e.name, urn: e.urn }));
}
