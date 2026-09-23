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
import { validSkillName } from '$lib/skill-export';

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
  skipped: SkippedSkill[];
}

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
): SkillBundle {
  const plugin = pluginName(orgName);
  const files: Record<string, string> = {};
  const included: SkillBundle['included'] = [];
  const skipped: SkippedSkill[] = [];

  const wanted = entries.filter((e) => e.class !== 'disabled');
  const nameCount = new Map<string, number>();
  for (const e of wanted) nameCount.set(e.name, (nameCount.get(e.name) ?? 0) + 1);

  for (const e of wanted) {
    const errors = e.findings.filter((f) => f.severity === 'error').map((f) => f.message);
    if (!validSkillName(e.name)) {
      skipped.push({ name: e.name, urn: e.urn, reasons: [...errors, t('skill-bundle.skip.invalid-name', '"{name}" is not a valid skill name.', { name: e.name })] });
      continue;
    }
    if ((nameCount.get(e.name) ?? 0) > 1) {
      skipped.push({ name: e.name, urn: e.urn, reasons: [...errors, t('skill-bundle.skip.duplicate-name', 'Another task is also named "{name}".', { name: e.name })] });
      continue;
    }
    if (!e.renderedBody) {
      skipped.push({
        name: e.name,
        urn: e.urn,
        reasons: errors.length > 0 ? errors : [t('skill-bundle.skip.not-exportable', 'Not exportable ({class}).', { class: e.class ?? 'unreadable' })],
      });
      continue;
    }
    const path = host === 'claudeSkill' ? `skills/${e.name}/SKILL.md` : `${e.name}/SKILL.md`;
    files[path] = e.renderedBody;
    included.push({ name: e.name, urn: e.urn });
  }

  if (host === 'claudeSkill') {
    files['.claude-plugin/plugin.json'] =
      JSON.stringify(
        {
          name: plugin,
          description: `Skills exported from ${orgName || 'Hadron'} on Hadron.`,
        },
        null,
        2,
      ) + '\n';
  }

  const filename = host === 'claudeSkill' ? `${plugin}.zip` : `${plugin}-codex.zip`;
  return { files, filename, included, skipped };
}
