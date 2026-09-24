/**
 * #882 — the server's verdict on a node's STORED skill export, as the node edit
 * page shows it.
 *
 * The page used to compose its own verdict ("this node will export") from the
 * `enable` flag alone, and the server withheld the body anyway whenever lint
 * found an error: an invalid name, a non-runnable node, and every rule the
 * portal never copied. That is the optimistic kind of wrong: a user who
 * believes they are done. So the page renders `skillPlan(intent: LINT)` for
 * the node instead of predicting it.
 *
 * The server judges only what is STORED: `skillPlan` has no input for an
 * unsaved draft. So the verdict is labelled "as saved", and the editor says so
 * when the form holds unsaved changes rather than implying they were checked.
 */
import { CLAUDE_SKILL_HOST, SKILL_HOSTS, readExports } from '$lib/skill-export';

/** One finding as SKILL_PLAN_LINT_QUERY selects it. */
export interface LintFinding {
  rule: string;
  severity: string;
  message: string;
}

/** One entry of the LINT plan, as SKILL_PLAN_LINT_QUERY selects it. */
export interface LintEntry {
  nodeId: string;
  class: string | null;
  findings: LintFinding[];
}

/** The server's verdict for one host. */
export type HostCheck =
  | {
      host: string;
      status: 'judged';
      /** Off as stored (`disabled`): lint still judges it, but nothing exports. */
      off: boolean;
      /** Error findings — any one of them withholds the body on export. */
      errors: string[];
      warnings: string[];
    }
  /** Declared, but the plan has no entry for this node — reported, never assumed fine. */
  | { host: string; status: 'not-judged' }
  | { host: string; status: 'unavailable'; detail: string };

export type SkillCheck = { kind: 'none' } | { kind: 'checked'; hosts: HostCheck[] };

/**
 * The retired top-level keys the server still reads as a `claudeSkill`
 * declaration (`SkillPlanInput.host`: "the retired top-level skill/claudeSkill
 * keys alias to claudeSkill only"). The portal's editor never writes them, but
 * a node that still carries one IS judged, so its verdict is asked for too
 * (@codex on #905).
 */
const LEGACY_CLAUDE_KEYS = ['skill', 'claudeSkill'] as const;

/** The hosts the STORED properties declare — the only ones the plan judges. */
export function declaredHosts(properties: unknown): string[] {
  const exports = readExports(properties);
  const bag = properties !== null && typeof properties === 'object' && !Array.isArray(properties)
    ? (properties as Record<string, unknown>)
    : {};
  const legacyClaude = LEGACY_CLAUDE_KEYS.some((k) => bag[k] !== undefined);
  return SKILL_HOSTS.filter((h) => exports[h] !== undefined || (h === CLAUDE_SKILL_HOST && legacyClaude));
}

/**
 * Whether the server refuses an export that is switched ON as saved — the
 * condition under which the edit page opens its Skill export section. A
 * server-only rule (a memory-wide name collision, say) is exactly what the
 * client's own checks cannot see, so it must not stay folded away
 * (@codex on #905).
 */
export function serverRefuses(check: SkillCheck | null | undefined): boolean {
  return (
    check?.kind === 'checked' &&
    check.hosts.some((h) => h.status === 'judged' && !h.off && h.errors.length > 0)
  );
}

/** This node's verdict for one host, out of a whole memory's LINT plan. */
export function hostCheck(host: string, nodeId: string, entries: LintEntry[]): HostCheck {
  const entry = entries.find((e) => e.nodeId === nodeId);
  if (!entry) return { host, status: 'not-judged' };
  return {
    host,
    status: 'judged',
    off: entry.class === 'disabled',
    errors: [...new Set(entry.findings.filter((f) => f.severity === 'error').map((f) => f.message))],
    warnings: [...new Set(entry.findings.filter((f) => f.severity !== 'error').map((f) => f.message))],
  };
}

/** A verdict shared by one or more hosts, rendered once ("for Claude and Codex"). */
export interface HostCheckGroup {
  hosts: string[];
  check: DistributiveOmit<HostCheck, 'host'>;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * Hosts whose verdicts are identical render as one line; hosts that differ
 * render separately, each named. In declared-host order, so the page is stable.
 */
export function groupHostChecks(hosts: HostCheck[]): HostCheckGroup[] {
  const groups: HostCheckGroup[] = [];
  const byKey = new Map<string, HostCheckGroup>();
  for (const h of hosts) {
    const { host, ...check } = h;
    const key = JSON.stringify(check);
    const existing = byKey.get(key);
    if (existing) existing.hosts.push(host);
    else {
      const g: HostCheckGroup = { hosts: [host], check };
      byKey.set(key, g);
      groups.push(g);
    }
  }
  return groups;
}
