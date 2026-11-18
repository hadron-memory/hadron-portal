/**
 * The base-diff grammar shared by the Edit details patch (portal#1357, edit.ts) and the Clone
 * patch (portal#2161, clone.ts): a form posts each field beside its BASE, the value it showed
 * when it opened, and a field goes into the input only when its base was posted AND the reader
 * changed it. Merely opening and saving names nothing; a crafted post that names no base cannot
 * overwrite a field it never showed.
 *
 * One rule lives with the CALLER, not here: what clears a field. The edit clears an optional
 * field with null (updateAgentTask's strict patch); the clone clears with the empty value the
 * server's copy rules pin ("" / [] — an omitted field would copy the source's value back).
 */
export const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
export const all = (fd: FormData, k: string) => [...new Set(fd.getAll(k).map((v) => String(v).trim()).filter(Boolean))];
export const tagList = (text: string) => [...new Set(text.split(',').map((x) => x.trim()).filter(Boolean))];
export const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
export const sameSet = (a: string[], b: string[]) => sameList([...a].sort(), [...b].sort());

export interface Requirements {
  role: string | null;
  familyIn: string[];
  familyNotIn: string[];
  excludeWorkers: string[];
  minTier: string | null;
}

/** The posted `requirementsBase` — the requirements the form opened showing, or null when absent/unreadable. */
export function readBaseRequirements(raw: FormDataEntryValue | null): Requirements | null {
  if (typeof raw !== 'string') return null;
  try {
    const b = JSON.parse(raw) as Partial<Requirements> | null;
    if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
    const list = (x: unknown) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);
    return { role: typeof b.role === 'string' && b.role.trim() ? b.role.trim() : null, familyIn: list(b.familyIn), familyNotIn: list(b.familyNotIn), excludeWorkers: list(b.excludeWorkers), minTier: typeof b.minTier === 'string' && b.minTier.trim() ? b.minTier.trim() : null };
  } catch {
    return null;
  }
}

/**
 * The requirements override the POSTED controls name, diffed against a parsed base: `undefined`
 * when the reader changed nothing, the override to send when they did (`null` clears to "any").
 * The caller decides whether the controls were even VISIBLE — hidden controls post nothing and
 * must not read as "emptied" (a backlog start, or a named assignee, hides them).
 */
export function requirementsOverride(fd: FormData, base: Requirements): Record<string, unknown> | null | undefined {
  const role = str(fd, 'role') || null;
  const familyIn = all(fd, 'familyIn');
  // The server takes one family list or the other; "run as" wins, as on the create form.
  const familyNotIn = familyIn.length ? [] : all(fd, 'familyNotIn');
  const excludeWorkers = all(fd, 'excludeWorkers');
  const minTier = str(fd, 'minTier') || null;
  const baseNotIn = base.familyIn.length ? [] : base.familyNotIn;
  if (role === base.role && sameSet(familyIn, base.familyIn) && sameSet(familyNotIn, baseNotIn) && sameSet(excludeWorkers, base.excludeWorkers) && minTier === base.minTier) return undefined;
  const requirements: Record<string, unknown> = {};
  if (role) requirements.role = role;
  if (familyIn.length) requirements.familyIn = familyIn;
  else if (familyNotIn.length) requirements.familyNotIn = familyNotIn;
  if (excludeWorkers.length) requirements.excludeWorkers = excludeWorkers;
  if (minTier) requirements.minTier = minTier;
  return Object.keys(requirements).length ? requirements : null;
}
