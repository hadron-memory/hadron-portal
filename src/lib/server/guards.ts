import { redirect } from '@sveltejs/kit';

export async function requireNonConsumer(
  parent: () => Promise<{
    isConsumerMode?: boolean;
    activeOrgId?: string | null;
    // #627: the memory-detail layout provides `graph`; when present and
    // org-less (organizationId == null) the caller is on a memory THEY own, so
    // the consumer-mode bounce must NOT apply. Absent on org-scoped routes.
    graph?: { organizationId?: string | null } | null;
  }>,
) {
  const data = await parent();
  // #627: a consumer-mode user may author/edit in a memory they own directly
  // (org-less personal/private → graph.organizationId == null). Only bounce them
  // from org-scoped surfaces; the server's per-memory write-access check remains
  // the canonical gate, so this only governs the UX redirect.
  const ownsOrglessMemory = !!data.graph && data.graph.organizationId == null;
  if (data.isConsumerMode && !ownsOrglessMemory) {
    // Skip the /app/dashboard 303→302 chain and redirect straight to the
    // resolved org URL. In consumer mode the resolved active org is always
    // the user's personal org.
    redirect(303, data.activeOrgId ? `/app/orgs/${data.activeOrgId}/` : '/app/orgs/');
  }
}
