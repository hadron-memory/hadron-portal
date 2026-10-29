/**
 * #419 — the light/dark control offers Light, Dark and System, as the Unifi
 * Network controller's does. `preference` is what the reader chose; whether the
 * page is dark is derived from it (System follows the OS).
 */
export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'theme';

/**
 * Before #419 the key held only 'light' or 'dark', and anything else (including
 * no value) meant dark. Keep that, so a reader who never chose a theme stays on
 * dark and a stored 'light' or 'dark' keeps working; only 'system' is new.
 */
export function parseThemePreference(stored: string | null | undefined): ThemePreference {
  return stored === 'light' || stored === 'system' ? stored : 'dark';
}

export function resolveDark(preference: ThemePreference, systemDark: boolean): boolean {
  return preference === 'system' ? systemDark : preference === 'dark';
}

/** localStorage can throw (private windows, blocked site data); a failed read is "no choice". */
export function readStoredTheme(storage: Pick<Storage, 'getItem'> | undefined): ThemePreference {
  try {
    return parseThemePreference(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'dark';
  }
}

export function writeStoredTheme(storage: Pick<Storage, 'setItem'> | undefined, preference: ThemePreference): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The choice still applies for this page view.
  }
}
