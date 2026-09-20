/**
 * The display label for a memory's class (#1176).
 *
 * Extracted from the /app/memories page so it can be tested directly — the page
 * imports `$app/forms`, which has no implementation outside a running SvelteKit
 * app, and a copy of the mapping inside a test would pass while the page
 * shipped a different one. Same reason `team-chat-thread.ts` holds its label
 * helpers outside the component.
 *
 * It used to be `cls === 'private' ? 'Private' : 'Personal'` — a BINARY, correct
 * only while the query asked for exactly those two classes. Swapping that query
 * to `ownedByMe` made `knowledge` rows visible for the first time and the badge
 * called them "Personal", asserting something false about the very rows the fix
 * had just surfaced
 * (`hrn:node:hadronmemory.com:hadron-portal:review:a-fallback-asserts-what-it-was-written-for`).
 *
 * An unknown class returns its own raw value. A class this list has never seen
 * is exactly the case where inventing a friendly label is how the old bug got
 * here, and a raw string is both honest and obviously wrong to a reader.
 */
import { t } from '$lib/i18n/t';

export function memoryClassLabel(cls: string): string {
  switch (cls) {
    case 'personal':
      return t('my-memories.badge.personal', 'Personal');
    case 'private':
      return t('my-memories.badge.private', 'Private');
    case 'knowledge':
      return t('my-memories.badge.knowledge', 'Knowledge');
    case 'group':
      return t('my-memories.badge.group', 'Group');
    case 'app':
      return t('my-memories.badge.app', 'App');
    case 'system':
      return t('my-memories.badge.system', 'System');
    default:
      return cls;
  }
}
