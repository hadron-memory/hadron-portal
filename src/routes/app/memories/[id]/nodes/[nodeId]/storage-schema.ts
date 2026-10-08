import { z } from 'zod';
import { checkboxBoolean } from '$lib/forms/checkbox-boolean';
import { jsonObjectField } from '$lib/forms/zod-validators';

/**
 * #878 — the Properties tab's storage form edits ONLY what the node page has
 * no other control for: the object type, the properties bag, and the skill
 * export inside it.
 *
 * Name, loc, description, alias, seq, tags and Runnable live on the Settings
 * tab; content, abstract and edges on their own tabs. They are deliberately
 * NOT fields here: this form used to carry all of them and wrote every one on
 * Save, so a field dropped from the page but left in the schema would post
 * empty and CLEAR the stored value.
 *
 * #1031 moved this form from its own `/edit` page onto the Properties tab, so
 * it now shares the node page's action data with a dozen other forms and
 * carries a `_kind` like each of them.
 */
export const nodeStorageSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // posted value meant for another form.
  _kind: z.literal('updateStorage').default('updateStorage'),
  // Only ever turns Runnable ON — the skill-export checkbox sets it, because
  // the server refuses a skill on a node that is not runnable. The action
  // sends `true` or omits the field; it never un-sets it (see storage-action.ts).
  isRunnable: checkboxBoolean.default(false),
  // #588 (server #725): collection discriminator ('' → null clears it) and the
  // typed properties record as one serialized JSON string ('' → null clears).
  objectType: z.string().trim().default(''),
  propertiesJson: jsonObjectField('Properties'),
});

export type NodeStorageSchema = typeof nodeStorageSchema;

/**
 * The storage form's superforms id. Explicit because the node page has a dozen
 * forms sharing its action data
 * (`hrn:node:hadronmemory.com:hadron-portal:review:superforms-distinct-form-ids`).
 * Lives here, not in `storage-action.ts`, so client code and client-lane tests
 * can name it without importing the server's GraphQL client.
 */
export const NODE_STORAGE_FORM_ID = 'node-storage';
