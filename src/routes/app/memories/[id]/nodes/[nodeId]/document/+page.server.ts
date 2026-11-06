import { redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { SPEC_DOCUMENT_NODE_QUERY, SPEC_DOCUMENT_QUERY } from '$lib/server/queries';
import { classifySpecDocumentFailure, isSpecRole, type SpecDocumentFailure } from '$lib/spec-document/spec-document';
import type { PageServerLoad } from './$types';

/**
 * #1720: a spec node's assembled document. READ ONLY: two queries, no
 * mutation, no write, mint or approval call.
 *
 * Every answer the server gives for "nothing here for you" (an unreadable
 * memory, a missing one, a loc with no live spec) is the same `not-found`
 * state, and so are a node that is not a spec and a node the caller cannot
 * read: the view discloses no more than the server's answer. The Markdown is
 * returned UNCHANGED; it is sanitized and rendered in the browser only, after
 * mount (a synchronous marked parse here would stall every user on the
 * portal's Node process).
 */
export type SpecDocumentPage =
  | { state: 'ok'; loc: string; name: string; markdown: string }
  | { state: SpecDocumentFailure['kind']; cap?: number | null };

export const load: PageServerLoad = async ({ params, locals }) => {
  const client = gqlClient(locals.token);
  const notFound: SpecDocumentPage = { state: 'not-found' };
  const nodeHref = `/app/memories/${params.id}/nodes/${params.nodeId}`;

  const found = await client.request<{ node: { id: string; memoryId: string; loc: string; name: string; role: string | null } | null }>(
    SPEC_DOCUMENT_NODE_QUERY,
    { ref: params.nodeId },
  );
  const node = found.node;
  if (!node || !isSpecRole(node.role)) return { document: notFound, nodeHref };
  if (node.memoryId !== params.id) redirect(303, `/app/memories/${node.memoryId}/nodes/${params.nodeId}/document`);

  try {
    const res = await client.request<{ specDocument: { loc: string; markdown: string } }>(SPEC_DOCUMENT_QUERY, {
      memoryRef: node.memoryId,
      loc: node.loc,
    });
    const page: SpecDocumentPage = { state: 'ok', loc: res.specDocument.loc, name: node.name, markdown: res.specDocument.markdown };
    return { document: page, nodeHref };
  } catch (e) {
    const failure = classifySpecDocumentFailure(e);
    if (!failure) throw e;
    const page: SpecDocumentPage = failure.kind === 'too-large' ? { state: 'too-large', cap: failure.cap } : { state: failure.kind };
    return { document: page, nodeHref };
  }
};
