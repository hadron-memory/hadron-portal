import type { GraphQLClient } from 'graphql-request';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import {
  ORG_BOOT_PROMPT_SIGNING_QUERY,
  ORG_BOOT_PROMPT_SIGNING_PREVIEW_QUERY,
  SET_ORG_BOOT_PROMPT_SIGNING_MUTATION,
} from '$lib/server/queries';

/**
 * portal#1921 (hadron-server#3894, #2973 PR 2) — the organisation boot-prompt
 * signing switch.
 *
 * The server is the gate (hrn:node:hadronmemory.com:specs:cor:api:240:01): it answers one `FORBIDDEN` to every
 * caller who is not the org's current ADMIN/OWNER (a member below ADMIN, a
 * non-member, a worker session, an App key, a run, impersonation). Here that is
 * `hidden`, which the page renders as the section being absent. Anything else
 * that is not a success is `failed`, whose copy is fixed and never carries
 * server prose. Nothing here throws and nothing logs server text.
 *
 * Classified like hrn:node:hadronmemory.com:hadron-portal:findings:audience-gated-field-on-shared-fragment-nulls-parent.
 */
export type SigningSwitch = { required: boolean; enforced: boolean; deploymentSigns: boolean };
export type SwitchRead = ({ kind: 'ok' } & SigningSwitch) | { kind: 'hidden' } | { kind: 'failed' };

export type PreviewState = 'SIGNATURE_PENDING' | 'REVISION_CHANGES' | 'UNSIGNED_STOPS';
export type PreviewRow = {
  appId: string;
  appUrn: string;
  agentId: string;
  agentName: string;
  /** The server's string, shown verbatim (hrn:node:hadronmemory.com:specs:cor:api:240:01); null when it cannot be derived. */
  agentUrn: string | null;
  workerId: string | null;
  workerName: string | null;
  /** Null on an install-level row or when it cannot be derived. */
  workerUrn: string | null;
  compiledNodeId: string;
  compiledNodeUrn: string | null;
  servedRevSeq: number;
  state: PreviewState;
  changesToRevSeq: number | null;
};

/** R3: every page at the server's cap, bounded at 10 pages (2000 rows). */
export const PREVIEW_PAGE_SIZE = 200;
export const PREVIEW_MAX_PAGES = 10;

export type PreviewRead =
  | {
      kind: 'ok';
      enforced: boolean;
      deploymentSigns: boolean;
      total: number;
      rows: PreviewRow[];
      /** The FIRST page's token (R3): a change during or after the drain answers STALE. */
      previewToken: string;
    }
  | { kind: 'too_many'; enforced: boolean; deploymentSigns: boolean; total: number }
  | { kind: 'drifted' }
  | { kind: 'hidden' }
  | { kind: 'failed' };

export type SetRead = ({ kind: 'ok' } & SigningSwitch) | { kind: 'stale' } | { kind: 'hidden' } | { kind: 'failed' };

function classify(e: unknown, what: string): 'hidden' | 'failed' {
  const code = extractGqlErrorCode(e);
  if (code === 'FORBIDDEN') return 'hidden';
  console.warn(`[org-boot-prompt-signing] ${what} failed (${code ?? 'transport'})`);
  return 'failed';
}

export async function loadOrgSigningSwitch(client: GraphQLClient, org: string): Promise<SwitchRead> {
  try {
    const r = await client.request<{ orgBootPromptSigning: SigningSwitch }>(ORG_BOOT_PROMPT_SIGNING_QUERY, { org });
    const { required, enforced, deploymentSigns } = r.orgBootPromptSigning;
    return { kind: 'ok', required, enforced, deploymentSigns };
  } catch (e) {
    return { kind: classify(e, 'read') };
  }
}

type PreviewPage = {
  enforced: boolean;
  deploymentSigns: boolean;
  total: number;
  hasMore: boolean;
  endCursor: string | null;
  previewToken: string;
  rows: PreviewRow[];
};

async function drainOnce(client: GraphQLClient, org: string): Promise<PreviewRead> {
  let after: string | null = null;
  const seen = new Set<string>();
  const rows: PreviewRow[] = [];
  let first: PreviewPage | null = null;
  for (let n = 0; n < PREVIEW_MAX_PAGES; n++) {
    const r: { orgBootPromptSigningPreview: PreviewPage } = await client.request(ORG_BOOT_PROMPT_SIGNING_PREVIEW_QUERY, {
      org,
      first: PREVIEW_PAGE_SIZE,
      after,
    });
    const p: PreviewPage = r.orgBootPromptSigningPreview;
    if (!first) first = p;
    else if (p.total !== first.total) return { kind: 'drifted' };
    rows.push(...p.rows);
    if (!p.hasMore) {
      if (rows.length !== first.total) return { kind: 'drifted' };
      return {
        kind: 'ok',
        enforced: first.enforced,
        deploymentSigns: first.deploymentSigns,
        total: first.total,
        rows,
        previewToken: first.previewToken,
      };
    }
    // A cursor that is missing or repeats would loop; the preview moved under us.
    if (!p.endCursor || seen.has(p.endCursor)) return { kind: 'drifted' };
    seen.add(p.endCursor);
    after = p.endCursor;
  }
  // Still more after the bound: the rows cannot be shown here, so the portal offers no switch-on.
  return { kind: 'too_many', enforced: first!.enforced, deploymentSigns: first!.deploymentSigns, total: first!.total };
}

/**
 * Read the WHOLE preview (hrn:node:hadronmemory.com:specs:cor:agt:040:09: the org is shown WHICH prompts change,
 * rows and not only a count). A drift during the drain is retried once from the
 * top; a second drift is reported as `drifted` so the page says "look again".
 */
export async function loadSigningPreview(client: GraphQLClient, org: string): Promise<PreviewRead> {
  try {
    const a = await drainOnce(client, org);
    if (a.kind !== 'drifted') return a;
    return await drainOnce(client, org);
  } catch (e) {
    return { kind: classify(e, 'preview read') };
  }
}

/**
 * Switch on needs the preview's token; off needs none and sends no
 * `previewToken` key at all. The caller states `required` explicitly
 * (hrn:node:hadronmemory.com:hadron-portal:review:explicit-mutation-intent): it is never read from a form field.
 */
export async function setOrgSigning(
  client: GraphQLClient,
  org: string,
  input: { required: true; previewToken: string } | { required: false },
): Promise<SetRead> {
  const variables: Record<string, unknown> = { org, required: input.required };
  if (input.required) variables.previewToken = input.previewToken;
  try {
    const r = await client.request<{ setOrgBootPromptSigning: SigningSwitch }>(SET_ORG_BOOT_PROMPT_SIGNING_MUTATION, variables);
    const { required, enforced, deploymentSigns } = r.setOrgBootPromptSigning;
    return { kind: 'ok', required, enforced, deploymentSigns };
  } catch (e) {
    if (extractGqlErrorCode(e) === 'BOOT_PROMPT_SIGNING_PREVIEW_STALE') return { kind: 'stale' };
    return { kind: classify(e, 'switch') };
  }
}
