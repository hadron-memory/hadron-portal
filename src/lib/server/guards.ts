import { redirect } from '@sveltejs/kit';

export async function requireNonConsumer(
  parent: () => Promise<{ isConsumerMode?: boolean; activeOrgId?: string | null }>,
) {
  const data = await parent();
  if (data.isConsumerMode) {
    // Skip the /app/dashboard 303→302 chain and redirect straight to the
    // resolved org URL. In consumer mode the resolved active org is always
    // the user's personal org.
    redirect(303, data.activeOrgId ? `/app/orgs/${data.activeOrgId}/` : '/app/orgs/');
  }
}
