/**
 * portal#1903: the node type of a compiled boot prompt, named once. The page's read-only predicate and the
 * fixtures that pin it take it from here, so a rename of the wire value is one edit and not a silent mismatch
 * between the page and the tests that claim to exercise it.
 */
export const COMPILED_BOOT_PROMPT_TYPE = 'compiled-boot-prompt';

/** The id of the read-only hint a compiled prompt's text and abstract fields are described by (a11y: the hint is the reason the field cannot be edited). */
export const COMPILED_PROMPT_HINT_ID = 'compiled-prompt-hint';
