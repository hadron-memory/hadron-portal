/** Fixed public advisory from the node-write response contract (portal#1363). */
export const INCLUDE_PIN_UNKEPT = 'include.pin.unkept';
export const INCLUDE_PIN_UNKEPT_TEXT = 'A pinned include revision carries no recorded approval or signature and may be automatically pruned, breaking the include.';

export function readNodeAdvice(_response: unknown): string[] { return []; }
