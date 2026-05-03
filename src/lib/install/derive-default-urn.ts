/**
 * 009-install-agent-flow — pre-fill the App URN at install time.
 *
 * The default candidate is `${orgUrn}:${agentSlug}`. If that collides with
 * an existing App URN in the same org, suffix `-2`, `-3`, … until a free
 * slot is found. The check is purely client-side pre-fill — the server's
 * URN-uniqueness constraint is the final gate; the user can also edit the
 * URN by hand before submit.
 */
export function deriveDefaultUrn(
  orgUrn: string,
  agentSlug: string,
  existingAppUrns: string[],
): string {
  const taken = new Set(existingAppUrns);
  const base = `${orgUrn}:${agentSlug}`;
  if (!taken.has(base)) return base;
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  // 10k collisions on a single Agent's URN is implausible in real use.
  // If we somehow get here, return the base — the server will reject it
  // and the user will see the URN-collision error in the form.
  return base;
}
