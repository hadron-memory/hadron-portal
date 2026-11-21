# Context reset switch (#1275)

Synthetic private stack `gemma1275`: hadron-server `8ab1e0c45ea60dc44e3f22c05401fcdb1fd3daa6`
(origin/main, includes #2255 `1a0a9420`), API 18475 / portal 18575. Real dev-login handoff as
`alpha-admin@e2e.test` (manager) and `alpha-member@e2e.test` (non-manager), Chromium, seeded
`hrn:agent:e2e-alpha:coordinator`, Settings tab. Light/dark via the stored theme at 1280px and 390px.

Driven in the browser (manager): box starts off with Save disabled; ticking it enables Save;
saving shows "Saved."; after a reload the box is on and Save is disabled again; clearing and
saving, then reloading, shows it off. As the non-manager: saving is refused by the server and the
page shows "Only the agent’s owner or an organization admin can change this." with the attempted
value left in the box.

Not driven here: a server without the field (it is a unit pin: a validation failure renders no
control). The stack and the portal dev server were stopped after capture.
These are author checks; independent browser QA is a separate seat.
