/**
 * 010-create-node-on-portal — find the next available loc when a candidate
 * collides with an existing sibling.
 *
 * Behavior matches the install-flow URN suffix-bump from 009 (R-7): if
 * `baseLoc` is already taken, try `baseLoc-2`, `baseLoc-3`, … until a free
 * value is found. Throws after `maxAttempts` to prevent runaway loops on
 * pathological inputs.
 */

const DEFAULT_MAX_ATTEMPTS = 99;

export class LocCollisionExhausted extends Error {
  constructor(
    public readonly baseLoc: string,
    public readonly attempts: number,
  ) {
    super(
      `Could not find an available loc near "${baseLoc}" after ${attempts} attempts. ` +
        `Try a more distinctive title.`,
    );
    this.name = 'LocCollisionExhausted';
  }
}

/**
 * Return `baseLoc` if free, else `baseLoc-2`, `baseLoc-3`, …
 *
 * Throws `LocCollisionExhausted` after `maxAttempts` (default 99).
 */
export function nextAvailableLoc(
  existingLocs: ReadonlySet<string>,
  baseLoc: string,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): string {
  if (!existingLocs.has(baseLoc)) {
    return baseLoc;
  }
  for (let n = 2; n <= maxAttempts; n++) {
    const candidate = `${baseLoc}-${n}`;
    if (!existingLocs.has(candidate)) {
      return candidate;
    }
  }
  throw new LocCollisionExhausted(baseLoc, maxAttempts);
}
