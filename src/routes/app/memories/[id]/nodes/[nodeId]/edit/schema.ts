import { z } from 'zod';
import { checkboxBoolean } from '$lib/forms/checkbox-boolean';
import { jsonObjectField } from '$lib/forms/zod-validators';

/**
 * #878 — the edit page edits ONLY what the node detail page has no tab for:
 * the object type, the properties bag, and the skill export inside it.
 *
 * Name, loc, description, alias, seq, tags and Runnable live on the Settings
 * tab; content, abstract and edges on their own tabs. They are deliberately
 * NOT fields here: this form used to carry all of them and wrote every one on
 * Save, so a field dropped from the page but left in the schema would post
 * empty and CLEAR the stored value.
 */
export const editNodeSchema = z.object({
  // Only ever turns Runnable ON — the skill-export checkbox sets it, because
  // the server refuses a skill on a node that is not runnable. The action
  // sends `true` or omits the field; it never un-sets it (see +page.server.ts).
  isRunnable: checkboxBoolean.default(false),
  // #588 (server #725): collection discriminator ('' → null clears it) and the
  // typed properties record as one serialized JSON string ('' → null clears).
  objectType: z.string().trim().default(''),
  propertiesJson: jsonObjectField('Properties'),
});

export type EditNodeSchema = typeof editNodeSchema;
