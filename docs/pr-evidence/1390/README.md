# Task relations phone layout — author fixture

The screenshots use the **actual mounted TaskPlanning + shared DataTable and compiled application CSS** in Chromium at 390px and 1280px, light and dark, with synthetic rows. Run `node scripts/test-task-relations-phone.mjs`; set `HADRON_LAYOUT_SHOTS` to capture images.

This focused fixture deliberately uses the existing inert form/navigation test adapters. It proves layout, keyboard order and unchanged offered controls, **not authenticated routing, mutation persistence, server authority or a full application-shell run**. Independent UX and signed-in private-stack QA remain required by issue #1390's CHECKED gate.

Fresh main `da7af785c8dc0c8e33f84d9f42ad8aebc44219ef` fails real geometry: at a 390px viewport and scrollLeft=0, Remove spans x704.5..779.3. Red test commit `58b56d8c` also pins action placement and restoration of legacy views. Fixed layout puts Actions first and Task second; every eligible Remove is inside the viewport at scroll zero. Titles/handles remain reachable through the shared table's horizontal scrolling. No document overflow is permitted. Keyboard Tab from Remove reaches that row's task link.

Mounted controls retain the existing restrictions for STARTED, FINISHED, CANCELLED and read-only sessions; Holds up rows gain no Remove. The existing action/refusal tests are unchanged. Two independent mutants (allow saved column order to move Remove back; allow old visibility to hide Remove) fail the legacy-view regression.

Shared grid code, existing column ids and `task-dependencies` listKey are unchanged. Only the action column's leading/visible invariant is normalized; other saved column preferences remain.

Refs #1390. Landing serializes after #1393; merge its landed main before freezing this change. No readiness or deployment claim.
