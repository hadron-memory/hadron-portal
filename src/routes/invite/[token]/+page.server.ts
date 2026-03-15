import type { PageServerLoad } from './$types';

// Invite system removed — this page is a stub that redirects or shows a message.
export const load: PageServerLoad = async () => {
  return {
    removed: true,
  };
};
