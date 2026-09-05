// Client-side asset upload helper. Wraps the begin → R2 PUT → complete
// round-trip so callers (paperclip composer, agent-initiated picker) deal
// with one promise and one progress callback.

import type { ScanStatus } from '$lib/assets/scan-state';

export type AssetUploadIntent = 'USER' | 'AGENT_REQUEST';

// v2 (spec 006-asset-upload-redesign): memoryId replaces agentUrn as the
// addressing key. The portal targets a specific memory directly; agent-
// addressed v1 ops are dropped from the client surface.
export interface BeginAssetUploadInput {
  memoryId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  description?: string;
  uploadIntent: AssetUploadIntent;
  uploadRequestId?: string;
}

export interface AssetUploadTicket {
  uploadId: string;
  putUrl: string;
  putHeaders: { name: string; value: string }[];
  expiresAt: string;
  storageKey: string;
  maxSizeBytes: number;
  allowedMimeType: string;
}

export interface AssetSummary {
  id: string;
  // v2: nullable in the schema (staged assets have no memory yet).
  // For US1 / US2 (chat-paperclip + agent-initiated), the asset is
  // always attached at create time, so memoryId is non-null in
  // practice on those paths. Staged assets surface in US4.
  memoryId: string | null;
  /** `<memory.urn>:assets:<asset.id>` — what createAssetReferenceNode accepts. */
  urn: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  /**
   * Uploader (User id). NULL for a server-authored asset — hadron_store_file
   * writes no uploader when the run has no on-behalf-of user. Before #888 the
   * read gates compared this against the caller, which made every such asset
   * undownloadable by everyone; the gate is the holding memory's read access now.
   */
  uploadedBy: string | null;
  // The union lives in $lib/assets/scan-state, beside the per-state copy that
  // has to stay exhaustive over it.
  scanStatus: ScanStatus;
  /**
   * #707: the scan engine's signature name (e.g. "Eicar-Test-Signature") for a
   * BLOCKED asset — `cor:dmo:060:12` keeps the tombstone row precisely to carry
   * it, since the bytes are deleted.
   *
   * Null is NORMAL and means "no signature recorded", NOT "not blocked": it is
   * null for CLEAN and PENDING rows, and may be null on a BLOCKED one. Never
   * infer the status from it — read `scanStatus`.
   */
  scanSignature: string | null;
  description: string | null;
  /**
   * Stable UNAUTHENTICATED hotlink (`GET /assets/<id>`). Anyone holding this URL
   * can fetch the bytes — there is no read gate on it. A deliberate, temporary
   * posture (hadron-server `src/api/assetPublic.ts`); never present it in the UI
   * as though it were access-controlled.
   *
   * Null is NORMAL, not an error: the server returns null when it has no
   * BASE_URL, when the asset is not CLEAN, or when its memory is encrypted
   * (an anonymous request holds no session key, so those are never hotlinkable).
   */
  publicUrl: string | null;
}

export interface UploadAssetOptions {
  file: File;
  memoryId: string;
  description?: string;
  uploadIntent?: AssetUploadIntent;
  uploadRequestId?: string;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}

export class AssetUploadError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'AssetUploadError';
  }
}

export async function uploadAsset(
  opts: UploadAssetOptions,
): Promise<AssetSummary> {
  const ticket = await beginUpload({
    memoryId: opts.memoryId,
    filename: opts.file.name,
    mimeType: opts.file.type || 'application/octet-stream',
    sizeBytes: opts.file.size,
    description: opts.description,
    uploadIntent: opts.uploadIntent ?? 'USER',
    uploadRequestId: opts.uploadRequestId,
  });

  await putToStorage(ticket, opts.file, opts.onProgress, opts.signal);
  return completeUpload(ticket.uploadId);
}

async function beginUpload(input: BeginAssetUploadInput): Promise<AssetUploadTicket> {
  const res = await fetch('/api/assets/begin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await asUploadError(res);
  return res.json();
}

async function completeUpload(uploadId: string): Promise<AssetSummary> {
  const res = await fetch('/api/assets/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId }),
  });
  if (!res.ok) throw await asUploadError(res);
  return res.json();
}

