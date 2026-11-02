/**
 * portal#1609 — the Agent's ticker-template reads and writes, and what a
 * refusal tells the reader. The server is the authority on who may edit
 * (hrn:node:hadronmemory.com:specs:cor:agt:080:35); the portal renders its answer and never retries.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  AGENT_TICKER_TEMPLATES_QUERY,
  CREATE_AGENT_TICKER_TEMPLATE_MUTATION,
  DELETE_AGENT_TICKER_TEMPLATE_MUTATION,
  UPDATE_AGENT_TICKER_TEMPLATE_MUTATION,
  classifyTemplateError,
  loadAgentTickerTemplates,
} from './agent-ticker-templates';
import { IMPERSONATION_SENTENCE } from './agent-task-writes';

const err = (code: string, message = 'server words', extra: Record<string, unknown> = {}) => ({
  response: { errors: [{ message, extensions: { code, ...extra } }] },
});

const tpl = { id: 't1', name: 'standup', cadenceSeconds: 600, quietHours: null, reasons: ['READ_TEAM_CHANNEL'], relevance: 'ALL', revision: 2, tickCode: 'standup', updatedAt: null };

describe('documents', () => {
  it('the read selects the capability and the revision it will send back', () => {
    expect(AGENT_TICKER_TEMPLATES_QUERY).toMatch(/viewerMayEditTickerTemplates/);
    expect(AGENT_TICKER_TEMPLATES_QUERY).toMatch(/\brevision\b/);
    expect(AGENT_TICKER_TEMPLATES_QUERY).toMatch(/\btickCode\b/);
    expect(AGENT_TICKER_TEMPLATES_QUERY).toMatch(/\bquietHours\b/);
  });
  it('update and delete take expectedRevision; create takes agentRef', () => {
    expect(UPDATE_AGENT_TICKER_TEMPLATE_MUTATION).toMatch(/expectedRevision: \$expectedRevision/);
    expect(DELETE_AGENT_TICKER_TEMPLATE_MUTATION).toMatch(/expectedRevision: \$expectedRevision/);
    expect(CREATE_AGENT_TICKER_TEMPLATE_MUTATION).toMatch(/agentRef: \$agentRef/);
  });
});

describe('loadAgentTickerTemplates', () => {
  it('returns the templates and the capability as the server said it', async () => {
    for (const cap of [true, false, null]) {
      const client = { request: vi.fn().mockResolvedValue({ agent: { id: 'a1', viewerMayEditTickerTemplates: cap, tickerTemplates: [tpl] } }) };
      expect(await loadAgentTickerTemplates(client as never, 'a1')).toEqual({ kind: 'ok', value: { viewerMayEdit: cap, templates: [tpl] } });
    }
  });

  it('only a literal true is a yes: a missing or odd value reads as unknown (null)', async () => {
    for (const odd of [undefined, 'true', 1]) {
      const client = { request: vi.fn().mockResolvedValue({ agent: { id: 'a1', viewerMayEditTickerTemplates: odd, tickerTemplates: [] } }) };
      expect(await loadAgentTickerTemplates(client as never, 'a1')).toMatchObject({ value: { viewerMayEdit: null } });
    }
  });

  it('a failed read, or an Agent that answers null, is failed and never an empty list', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadAgentTickerTemplates({ request: vi.fn().mockRejectedValue(new Error('down')) } as never, 'a1')).toEqual({ kind: 'failed' });
    expect(await loadAgentTickerTemplates({ request: vi.fn().mockResolvedValue({ agent: null }) } as never, 'a1')).toEqual({ kind: 'failed' });
  });

  it('a malformed templates payload is failed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = { request: vi.fn().mockResolvedValue({ agent: { id: 'a1', viewerMayEditTickerTemplates: true, tickerTemplates: 'nope' } }) };
    expect(await loadAgentTickerTemplates(client as never, 'a1')).toEqual({ kind: 'failed' });
  });
});

describe('classifyTemplateError', () => {
  it('shows the server sentence for the typed refusals raised before anything is stored', () => {
    for (const code of ['BAD_USER_INPUT', 'TICKER_TEMPLATE_NAME_TAKEN', 'TICKER_TEMPLATE_LIMIT_REACHED', 'TICKER_CADENCE_OUT_OF_RANGE', 'TICKER_QUIET_HOURS_INVALID', 'AGENT_NOT_FOUND']) {
      expect(classifyTemplateError(err(code, `sentence for ${code}`), 'create')).toEqual({ kind: 'refused', code, message: `sentence for ${code}` });
    }
  });

  it('a typed not-found is the portal sentence, naming no server prose', () => {
    for (const action of ['update', 'delete'] as const) {
      const r = classifyTemplateError(err('TICKER_TEMPLATE_NOT_FOUND', 'internal wording'), action) as { kind: string; code: string; message: string };
      expect(r).toMatchObject({ kind: 'refused', code: 'TICKER_TEMPLATE_NOT_FOUND' });
      expect(r.message).not.toContain('internal wording');
      expect(r.message).toMatch(/no longer exists/i);
    }
  });

  it('a stale revision is the portal sentence, naming no server prose', () => {
    const r = classifyTemplateError(err('TICKER_TEMPLATE_REVISION_MISMATCH', 'internal wording'), 'update');
    expect(r).toMatchObject({ kind: 'refused', code: 'TICKER_TEMPLATE_REVISION_MISMATCH' });
    expect((r as { message: string }).message).not.toContain('internal wording');
    expect((r as { message: string }).message).toMatch(/changed/i);
  });

  it('FORBIDDEN is the portal sentence for the action, or the impersonation sentence; never the raw word', () => {
    for (const action of ['create', 'update', 'delete'] as const) {
      const r = classifyTemplateError(err('FORBIDDEN', 'Forbidden'), action) as { kind: string; message: string };
      expect(r.kind).toBe('refused');
      expect(r.message).not.toBe('Forbidden');
      expect(r.message).toMatch(/Agent/);
    }
    expect(classifyTemplateError(err('FORBIDDEN', IMPERSONATION_SENTENCE), 'update')).toEqual({ kind: 'refused', code: 'FORBIDDEN', message: IMPERSONATION_SENTENCE });
  });

  it('any other code, no code, no payload, or a transport failure is the uncertain line', () => {
    expect(classifyTemplateError(err('SOMETHING_NEW'), 'update')).toEqual({ kind: 'uncertain' });
    expect(classifyTemplateError(err('INTERNAL_SERVER_ERROR'), 'update')).toEqual({ kind: 'uncertain' });
    expect(classifyTemplateError({ response: { errors: [{ message: 'x' }] } }, 'update')).toEqual({ kind: 'uncertain' });
    expect(classifyTemplateError(new Error('socket hang up'), 'update')).toEqual({ kind: 'uncertain' });
    expect(classifyTemplateError(undefined, 'update')).toEqual({ kind: 'uncertain' });
  });
});
