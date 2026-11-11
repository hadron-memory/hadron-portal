# TabRow oversized selected label (#1895)

Synthetic throwaway page rendering the real `TabRow` in a 308px column at a 390px viewport (Chromium, Playwright), selected label 126 characters. Not a signed-in route capture; no shipped translation is known to trigger this.

| | row clientWidth | row scrollWidth | document scrollWidth |
|---|---|---|---|
| `main` | 308 | 919 | 919 |
| this change | 308 | 308 | 390 |

[Image](oversize-selected-390.png): the label stays whole and selected, wrapping its own text inside the column; More sits on the next line. Ordinary and exact-fit selections keep `whitespace-nowrap` (pinned in `TabRow.client.test.ts`).