function putToStorage(
  ticket: AssetUploadTicket,
  file: File,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', ticket.putUrl, true);
    for (const h of ticket.putHeaders) {
      // Browsers forbid setting Content-Length manually; they compute it
      // from the body and reject (or silently drop) the header. Skip it.
      if (h.name.toLowerCase() === 'content-length') continue;
      xhr.setRequestHeader(h.name, h.value);
    }

    xhr.upload.onprogress = (ev) => {
      if (onProgress && ev.lengthComputable) onProgress(ev.loaded, ev.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new AssetUploadError(`R2_${xhr.status}`, `R2 PUT failed: ${xhr.status} ${xhr.statusText}`));
    };
    xhr.onerror = () => reject(new AssetUploadError('NETWORK', 'network error during upload'));
    xhr.onabort = () => reject(new AssetUploadError('CANCELLED', 'upload cancelled'));

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        reject(new AssetUploadError('CANCELLED', 'upload cancelled'));
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.send(file);
  });
}

async function asUploadError(res: Response): Promise<AssetUploadError> {
  let body: { code?: string; message?: string } = {};
  try {
    body = await res.json();
  } catch {
    /* no body */
  }
  return new AssetUploadError(
    body.code ?? `HTTP_${res.status}`,
    body.message ?? `request failed: ${res.status} ${res.statusText}`,
  );
}

export async function listMemoryAssets(
  memoryId: string,
  opts: { mimeType?: string; skip?: number; count?: number; mine?: boolean } = {},
): Promise<{ assets: AssetSummary[]; total: number; hasMore: boolean }> {
  const params = new URLSearchParams({ memoryId });
  if (opts.mimeType) params.set('mimeType', opts.mimeType);
  if (opts.skip != null) params.set('skip', String(opts.skip));
  if (opts.count != null) params.set('count', String(opts.count));
  // Only send `mine` when narrowing — the server default is false, and an
  // explicit `mine=false` would be indistinguishable from an unset param anyway.
  if (opts.mine) params.set('mine', 'true');
  const res = await fetch(`/api/assets/list?${params}`);
  if (!res.ok) throw await asUploadError(res);
  return res.json();
}

/** The reference node createAssetReferenceNode wrote. */
export interface AssetReferenceNode {
  id: string;
  loc: string;
  name: string;
  nodeType: string;
  memory: { id: string; urn: string } | null;
}

/**
 * Attach an existing asset to the graph as a `reference` node at `nodeUrn`.
 *
 * Gated on BOTH sides server-side — read on the asset's memory, write on the
 * target's — because the two need not be the same memory.
 */
export async function createAssetReferenceNode(input: {
  assetRef: string;
  nodeUrn: string;
  name?: string;
  description?: string;
}): Promise<AssetReferenceNode> {
  const res = await fetch('/api/assets/reference', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await asUploadError(res);
  return res.json();
}

/** Short-TTL presigned GET. `expiresAt` is surfaced for callers that cache the
 *  URL across renders (the thumbnail ticket cache); plain one-shot downloads
 *  ignore it. The shape is validated rather than trusted: a missing `url` is a
 *  hard error, while a missing/odd `expiresAt` degrades to null so cachers
 *  assign their own short lifetime (Copilot review, PR #702). */
export async function getAssetDownloadTicket(
  assetId: string,
): Promise<{ url: string; expiresAt: string | null }> {
  const res = await fetch(
    `/api/assets/download?${new URLSearchParams({ assetId })}`,
  );
  if (!res.ok) throw await asUploadError(res);
  const body: { url?: unknown; expiresAt?: unknown } = await res.json();
  if (typeof body.url !== 'string' || !body.url) {
    throw new AssetUploadError('INVALID_RESPONSE', 'download ticket response carried no url');
  }
  return {
    url: body.url,
    expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
  };
}

export async function getAssetDownloadUrl(assetId: string): Promise<string> {
  return (await getAssetDownloadTicket(assetId)).url;
}

export async function deleteAsset(assetId: string): Promise<void> {
  const res = await fetch('/api/assets/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId }),
  });
  if (!res.ok) throw await asUploadError(res);
}
