# Shared tab-row geometry fixtures

These are synthetic Vite fixtures of the real TabRow component and compiled app CSS, not signed-in route captures. Each row uses its label set; short rows also get an explicitly synthetic extra translated label to exercise overflow. Node includes conditional variants together for stress coverage. Independent browser QA owns real route coverage.

Chromium, 390px/308px content and 1280px/1000px content, touch-capable context. Each image follows menu keyboard open/move/Escape and shows focus returned to More.

| Row | 390 light | 390 dark | 1280 light | 1280 dark |
|---|---|---|---|---|
| app | [Image](app-390-light.png) | [Image](app-390-dark.png) | [Image](app-1280-light.png) | [Image](app-1280-dark.png) |
| agent | [Image](agent-390-light.png) | [Image](agent-390-dark.png) | [Image](agent-1280-light.png) | [Image](agent-1280-dark.png) |
| memories | [Image](memories-390-light.png) | [Image](memories-390-dark.png) | [Image](memories-1280-light.png) | [Image](memories-1280-dark.png) |
| worker | [Image](worker-390-light.png) | [Image](worker-390-dark.png) | [Image](worker-1280-light.png) | [Image](worker-1280-dark.png) |
| node | [Image](node-390-light.png) | [Image](node-390-dark.png) | [Image](node-1280-light.png) | [Image](node-1280-dark.png) |
| org-memories | [Image](org-memories-390-light.png) | [Image](org-memories-390-dark.png) | [Image](org-memories-1280-light.png) | [Image](org-memories-1280-dark.png) |
| org-agents | [Image](org-agents-390-light.png) | [Image](org-agents-390-dark.png) | [Image](org-agents-1280-light.png) | [Image](org-agents-1280-dark.png) |
| account | [Image](account-390-light.png) | [Image](account-390-dark.png) | [Image](account-1280-light.png) | [Image](account-1280-dark.png) |
| task-views | [Image](task-views-390-light.png) | [Image](task-views-390-dark.png) | [Image](task-views-1280-light.png) | [Image](task-views-1280-dark.png) |

Wide selected-label fallback: the long synthetic label stays whole and selected inline; More moves to the next control line. This case is shown on the short-row 390px captures and pinned by the browser script. Labels themselves never wrap.
