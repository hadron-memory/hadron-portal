/** Shared by the real App layout and its Chromium layout oracle (portal#2096). */
export const APP_SHELL_ROW = 'flex gap-4 px-4 py-8 sm:gap-8 sm:px-6';
export const APP_SHELL_CONTENT = 'min-w-0 flex-1';

/** The aside is mounted only when menuOpen !== false; null follows the viewport. */
export function appShellNavClass(menuOpen: boolean | null): string {
  return `sticky top-8 self-start w-48 shrink-0 flex-col ${menuOpen === null ? 'hidden sm:flex' : 'flex'}`;
}
