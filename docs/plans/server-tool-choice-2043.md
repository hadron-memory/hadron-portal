# Server-owned chat tool choice (#2043)

The user wants to know whether a saved AI configuration works for both runs and chats. Reuse the existing Test action and feedback styling. The section stays form → Test → separately labelled Run and Chat outcome fields. These are two fixed diagnostic fields, not an entity collection; no picker, table or second action is introduced. Every new label and closed status message goes through `t()`.

## Served contract and request preservation

Schema was refreshed from server main05d6be7b83956def08165a584efc140109d27375 (a descendant of #4151) before red tests. `chatEffectiveToolChoice(chatId:String!):ChatToolChoice` is queried once after sendChatMessage stores the selected config, or after startChat on welcome. `chatToolChoiceFor(provider:String!,model:String!):ChatToolChoice!` supplies the inline unsaved-pair test. Provider/model IDs are sent verbatim. The server is the sole predicate owner; both portal model lists and their policy-oracle tests are removed. The server already includes the landed Bedrock remedy; no new model policy is introduced here.

Only exact AUTO enables auto. Null, absent or unrecognized decision values remain forced. A rejected query degrades to forced only when every GraphQL error is the unknown decision root field validation error. Chat-read, authentication, mixed, transport and other errors still fail the turn before the provider call. No error text or credential is surfaced by that fallback.

The 48 checked-in raw request bodies were captured from unmodified runtime code after the schema-only commit: all17 previously automatic IDs plus forced controls, welcome/history, all four runtime adapters, synthetic credentials and intercepted fetch only. They pin complete request bytes through the migration. Production response parsing remains first-call-wins and unvalidated as before; the stricter inline probe remains isolated.

## Saved Test

The existing saved-config mutation now opts into chatProbe and selects only `chat { status }`. The stored key remains on the server. Its run result and chat result are independent; a passing run cannot color a failed chat result green. Null/omitted chat means only the Run field is rendered. All seven ChatProbeStatus values have closed localized copy, with a safe unavailable message for malformed status values. Inline Test retains its single outcome.

No new cross-repository product law: this consumes the already-gated server contract. Companion documentation is hadron-docs#755, routed and staffed by Marco on the docs schedule; it is outside this portal PR. This PR references #2043/#1979 and leaves closure coordination to Marco.

## Validation and limits

Red-first commit covers16 runtime and18 API/view/mounted failures. Request fixtures prove transport shape, not live provider acceptance. Relevant suites, mutation controls, check, GraphQL validation, guards and build are required; hosted exact-head CI supplies the full suite. Independent cross-family LOCAL/BLIND, native browser QA and UX copy/rendered review remain required. Any private provider transport must be intercepted with synthetic credentials; no paid/external provider call or production is authorized by this change.

Author validation: 544 focused tests passed (one skipped), 15 production mutants killed by behavioral failures, typecheck 0 errors/0 warnings, 502 GraphQL documents validated and production build passed. Native Chromium drove all seven saved-Test statuses, null Run-only and independent Run/Chat outcomes on a private synthetic stack with intercepted saved-Test responses. Light/dark screenshots at1280 and390 were inspected. No external provider acceptance is claimed. The Test live region stays mounted empty before results and updates in place; its mounted identity is pinned. Private preview processes and stack are cleaned up before handoff.
