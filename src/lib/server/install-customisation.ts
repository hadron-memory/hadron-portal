import { nodeUpdateDocument, type GovernedState } from './nodeKindDoor';
import { composeNodeUrn } from '$lib/urn/compose-node-urn';
import { fail } from '@sveltejs/kit';
import type { GraphQLClient } from 'graphql-request';
import { t } from '$lib/i18n/t';
import {
  customisationRefusalLead,
  isQualifiedRef,
  type CustomisationRead,
  type InstallNode,
  type Read,
} from '$lib/install-customisation';
import { parseExpectedRevision } from '$lib/node-revision';
import { extractGqlError, extractGqlErrorCode } from './gqlError';
import {
  INSTALL_TARGET_QUERY,
  INSTALL_MEMORY_QUERY,
  INSTALL_NODES_QUERY,
  INSTALL_NODE_QUERY,
  ORIGINAL_NODE_QUERY,
  CREATE_CUSTOMISATION_MUTATION,
} from './queries';
type Client = Pick<GraphQLClient, 'request'>;
// node(ref:) resolves a PK or a urn:node: ref by itself and ignores memoryRef
// (#1504 §10), so a customisation read would show a different node than the
// save, which addresses the literal loc. `loc:` makes the server read any
// string as a loc inside memoryRef.
const memoryPinnedRef = (loc: string) => `loc:${loc}`;
export async function readCustomisation(
  client: Client,
  target: { appRef: string; agentRef: string },
  offset: number,
  loc?: string,
): Promise<CustomisationRead> {
  const out: CustomisationRead = {
    list: { state: 'failed' },
    replacement: { state: 'not-shown' },
    original: { state: 'not-shown' },
  };
  try {
    const { app } = await client.request<{
      app: {
        id: string;
        agents: { id: string; systemMemoryId?: string | null }[];
      } | null;
    }>(INSTALL_TARGET_QUERY, { ref: target.appRef });
    const agent = app?.agents?.find((a) => a.id === target.agentRef);
    if (!agent) return out;
    const { installMemory } = await client.request<{
      installMemory: { id: string; urn: string | null } | null;
    }>(INSTALL_MEMORY_QUERY, target);
    if (!installMemory) {
      out.list = { state: 'not-shown' };
      return out;
    }
    try {
      const { memoryNodes } = await client.request<{
        memoryNodes: {
          nodes: Pick<InstallNode, 'id' | 'urn' | 'loc' | 'name'>[];
          total: number;
        };
      }>(INSTALL_NODES_QUERY, { memoryRef: installMemory.id, offset });
      out.list = {
        state: 'ok',
        value: {
          memoryId: installMemory.id,
          urn: installMemory.urn,
          nodes: memoryNodes.nodes.map((node) => ({
            ...node,
            urn: installMemory.urn
              ? composeNodeUrn(installMemory.urn, node.loc)
              : null,
          })),
          total: memoryNodes.total,
          offset,
        },
      };
    } catch {
      out.list = { state: 'failed' };
    }
    if (loc && !isQualifiedRef(loc)) {
      const read = async (
        query: string,
        memoryRef: string,
      ): Promise<Read<InstallNode>> => {
        try {
          const { node } = await client.request<{ node: InstallNode | null }>(
            query,
            { memoryRef, ref: memoryPinnedRef(loc) },
          );
          return node ? { state: 'ok', value: node } : { state: 'not-shown' };
        } catch {
          return { state: 'failed' };
        }
      };
      // Only the selected loc is read: two requests, never one per table row.
      [out.replacement, out.original] = await Promise.all([
        read(INSTALL_NODE_QUERY, installMemory.id),
        agent.systemMemoryId
          ? read(ORIGINAL_NODE_QUERY, agent.systemMemoryId)
          : Promise.resolve({ state: 'not-shown' } as const),
      ]);
    }
    return out;
  } catch {
    return out;
  }
}
export async function writeCustomisation(
  client: Client,
  appRef: string,
  fd: FormData,
  create: boolean,
) {
  const agentRef = String(fd.get('agentRef') ?? '');
  const loc = String(fd.get('loc') ?? '').trim();
  const invalid = () =>
    fail(400, {
      customisationFailed: {
        code: 'invalid',
        detail: t(
          'customisation.invalid',
          'Choose an installed Agent and a bare loc, with the revision you opened.',
        ),
      },
    });
  // A well-formed draft whose install or replacement is gone on the
  // authoritative reread is not malformed input: the target changed (#1370).
  // Deleted, hidden and foreign read the same, so nothing is disclosed.
  const unavailable = () =>
    fail(409, {
      customisationFailed: {
        code: 'unavailable',
        detail: t(
          'customisation.unavailable',
          'This customisation is no longer available. It may have changed since you opened it. Your draft is kept; reload to see the current state.',
        ),
      },
    });
  if (!agentRef || !loc || isQualifiedRef(loc) || !fd.has('content'))
    return invalid();
  const input: Record<string, unknown> = { install: { appRef, agentRef }, loc };
  if (create) {
    if (!String(fd.get('name') ?? '').trim()) return invalid();
    input.name = String(fd.get('name'));
    input.content = String(fd.get('content'));
  } else {
    const revision = parseExpectedRevision(fd.get('expectedRevision'));
    if (revision === null || !fd.has('baseContent')) return invalid();
    if (fd.get('content') === fd.get('baseContent')) return { saved: true };
    input.content = String(fd.get('content'));
    input.expectedRevision = revision;
  }
  try {
    if (create) await client.request(CREATE_CUSTOMISATION_MUTATION, { input });
    else {
      // Re-read governance only to choose its write door. Never advance the
      // displayed expectedRevision: the server still rejects a stale draft.
      const { installMemory } = await client.request<{
        installMemory: { id: string } | null;
      }>(INSTALL_MEMORY_QUERY, { appRef, agentRef });
      if (!installMemory) return unavailable();
      const { node } = await client.request<{ node: GovernedState | null }>(
        INSTALL_NODE_QUERY,
        { memoryRef: installMemory.id, ref: memoryPinnedRef(loc) },
      );
      if (!node) return unavailable();
      await client.request(nodeUpdateDocument(node, input), { input });
    }
    return { saved: true };
  } catch (e) {
    const code = extractGqlErrorCode(e);
    const fixed = t(
      'customisation.failed-save',
      'The customisation could not be saved. Your draft is kept.',
    );
    const detail = [
      customisationRefusalLead(code),
      extractGqlError(e, fixed, code && customisationRefusalLead(code) !== null ? [code] : [], { transport: 'fallback' }),
    ]
      .filter(Boolean)
      .join(' ');
    const known = customisationRefusalLead(code) !== null;
    return fail(
      code === 'FORBIDDEN'
        ? 403
        : code === 'NODE_WRITE_CONFLICT'
          ? 409
          : known
            ? 400
            : 500,
      { customisationFailed: { code: code ?? 'failed', detail } },
    );
  }
}
