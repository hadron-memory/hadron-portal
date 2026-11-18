# Tester link owner scope (#2100)

Author check on an isolated seeded server at `bcf3e7cb3` and the portal fix in this PR, using native Chromium with real dev-login sessions. All accounts and Agents are synthetic.

The non-owner platform admin sees no Tester link at 1280 and 390 pixels, light and dark. The owner sees it at those same widths/themes. A platform admin owning their own Agent and an org manager also retain the link (1280, light/dark). The neighboring conversation-editor link remains present in all 12 cases. Direct Tester GETs remain 404 for the non-owner admin and 200 for each positive control. No browser page errors were recorded; no Tester turn/provider call was made. `results.json` records each observation.

The four PNGs show the negative and positive controls in desktop light and phone dark. Existing link styles, labels and tab layout are reused; this change adds no control or styling. The phone owner row retains its existing wrapping treatment.

One initial browser setup attempt timed out selecting Chatbot Control before the TabRow was ready. The completed check explicitly awaited the existing TabRow hydration state before using native controls. The fresh stack and portal server were removed after the check; credential-bearing setup logs were deleted.

A separate server private-memory promotion failure encountered during fixture setup was reported to Charles for QA intake, with sanitized evidence at `hrn:node:hadronmemory.com:hadron-dev-team-shared:findings:gene-2100-agent-private-promotion-intake`. The completed UI check used ordinary Agent auto-provisioning. That server path is outside this patch.
