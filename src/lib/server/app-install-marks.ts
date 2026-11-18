import type { GraphQLClient } from 'graphql-request';
import { installMarksOf, type AppAgentInstall, type InstallMarks } from '$lib/app-install-marks';
import { APP_INSTALL_MARKS_QUERY } from './queries';

/**
 * portal#1684: a failed read draws no marks, the same as a withheld answer. No
 * mark states nothing, so the roster it sits on stays true.
 */
export async function readAppInstallMarks(client: Pick<GraphQLClient, 'request'>, appRef: string): Promise<InstallMarks> {
  try {
    const r = await client.request<{ app: { appAgents: AppAgentInstall[] | null } | null }>(APP_INSTALL_MARKS_QUERY, { ref: appRef });
    return installMarksOf(r.app?.appAgents);
  } catch (e) {
    console.warn('[install-marks] read failed:', e);
    return {};
  }
}
