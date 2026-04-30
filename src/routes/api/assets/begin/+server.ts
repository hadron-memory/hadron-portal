import { json } from '@sveltejs/kit';
import { ClientError } from 'graphql-request';
import { gqlClient } from '$lib/server/api';
import { BEGIN_ASSET_UPLOAD_MUTATION } from '$lib/server/assetQueries';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return json({ code: 'UNAUTHENTICATED', message: 'sign in required' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const required = ['agentUrn', 'filename', 'mimeType', 'sizeBytes', 'uploadIntent'];
  for (const k of required) {
    if (body[k] == null) {
      return json({ code: 'INVALID_INPUT', message: `${k} required` }, { status: 400 });
    }
  }

  try {
    const { beginAssetUpload } = await gqlClient(locals.token).request<{
      beginAssetUpload: unknown;
    }>(BEGIN_ASSET_UPLOAD_MUTATION, body);
    return json(beginAssetUpload);
  } catch (err) {
    return json(...mapError(err));
  }
};

function mapError(err: unknown): [Record<string, unknown>, { status: number }] {
  if (err instanceof ClientError) {
    const ext = err.response?.errors?.[0]?.extensions as { code?: string } | undefined;
    const message = err.response?.errors?.[0]?.message ?? 'asset upload error';
    return [{ code: ext?.code ?? 'UNKNOWN', message }, { status: statusFor(ext?.code) }];
  }
  return [{ code: 'INTERNAL', message: (err as Error).message ?? String(err) }, { status: 500 }];
}

function statusFor(code: string | undefined): number {
  switch (code) {
    case 'UNAUTHENTICATED': return 401;
    case 'PERMISSION_DENIED': return 403;
    case 'NOT_FOUND': return 404;
    case 'SIZE_EXCEEDED':
    case 'MIME_NOT_ALLOWED':
    case 'INVALID_INPUT':
    case 'SCAN_PENDING':
    case 'SCAN_BLOCKED':
      return 400;
    default:
      return 500;
  }
}
