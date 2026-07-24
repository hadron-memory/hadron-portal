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
    // Bounce a consumer (individual) off org-scoped surfaces. Post-#627 an
    // individual is org-less — no memberships, so no active org — and their
    // home is the org-less memories surface. It must NOT be `/app/orgs/`, which
    // re-runs this guard and would redirect-loop (Codex review on #639). If an
    // active org is somehow set, prefer routing straight to it.
    redirect(303, data.activeOrgId ? `/app/orgs/${data.activeOrgId}/` : '/app/memories');
  }
}
