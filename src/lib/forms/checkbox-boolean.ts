import { z } from 'zod';

/**
 * Coerces the FormData value produced by an HTML checkbox into a boolean.
 * Checked boxes commonly submit "true" or "on"; unchecked boxes are omitted,
 * so callers should still choose the appropriate default/prefault.
 */
export const checkboxBoolean = z.preprocess(
  (value) => value === true || value === 'true' || value === 'on',
  z.boolean(),
);
