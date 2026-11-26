/**
 * portal#696 — the /api/assets/* proxy endpoints.
 *
 * The complete-upload case is a REGRESSION test with real history: the endpoint
 * passed `{ uploadId }` against `$input: CompleteAssetUploadInput!` from #182
 * onwards, so every upload failed at its final step and nothing noticed — the
 * #681 caller gate's file pre-filter skipped every file that annotates its
 * response type inline, this one included. The gate is fixed too; this pins the
 * behaviour at the call site.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import { BEGIN_ASSET_UPLOAD_V2_MUTATION, COMPLETE_ASSET_UPLOAD_MUTATION, MEMORY_ASSETS_QUERY } from '$lib/server/assetQueries';

const mockRequest = vi.fn();

vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const locals = { token: 'tok' };

function post(body: unknown) {
  return { request: { json: async () => body }, locals } as never;
}

describe('POST /api/assets/complete', () => {
  it('wraps uploadId in the $input variable the mutation declares', async () => {
    mockRequest.mockResolvedValue({ completeAssetUpload: { id: 'a1' } });
    const { POST } = await import('./complete/+server');
    const res = await POST(post({ uploadId: 'up-1' }));

    expect(res.status).toBe(200);
    const [doc, vars] = mockRequest.mock.calls[0];
    expect(doc).toBe(COMPLETE_ASSET_UPLOAD_MUTATION);
    // The shape that was broken: a bare `{ uploadId }` leaves $input unprovided.
    expect(vars).toEqual({ input: { uploadId: 'up-1' } });
    expect(vars).not.toHaveProperty('uploadId');
  });

  it('rejects a missing uploadId before calling the server', async () => {
    const { POST } = await import('./complete/+server');
    const res = await POST(post({}));
    expect(res.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('requires a session', async () => {
    const { POST } = await import('./complete/+server');
    const res = await POST({ request: { json: async () => ({ uploadId: 'x' }) }, locals: {} } as never);
    expect(res.status).toBe(401);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('does not turn a server crash into a 4xx', async () => {
    mockRequest.mockRejectedValue(
      new ClientError(
        { errors: [{ message: 'boom', extensions: { code: 'INTERNAL_SERVER_ERROR' } }], status: 200 } as never,
        { query: 'mutation M { m }' },
      ),
    );
    const { POST } = await import('./complete/+server');
    const res = await POST(post({ uploadId: 'up-1' }));
    expect(res.status).toBe(500);
  });
});

describe('POST /api/assets/reference', () => {
  it('forwards only the declared input fields', async () => {
    mockRequest.mockResolvedValue({ createAssetReferenceNode: { id: 'n1', loc: 'a:b' } });
    const { POST } = await import('./reference/+server');
    const res = await POST(
      post({
        assetRef: 'hrn:asset:acme:mem:a1',
        nodeUrn: 'hrn:node:acme:mem:parent:file',
        // An unknown field is a hard GraphQL validation error on an input
        // object, so spreading the body would break the call outright.
        somethingElse: 'nope',
      }),
    );

    expect(res.status).toBe(200);
    const [, vars] = mockRequest.mock.calls[0];
    expect(vars).toEqual({
      input: { assetRef: 'hrn:asset:acme:mem:a1', nodeUrn: 'hrn:node:acme:mem:parent:file' },
    });
  });

  it('omits name/description rather than sending null over the server defaults', async () => {
    mockRequest.mockResolvedValue({ createAssetReferenceNode: { id: 'n1' } });
    const { POST } = await import('./reference/+server');
    await POST(post({ assetRef: 'a', nodeUrn: 'n', name: '', description: '' }));
    const [, vars] = mockRequest.mock.calls[0];
    expect(vars).toEqual({ input: { assetRef: 'a', nodeUrn: 'n' } });
  });

  it('passes name and description through when supplied', async () => {
    mockRequest.mockResolvedValue({ createAssetReferenceNode: { id: 'n1' } });
    const { POST } = await import('./reference/+server');
    await POST(post({ assetRef: 'a', nodeUrn: 'n', name: 'Report', description: 'Q3' }));
    const [, vars] = mockRequest.mock.calls[0];
    expect(vars).toEqual({
      input: { assetRef: 'a', nodeUrn: 'n', name: 'Report', description: 'Q3' },
    });
  });

  it.each(['assetRef', 'nodeUrn'])('requires %s', async (missing) => {
    const body: Record<string, string> = { assetRef: 'a', nodeUrn: 'n' };
    delete body[missing];
    const { POST } = await import('./reference/+server');
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('requires a session', async () => {
    const { POST } = await import('./reference/+server');
    const res = await POST({
      request: { json: async () => ({ assetRef: 'a', nodeUrn: 'n' }) },
      locals: {},
    } as never);
    expect(res.status).toBe(401);
  });

  it('maps a write-side permission denial to 403', async () => {
    mockRequest.mockRejectedValue(
      new ClientError(
        { errors: [{ message: 'no', extensions: { code: 'PERMISSION_DENIED' } }], status: 200 } as never,
        { query: 'mutation M { m }' },
      ),
    );
    const { POST } = await import('./reference/+server');
    const res = await POST(post({ assetRef: 'a', nodeUrn: 'n' }));
    expect(res.status).toBe(403);
  });
});

describe('GET /api/assets/list', () => {
  function get(qs: string) {
    return { url: new URL(`http://x/api/assets/list?${qs}`), locals } as never;
  }

  it('omits `mine` unless it is explicitly true', async () => {
    mockRequest.mockResolvedValue({ memoryAssets: { assets: [], total: 0, hasMore: false } });
    const { GET } = await import('./list/+server');
    await GET(get('memoryId=mem-1'));
    const [doc, vars] = mockRequest.mock.calls[0];
    expect(doc).toBe(MEMORY_ASSETS_QUERY);
    // #2588: the GraphQL variable is `memoryRef` (the route's own `memoryId` query param is unchanged).
    expect((vars as { memoryRef?: string }).memoryRef).toBe('mem-1');
    expect(vars).not.toHaveProperty('memoryId');
    // Sending `mine: false` would be equivalent, but leaving it unset keeps the
    // server default authoritative.
    expect((vars as { mine?: boolean }).mine).toBeUndefined();
  });

  it('passes mine=true through to narrow to the caller’s own uploads', async () => {
    mockRequest.mockResolvedValue({ memoryAssets: { assets: [], total: 0, hasMore: false } });
    const { GET } = await import('./list/+server');
    await GET(get('memoryId=mem-1&mine=true'));
    expect((mockRequest.mock.calls[0][1] as { mine?: boolean }).mine).toBe(true);
  });

  it('treats any other mine value as unset rather than erroring', async () => {
    mockRequest.mockResolvedValue({ memoryAssets: { assets: [], total: 0, hasMore: false } });
    const { GET } = await import('./list/+server');
    await GET(get('memoryId=mem-1&mine=1'));
    expect((mockRequest.mock.calls[0][1] as { mine?: boolean }).mine).toBeUndefined();
  });

  it('requires memoryId', async () => {
    const { GET } = await import('./list/+server');
    const res = await GET(get(''));
    expect(res.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('does not report a transport failure as a client error', async () => {
    mockRequest.mockRejectedValue(new ClientError({ status: 502 } as never, { query: 'query Q { q }' }));
    const { GET } = await import('./list/+server');
    const res = await GET(get('memoryId=mem-1'));
    expect(res.status).toBe(500);
  });
});


// hadron-portal#2609 — hadron-server#5080 renamed BeginAssetUploadV2Input.memoryId to memoryRef. The route used
// to forward the browser's body as the input, so no gate could read its keys.
describe('POST /api/assets/begin', () => {
  const browserBody = {
    memoryId: 'mem-1', filename: 'a.png', mimeType: 'image/png', sizeBytes: 12,
    description: 'd', uploadIntent: 'USER', uploadRequestId: 'req-1',
  };

  it('sends memoryRef, taken from the browser memoryId, and no memoryId', async () => {
    mockRequest.mockResolvedValue({ beginAssetUploadV2: { uploadId: 'up-1' } });
    const { POST } = await import('./begin/+server');
    const res = await POST(post(browserBody));

    expect(res.status).toBe(200);
    const [doc, vars] = mockRequest.mock.calls[0];
    expect(doc).toBe(BEGIN_ASSET_UPLOAD_V2_MUTATION);
    expect(vars).toEqual({
      input: {
        memoryRef: 'mem-1', filename: 'a.png', mimeType: 'image/png', sizeBytes: 12,
        description: 'd', uploadIntent: 'USER', uploadRequestId: 'req-1',
      },
    });
    expect(vars.input).not.toHaveProperty('memoryId');
  });

  it('forwards no browser key the server input does not name', async () => {
    mockRequest.mockResolvedValue({ beginAssetUploadV2: { uploadId: 'up-1' } });
    const { POST } = await import('./begin/+server');
    await POST(post({ ...browserBody, memoryRef: 'smuggled', agentUrn: 'x', extra: 1 }));

    const { input } = mockRequest.mock.calls[0][1];
    expect(input.memoryRef).toBe('mem-1');
    expect(Object.keys(input).sort()).toEqual(
      ['description', 'filename', 'memoryRef', 'mimeType', 'sizeBytes', 'uploadIntent', 'uploadRequestId'],
    );
  });

  it('still refuses a body without memoryId before any request', async () => {
    const { memoryId: _omit, ...rest } = browserBody;
    const { POST } = await import('./begin/+server');
    const res = await POST(post(rest));

    expect(res.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
