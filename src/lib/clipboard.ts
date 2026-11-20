/**
 * Copy text to the clipboard and say whether it worked (portal#2330).
 *
 * `navigator.clipboard` is undefined outside secure contexts (plain HTTP on a
 * non-localhost host), where `writeText` would throw synchronously, and
 * `writeText` can still reject when permission is denied. Callers get a
 * boolean either way, never an exception, so each can show its own confirmation
 * and its own failure message instead of a third bespoke guard.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
