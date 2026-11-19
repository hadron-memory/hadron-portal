import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphQLClient } from 'graphql-request';
import { Kind, parse, visit } from 'graphql';
import { testerLinkEligibility, TESTER_OWNED_AGENT_IDS_QUERY } from './link-eligibility';

const request = vi.fn();
const client = { request } as unknown as GraphQLClient;
const personal = { id: 'target', organizationId: null };
beforeEach(() => { request.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('Tester link owner scope (#2100)', () => {
  it('uses the server owner-only filter and selects only IDs', () => {
    const doc = parse(TESTER_OWNED_AGENT_IDS_QUERY);
    const fields: string[] = [];
    visit(doc, { Field(node) {
      fields.push(node.name.value);
      if (node.name.value === 'agents') {
        expect(node.arguments?.find((a) => a.name.value === 'filter')?.value).toMatchObject({
          kind: Kind.OBJECT,
          fields: [{ name: { value: 'ownedByMe' }, value: { kind: Kind.BOOLEAN, value: true } }],
        });
      }
    } });
    expect(fields).toEqual(['agents', 'items', 'id', 'total']);
  });

  it.each([false, null])('does not ask for ownership when management is %s', async (manage) => {
    expect(await testerLinkEligibility(client, personal, manage)).toBe(manage);
    expect(request).not.toHaveBeenCalled();
  });

  describe('org-owned Agent mirrors the Tester reach (#2187)', () => {
    const orgOwned = { id: 'target', organizationId: 'org-a' };
    const orgsWith = (ids: string[], orgId = 'org-a') => [{ id: orgId, agents: ids.map((id) => ({ id })) }] as never;

    const ownedList = (ids: string[]) => ({ agents: { items: ids.map((id) => ({ id })), total: ids.length } });

    it('hides the link when neither the org list nor the owned list shows the Agent (PERSONAL, non-creator manager)', async () => {
      request.mockResolvedValue(ownedList([]));
      expect(await testerLinkEligibility(client, orgOwned, true, orgsWith(['someone-elses']))).toBe(false);
      expect(request).toHaveBeenCalledWith(TESTER_OWNED_AGENT_IDS_QUERY, { limit: 200, offset: 0 });
    });

    it("falls back to the owned list like the Tester's second step", async () => {
      request.mockResolvedValue(ownedList(['target']));
      expect(await testerLinkEligibility(client, orgOwned, true, orgsWith([]))).toBe(true);
    });

    it('a failed owned read is unknown, not hidden-as-false', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      request.mockRejectedValueOnce(new Error('private upstream details'));
      expect(await testerLinkEligibility(client, orgOwned, true, orgsWith([]))).toBeNull();
    });

    it('shows the link when the org agents list includes the Agent (creator, or ORGANIZATION/PUBLIC)', async () => {
      expect(await testerLinkEligibility(client, orgOwned, true, orgsWith(['target']))).toBe(true);
    });

    it('finds the Agent in any listed org, as the Tester does', async () => {
      const orgs = [{ id: 'org-b', agents: [] }, { id: 'org-a', agents: [{ id: 'target' }] }] as never;
      expect(await testerLinkEligibility(client, orgOwned, true, orgs)).toBe(true);
    });


    it.each([false, null])('keeps %s when management is not proven', async (manage) => {
      expect(await testerLinkEligibility(client, orgOwned, manage, orgsWith(['target']))).toBe(manage);
    });

    it('makes no request when the org list shows the Agent', async () => {
      await testerLinkEligibility(client, orgOwned, true, orgsWith(['target']));
      expect(request).not.toHaveBeenCalled();
    });
  });

  it('admits the owner through ownedByMe, including a platform admin who owns it', async () => {
    request.mockResolvedValue({ agents: { items: [{ id: personal.id }], total: 1 } });
    expect(await testerLinkEligibility(client, personal, true)).toBe(true);
    expect(request).toHaveBeenCalledWith(TESTER_OWNED_AGENT_IDS_QUERY, { limit: 200, offset: 0 });
  });

  it.each([{ items: [] }, { items: [{ id: 'other-agent' }] }])('does not treat a manager as owner from $items', async ({ items }) => {
    request.mockResolvedValue({ agents: { items, total: items.length } });
    expect(await testerLinkEligibility(client, personal, true)).toBe(false);
  });

  it('finds an owner on a later short page rather than silently hiding the link', async () => {
    request.mockResolvedValueOnce({ agents: { items: [{ id: 'other' }], total: 2 } })
      .mockResolvedValueOnce({ agents: { items: [{ id: personal.id }], total: 2 } });
    expect(await testerLinkEligibility(client, personal, true)).toBe(true);
    expect(request.mock.calls.map(([, vars]) => vars)).toEqual([{ limit: 200, offset: 0 }, { limit: 200, offset: 1 }]);
  });

  it.each([false, true])('a failed ownership page is unknown, not not-owned (later=%s)', async (later) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    if (later) request.mockResolvedValueOnce({ agents: { items: [{ id: 'other' }], total: 2 } });
    request.mockRejectedValueOnce(new Error('private upstream details'));
    expect(await testerLinkEligibility(client, personal, true)).toBeNull();
    expect(warn).toHaveBeenCalledWith('[agent-page] Tester ownership read failed; link eligibility unknown');
  });
});
