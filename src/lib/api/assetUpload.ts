// Client-side asset upload helper. Wraps the begin → R2 PUT → complete
// round-trip so callers (paperclip composer, agent-initiated picker) deal
// with one promise and one progress callback.
//
// Spec: specs/001-asset-upload/contracts/graphql.md
//       specs/001-asset-upload/contracts/http-endpoints.md

export type AssetUploadIntent = 'USER' | 'AGENT_REQUEST';

export interface BeginAssetUploadInput {
  agentUrn: string;
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
  assetId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  scanStatus: 'PENDING' | 'CLEAN' | 'BLOCKED';
  description: string | null;
}

export interface UploadAssetOptions {
  file: File;
  agentUrn: string;
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
    agentUrn: opts.agentUrn,
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

export async function listAgentAssets(
  agentUrn: string,
  opts: { mimeType?: string; skip?: number; count?: number } = {},
): Promise<{ assets: AssetSummary[]; total: number; hasMore: boolean }> {
  const params = new URLSearchParams({ agentUrn });
  if (opts.mimeType) params.set('mimeType', opts.mimeType);
  if (opts.skip != null) params.set('skip', String(opts.skip));
  if (opts.count != null) params.set('count', String(opts.count));
  const res = await fetch(`/api/assets/list?${params}`);
  if (!res.ok) throw await asUploadError(res);
  return res.json();
}

export async function getAssetDownloadUrl(assetId: string): Promise<string> {
  const res = await fetch(
    `/api/assets/download?${new URLSearchParams({ assetId })}`,
  );
  if (!res.ok) throw await asUploadError(res);
  const body: { url: string } = await res.json();
  return body.url;
}

export async function deleteAsset(assetId: string): Promise<void> {
  const res = await fetch('/api/assets/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId }),
  });
  if (!res.ok) throw await asUploadError(res);
}
