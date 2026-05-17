/**
 * 009-install-agent-flow — i18n strings for the install flow.
 *
 * Pattern matches `app-member-errors.ts`: each user-visible string routes
 * through `t(id, defaultText)` per Constitution Principle III. Strings used
 * in only one place are inlined at the call site; strings shared across
 * multiple components (the "Install" button label, the cross-org tooltip)
 * live here so the wording stays consistent.
 *
 * 023-app-shape US6 — vocabulary: the user-facing word "Install" covers
 * BOTH levels of the install ceremony — `createApp` (an Org installs an
 * Agent, creating an App) and `joinApp` (a User joins an existing App as
 * a member). The polysemy is deliberate (PWA analogy). API surfaces name
 * them distinctly; copy does not. Both shared button labels live here.
 */

import { t } from './t';

export const installStrings = {
  /**
   * Org-level install — the Agent → App creation button (`createApp`).
   * Rendered on the Agent's row in the org Agents list and on the Agent
   * detail page.
   */
  buttonLabel: (): string => t('install.button.label', 'Install'),

  /**
   * User-level install — the "join this App" button (`joinApp`).
   * Same word, different layer: a User adds themselves to an existing App
   * as a member. 023-app-shape US6: the catalog has the entry ready;
   * actual UI surface (the user-facing join flow) ships in a follow-up.
   */
  joinButtonLabel: (): string => t('join-app.button.label', 'Install'),

  /** Hover/aria text explaining why the Install affordance is disabled. */
  crossOrgDisabledHint: (): string =>
    t(
      'install.cross-org.disabled-hint',
      "This Agent is owned by another organization. Cross-org install isn't available yet.",
    ),

  /** Empty-state copy on the org Apps page (replaces the legacy "+ New App" CTA). */
  emptyAppsPage: (): string =>
    t(
      'install.empty.apps-page',
      "No Apps yet. To create one, install one of your Agents.",
    ),

  /** Friendly form-error mapping for the server's URN-collision message. */
  errorUrnCollision: (): string =>
    t(
      'install.error.urn-collision',
      'An App with this URN already exists in your organization. Try a different name or URN.',
    ),

  /** Friendly form-error mapping when the Agent is not found / soft-deleted. */
  errorAgentNotFound: (): string =>
    t(
      'install.error.agent-not-found',
      "We couldn't find that Agent. It may have been deleted.",
    ),

  /** Friendly fallback for the (currently portal-only) cross-org rejection. */
  errorCrossOrg: (): string =>
    t(
      'install.error.cross-org',
      "This Agent is owned by another organization. Cross-org install isn't available yet.",
    ),
};
