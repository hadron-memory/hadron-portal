# #1132 author validation

The reader needs to report a failure using its request id without exposing server diagnostics. Existing form error banners and ErrorPage remain the presentation surfaces. No new form or tab state is introduced.

## Automated checks

Red-first commit 3d374c08 pins the public envelope, actual invite action, Agent loader, and mounted ErrorPage. On main it produced 13 expected failures and 3 passing controls. The implementation passed 6,891 suite tests; the subsequent agent-chat correlation fix passed the focused 149-test action/loader/envelope set. Production build passed (2,462 MB peak of the 4,144 MB limit). Typecheck, GraphQL validation, interpolation, teardown, grid filters and bare-loc checks pass. Updated legacy expectations suppress unknown/uncoded GraphQL prose; intentional typed refusal controls remain.

## Author browser smoke (not independent QA)

Fresh private Incus instance `hadron-e2e-gizelle1132`, provider server c47c20093a72d5bb6d156b0290499495ad1f7470, loopback API 18847 and portal 18848. Synthetic fixture alpha-admin@e2e.test signed in through browser dev-login. No shared or production database was used.

Two temporary private-only resolver probes issued `SELECT private_1132 FROM missing_1132` through the request database client, after authorization: inviteUser only for synthetic fault-1132@e2e.test; agent only for hrn:agent:e2e-alpha:fault-1132. This exercises the real database failure and server formatter, rather than mocking a wire envelope. These probes were not committed and were removed with the private server checkout.

- Invite action showed fixed copy and request id 99b5b9ee-1641-4afb-9811-b3ac7440d143.
- Agent loader showed fixed copy and request id 1bdbe7fa-5dcb-4998-b7ad-f7ae25d1e3c6.
- Both ids matched the corresponding database fault in private server logs. No SQL, table/column name, query payload or private path appeared in the DOM; ids appeared in neither document title nor URL.
- A real account email-change BAD_USER_INPUT retained its intentional refusal and showed no id. A clean absent Agent retained concealment and showed no id.
- Loader UUID selection and clipboard copy matched exactly. At 390px the page width remained 390px. No browser page errors occurred.
- Light/dark action and loader screenshots plus mobile loader are in design/reviews/1132. All five were inspected; changed error text is readable and wraps without overflow. Existing banner/button styling was retained.

Cleanup verified: preview stopped, Incus instance/state removed, temporary server checkout removed. No auth artifacts or raw server logs are included here. Independent QA must repeat the action/loader/log-correlation and refusal/concealment checks on its own fresh private stack at the frozen PR head; author smoke does not replace that seat.

Finding captured and read back: hrn:node:hadronmemory.com:hadron-portal:findings:typed-refusal-defaults-need-error-envelope. Contract unchanged: hrn:node:hadronmemory.com:specs:cor:api:260:01. No new spec citation minted.

## Batched review fixes

BLIND and LOCAL found a missing portal-side logger, framework4xx copy flattened by the hook, actual bundle class-name refusals missing from the local opt-in, and known create/read refusal statuses needing preservation. Red commit141123f3 adds12 failing pins at the original head (78 controls pass); three further framework4xx hook pins also failed before the fix. The final batch passes 6,916 tests, focused106 checks, typecheck0/0 and repository guards. Production build passed at the batch before the final framework-message return condition (2,457MB peak); hosted CI validates the exact final head. No new author browser run is claimed for this batch; independent seat holders must validate or carry their final-head coverage.

The unresolved typed memory/App collision gap belongs to the provider: its plain Errors are already masked as generic faults. No client collision recovery from generic prose was introduced. Evidence and QA dependency disposition are on the PR. New reusable review check captured at hrn:node:hadronmemory.com:hadron-portal:review:custom-error-hook-framework-copy-and-logging; lint87 checks OK.

## Raw-message bypass fix batch

LOCAL completed the full 143-call inventory at 29b43f36 and found seven bypassing catches in six route files. A further source sweep found the URN resolver JSON endpoint. Red commit d6fc66bd executes all eight actual handlers with real internal, unknown and payload-less ClientErrors: 24 expected failures before the fix, 24 passing afterward. The focused regression set passes 190 tests; the full suite passes 6,918 tests. Typecheck has zero errors/warnings; GraphQL validation checks 352 documents and 458 calls with zero invalid/mismatched; interpolation, teardown, grid-filter and bare-loc guards pass. Production build passes at 2,452 MB peak of the 4,144 MB limit.

The refreshed AST inventory contains 151 calls across 73 modules, supplemented by a raw-source audit. Status/control branches, intentional known refusals and genuine transport behavior remain unchanged; GitHub callback generic faults retain request-id metadata. No new author browser run is claimed. Existing independent receipts at 29b43f36 require holder delta/carry dispositions at the new frozen head. New reusable criterion: hrn:node:hadronmemory.com:hadron-portal:review:error-envelope-raw-message-bypasses (88-check lint passes). Fresh main 22891a7d has no changed-file overlap, so no currency-only merge is made.
