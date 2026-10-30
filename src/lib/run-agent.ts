/**
 * portal#1444 (hadron-server#2849, hrn:node:hadronmemory.com:specs:cor:agt:040:10): a manual run in an App with
 * SEVERAL installed Agents must name one, or the server refuses it with
 * `RUN_AGENT_REQUIRED`. With one or none installed the server picks, so the
 * run surfaces show nothing new.
 */
import { rosterOf } from '$lib/withheld';
import type { InstalledAgent } from '$lib/app-installed-agents';

export const RUN_AGENT_REQUIRED = 'RUN_AGENT_REQUIRED';

/**
 * The Agents to offer in the run picker, or `null` for "no picker".
 *
 * The decision counts INSTALLS (entries of `appAgents`), not readable Agents:
 * an install the caller may not read arrives with `agent: null`, so the
 * readable list can be shorter than the roster (portal#1148). An unreadable
 * Agent is never offered. A withheld (`null`) or unread (`undefined`) roster is
 * not "several": no picker, and the server's refusal says the rest.
 */
export function runAgentChoice(
  appAgents: ReadonlyArray<{ agent: InstalledAgent | null }> | null | undefined,
): InstalledAgent[] | null {
  const roster = rosterOf(appAgents);
  if (roster.kind === 'withheld' || roster.items.length < 2) return null;
  const readable = roster.items.flatMap((a) => (a.agent ? [a.agent] : []));
  return readable.length > 0 ? readable : null;
}
