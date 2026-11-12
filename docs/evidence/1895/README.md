# TabRow oversized selected label (#1895)

Synthetic throwaway page rendering the real `TabRow` in a 308px column at a 390px viewport (Chromium, Playwright), selected label 126 characters. Not a signed-in route capture; no shipped translation is known to trigger this.

| | row clientWidth | row scrollWidth | document scrollWidth |
|---|---|---|---|
| `main` | 308 | 919 | 919 |
| this change | 308 | 308 | 390 |

[Image](oversize-selected-390.png): the label stays whole and selected, wrapping its own text inside the column; More sits on the next line. Ordinary selections keep `whitespace-nowrap` (the component pin covers ordinary versus oversized).
The strict `>` wrap boundary was source-checked; the original browser QA approximated exact fit
at 305.4px in a 308px column rather than proving equality. The 400/399 component case pins the
More-menu threshold, not the selected-label wrap boundary.

The #1994 [geometry harness](../../../scripts/test-tab-row-layout.mjs) now adds measured-equality
controls in both modes, alongside unbroken and spaced oversized labels. This is new synthetic
component coverage, not a retroactive claim about the original signed-in QA run.
