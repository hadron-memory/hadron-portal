/**
 * Decide whether the chat-row oracle's native failure controls run, skip, or
 * fail (portal#2185 blind F1).
 *
 * Locally, and in CI's early unit-test step before the browser install, a
 * missing Chromium skips the controls. The dedicated CI step sets
 * `REQUIRE_CHROMIUM_CONTROLS=1`. There, a missing or unresolvable Chromium
 * fails by name, so the step cannot go green having verified nothing.
 *
 * @param {{ required: boolean, executablePath: () => string, exists: (path: string) => boolean }} opts
 * @returns {{ mode: 'run' } | { mode: 'skip' } | { mode: 'fail', reason: string }}
 */
export function chromiumControlsGate({ required, executablePath, exists }) {
  let problem;
  try {
    const path = executablePath();
    if (exists(path)) return { mode: 'run' };
    problem = `Chromium executable not found at ${path}`;
  } catch (e) {
    problem = `Chromium executable path could not be resolved: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (!required) return { mode: 'skip' };
  return { mode: 'fail', reason: `REQUIRE_CHROMIUM_CONTROLS is set but ${problem}` };
}
