/**
 * 009-install-agent-flow — pre-fill the App name at install time.
 *
 * The default candidate is the Agent's `name`. If that collides with an
 * existing App name in the same org, suffix `(2)`, `(3)`, … until a free
 * slot is found. The user can edit the name freely; this is only the
 * pre-fill, not the constraint.
 *
 * Unlike URNs, App names are NOT unique-constrained at the database level —
 * the suffix is purely a UX nicety so the user doesn't end up with two
 * Apps both literally called "Mealplan" in the same org.
 */
export function deriveDefaultName(
  agentName: string,
  existingAppNames: string[],
): string {
  const taken = new Set(existingAppNames);
  if (!taken.has(agentName)) return agentName;
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${agentName} (${i})`;
    if (!taken.has(candidate)) return candidate;
  }
  return agentName;
}
