/**
 * portal#426 — /api/nodes/export forwards the caller's sections for a PDF.
 * The server renders the PDF (title + content, then the added sections in its
 * own fixed order); the portal only carries the selection. Mocks the GraphQL
 * client and asserts the variables sent to `nodeExport`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

import { POST } from './+server';

const RESULT = { nodeExport: { format: 'PDF', mimeType: 'application/pdf', filename: 'n.pdf', encoding: 'BASE64', data: 'JVBERi0=', bytes: 5 } };

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue(RESULT);
});

function ev(body: unknown, token: string | null = 'tok') {
  return { request: { json: async () => body }, locals: { token } } as unknown as Parameters<typeof POST>[0];
}
const variables = () => mockRequest.mock.calls[0][1] as { id: string; format: string; full: boolean; sections?: string[] };

describe('/api/nodes/export PDF sections (portal#426)', () => {
  it('forwards the chosen sections for a PDF, with full as sent', async () => {
    const res = await POST(ev({ id: 'n1', format: 'PDF', full: false, sections: ['DATA', 'EDGES'] }));
    expect(res.status).toBe(200);
    expect(variables()).toEqual({ id: 'n1', format: 'PDF', full: false, sections: ['DATA', 'EDGES'] });
  });

  it('a PDF keeps its sections whatever full says, so no caller depends on the server ignoring full', async () => {
    await POST(ev({ id: 'n1', format: 'PDF', sections: ['PROPERTIES'] }));
    expect(variables().sections).toEqual(['PROPERTIES']);
  });

  it('drops COMMENTS (not ruled yet) and anything that is not a section', async () => {
    await POST(ev({ id: 'n1', format: 'PDF', full: false, sections: ['COMMENTS', 'BOGUS', 7, 'EDGES'] }));
    expect(variables().sections).toEqual(['EDGES']);
  });

  it('sends the content-only PDF as full:false with no sections, which is what the Download dialog sends when none is ticked', async () => {
    await POST(ev({ id: 'n1', format: 'PDF', full: false, sections: [] }));
    expect(variables()).toEqual({ id: 'n1', format: 'PDF', full: false, sections: [] });
  });

  it('treats sections that are not a list as none', async () => {
    await POST(ev({ id: 'n1', format: 'PDF', full: false, sections: 'DATA' }));
    expect(variables().sections).toBeUndefined();
  });

  it('sends no sections for a plain PDF (Print stays content-only)', async () => {
    await POST(ev({ id: 'n1', format: 'PDF', full: true }));
    expect(variables().sections).toBeUndefined();
  });

  it('keeps Markdown as it was: sections apply only to a custom (full:false) export', async () => {
    await POST(ev({ id: 'n1', format: 'MD', full: true, sections: ['DATA'] }));
    expect(variables().sections).toBeUndefined();
    mockRequest.mockClear();
    await POST(ev({ id: 'n1', format: 'MD', full: false, sections: ['DATA'] }));
    expect(variables().sections).toEqual(['DATA']);
  });
});
