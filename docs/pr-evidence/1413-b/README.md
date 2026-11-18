# Stop-signals accessibility and copy (slice B) — author evidence

Refs #1413. The real stops page mounted through Vite in Chromium with synthetic
fixture data (no server, no real accounts), timezone forced to
America/Los_Angeles. Author checks; they do not replace the seats.

Measured in the browser, light and dark, 1280px and 390px:

- Row Lift: 45×44px. Every radio label: 44px high or more.
- No horizontal page overflow at 390px (scrollWidth equals the viewport).
- Banner end time names its zone: `until Nov 2, 2026, 10:00:00 (America/Los_Angeles)`.
- Roster read failed: Choose… stays and the hint sits under the worker select.
- Empty cursor page and the "Show older stops" link: see the captures and the node tests.

Not captured here: a refused lift in the new status line and the dialogs need a
live server and a signed-in manager; they are pinned by mounted tests
(`StopSignalsPanel.a11y.client.test.ts`) and left to the browser QA seat.

| State | Light | Dark |
| --- | --- | --- |
| Page, 1280px | [png](stops-page-1280-light.png) | [png](stops-page-1280-dark.png) |
| Page, 390px | [png](stops-page-390-light.png) | [png](stops-page-390-dark.png) |
| Roster failed, 390px | [png](stops-roster-failed-390-light.png) | [png](stops-roster-failed-390-dark.png) |
| Empty cursor page, 390px | [png](stops-empty-cursor-390-light.png) | [png](stops-empty-cursor-390-dark.png) |
