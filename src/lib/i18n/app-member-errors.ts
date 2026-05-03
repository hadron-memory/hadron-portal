/**
 * 008-agent-installation T075: friendly translations for the typed
 * App-member errors thrown by the server. The server raises GraphQLError
 * with `extensions.code` set to the error class name (InvalidRoleError,
 * MaxMembersExceededError, MissingGrantError, OrphanAppError); this
 * helper maps that code to a stable t() id and English fallback so the
 * portal can render plain-language banners per Constitution Principle III.
 */

import { t } from './t';

interface GqlErrorLike {
  message?: string;
  response?: {
    errors?: Array<{ message?: string; extensions?: { code?: string } }>;
  };
}

export interface AppMemberErrorTranslation {
  /** Stable i18n key, e.g. 'app-member.errors.max-members-exceeded'. */
  id: string;
  /** English fallback shown today; localized later via t(). */
  text: string;
}

/**
 * Pull the typed error code (set by the server's
 * `extensions.code = ErrorName`) out of a thrown GraphQL error.
 */
export function appMemberErrorCode(e: unknown): string | null {
  if (!e || typeof e !== 'object') return null;
  const errs = (e as GqlErrorLike).response?.errors;
  return errs?.[0]?.extensions?.code ?? null;
}

/**
 * Translate a thrown App-member error to a friendly user-facing string
 * (routed through t() per T075). Falls back to the GraphQL error message
 * when the code is unrecognised, and finally to a generic message when
 * the input doesn't look like a GraphQL error at all.
 */
export function translateAppMemberError(e: unknown, fallback: string): string {
  const code = appMemberErrorCode(e);
  switch (code) {
    case 'InvalidRoleError':
      return t(
        'app-member.errors.invalid-role',
        'That role isn’t permitted by this Agent. Pick one of the roles offered by the Agent author.',
      );
    case 'MaxMembersExceededError':
      return t(
        'app-member.errors.max-members-exceeded',
        'This App is at the member limit set by the Agent author. Remove a member or ask the Agent author to raise the cap.',
      );
    case 'MissingGrantError':
      return t(
        'app-member.errors.missing-grant',
        'Your organization isn’t licensed to install this Agent. Ask the Agent owner to grant access.',
      );
    case 'OrphanAppError':
      return t(
        'app-member.errors.orphan-app',
        'This App has no Agent linked yet — link one before adding members.',
      );
    default:
      // Prefer the server's GraphQL error message when present so the
      // user sees the most informative text, then the generic
      // Error.message, and finally the caller-supplied fallback.
      const errs = (e as GqlErrorLike)?.response?.errors;
      if (errs?.[0]?.message) return errs[0].message;
      return e instanceof Error ? e.message : fallback;
  }
}
