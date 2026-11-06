import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { addMember, ensureMember, removeMember } from '../member-actions';

const humanTeam = (appId: string) => `/app/apps/${appId}?tab=members`;

/**
 * #1005: the members list is the App page's "Human Team" tab now. This URL is
 * in bookmarks, the org-scoped redirect beside it, and old PR text, so it
 * forwards rather than disappearing — an unknown route would 404 where the
 * reader expects the people list.
 */
export const load: PageServerLoad = async ({ params, parent }) => {
  await parent();
  redirect(307, humanTeam(params.appId));
};

/**
 * A page already open at deploy (or restored by back-navigation) still holds
 * forms that POST to `/members?/add|ensure|remove`. A load redirect does not
 * answer an action POST, so these run the same mutation as the App page and
 * then send the reader to the tab. The outcome shows in the refreshed list; the
 * field-level error of a refused write is not carried across the redirect.
 */
const thenHumanTeam =
  (handler: (e: Parameters<typeof addMember>[0]) => Promise<unknown>): Actions[string] =>
  async (event) => {
    await handler(event);
    redirect(303, humanTeam(event.params.appId));
  };

export const actions: Actions = {
  add: thenHumanTeam(addMember),
  ensure: thenHumanTeam(ensureMember),
  remove: thenHumanTeam(removeMember),
};
