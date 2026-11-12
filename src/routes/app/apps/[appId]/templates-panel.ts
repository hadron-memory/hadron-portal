/**
 * #1936 — the App's node-role templates tab data. Loaded only when the URL asks
 * for that tab, like the Runs panel: every other App-detail load pays nothing
 * for it. The read is the sensitive one the standalone page made (#1749 B1), so
 * the response is `private, no-store` and the header is set BEFORE the read, so
 * a refusal keeps it too. Access is unchanged: `templatesPageData` still derives
 * `canManage` from the server's `viewerManages` and `readOnly` from impersonation.
 */
import { templatesPageData } from '$lib/server/memory-config/page-data';

export const TEMPLATES_TAB_ID = 'node-role-templates';

export async function loadTemplatesPanel(
  initialTab: string | null,
  locals: App.Locals,
  setHeaders: (headers: Record<string, string>) => void,
  appId: string,
) {
  if (initialTab !== TEMPLATES_TAB_ID) return null;
  setHeaders({ 'cache-control': 'private, no-store' });
  return templatesPageData(locals, 'APP', appId);
}
