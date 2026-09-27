/**
 * #942 — who a register row can name: a Worker cast in the owner's context, or
 * an Agent installed there. For an App that is the App's own; for an
 * organization, any of its Apps'. `retired` Workers still name old rows but
 * take no new ones.
 */
export type Attendee = {
  id: string;
  name: string;
  urn: string | null;
  kind: 'worker' | 'agent';
  role?: string | null;
  retired?: boolean;
  /**
   * On an organization's page: the App a Worker is cast in, by URN, so two
   * same-named Workers in same-named Apps stay distinguishable.
   */
  appUrn?: string | null;
};
