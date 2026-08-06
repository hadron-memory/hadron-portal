// Presigned-thumbnail ticket cache (PR #702). Module-wide so the assets
// page's PENDING-scan polling doesn't re-mint a URL per visible image on
// every loader refresh; deduped so a burst of rows for the same asset shares
// one request; bounded so a long-lived SPA session doesn't accumulate
// entries forever (Copilot review).
import { getAssetDownloadTicket } from '$lib/api/assetUpload';

// Refuse a cached URL within this slack of expiry so an <img> doesn't start
// loading a dying URL. Server TTL is ~300s.
const EXPIRY_SLACK_MS = 30_000;
// Insertion-order bound — ample for pages of 20-100 rows; the point is a
// ceiling, not an LRU tuned for hit rate.
const MAX_ENTRIES = 200;

interface Entry {
  url: string;
  expiresAtMs: number;
}

const resolved = new Map<string, Entry>();
const inflight = new Map<string, Promise<string>>();

function usable(entry: Entry | undefined): entry is Entry {
  return !!entry && entry.expiresAtMs - Date.now() > EXPIRY_SLACK_MS;
}

function store(assetId: string, entry: Entry): void {
  // Re-insert so the freshest entries sit at the tail of the iteration order.
  resolved.delete(assetId);
  resolved.set(assetId, entry);
  for (const key of resolved.keys()) {
    if (resolved.size <= MAX_ENTRIES) break;
    resolved.delete(key);
  }
}

/** Drop a cached ticket — used after an <img> load fails, where the URL may
 *  have expired between mint and the browser's (lazy) fetch. */
export function evictThumbTicket(assetId: string): void {
  resolved.delete(assetId);
}

/** Resolve a presigned GET URL for the asset, from cache when still fresh. */
export function getThumbSrc(assetId: string): Promise<string> {
  const hit = resolved.get(assetId);
  if (usable(hit)) return Promise.resolve(hit.url);
  if (hit) resolved.delete(assetId); // expired — evict rather than accumulate

  let pending = inflight.get(assetId);
  if (!pending) {
    pending = getAssetDownloadTicket(assetId)
      .then(({ url, expiresAt }) => {
        const ms = expiresAt ? Date.parse(expiresAt) : NaN;
        // A missing/unparseable expiresAt gets a short lifetime, not forever.
        store(assetId, { url, expiresAtMs: isNaN(ms) ? Date.now() + 60_000 : ms });
        return url;
      })
      .finally(() => inflight.delete(assetId));
    inflight.set(assetId, pending);
  }
  return pending;
}
