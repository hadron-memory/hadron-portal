/**
 * portal#1462 — which worker the page store is showing, in the route's own spelling (id or URN), or null when
 * it is not a worker page.
 *
 * The worker error boundary gets `params.id` and the worker route id. Kit's ROOT boundary, which is where a
 * failed `__data.json` refresh lands, gets neither (`params = {}`, `route: null`: load_root_error_page), only the
 * real URL, so the URL is the one source both can share (Cedar's QA on b3fa8201, #1471).
 */
export interface PageFacts {
  params?: Record<string, string> | null;
  route?: { id: string | null } | null;
  url?: URL | null;
}

const WORKER_PATH = /^\/app\/workers\/([^/]+)\/?$/;

export function workerOfPage(p: PageFacts | null | undefined): string | null {
  if (!p) return null;
  if (p.route?.id === '/app/workers/[id]' && p.params?.id) return p.params.id;
  const match = p.url?.pathname ? WORKER_PATH.exec(p.url.pathname) : null;
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}
