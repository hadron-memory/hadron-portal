# Alarm acknowledgement follow-ups (#1987)

The user wants to acknowledge an alarm explicitly and understand whether the server accepted it, refused it, or left the outcome uncertain.

## Flow evaluation

Keep native POST for this slice. A missing session now preserves the local pathname and query through the existing sign-in return helper, stripping the named-action selector so returning cannot replay the write. Invalid reflected event ids are bounded to 200 UTF-16 code units; validation rejects the full over-length input before mutation. This is same-caller input hygiene, not a secret-exposure repair.

Native POST may prompt for resubmission on browser refresh, and a second explicit submission can replace the displayed first-success notice with “already acknowledged”. That second result is a refusal presentation, never a success and never a replacement of the first acknowledgement/person/time (hrn:node:hadronmemory.com:specs:cor:agt:050:24). The server remains the permission authority. No automatic retry is introduced.

PRG would remove the resubmission prompt but needs a separately reviewed result-transport contract (including refusals, committed warnings and uncertain outcomes) to avoid dropping or replaying feedback. Enhanced pending state could prevent duplicate activation while JS is active, but needs separately gated current-visit/teardown ownership, native/no-JS parity and result focus/announcement handling. The CHECKED gate explicitly reserves that flow choice; neither is implemented here. This evaluation does not grant future implementation.

## Verification boundaries

Pins cover preserved return query, bounded invalid reflection even on an early impersonation refusal, trim/length validation, exact typed statuses, generic versus exact-impersonation FORBIDDEN, malformed returned ids/times, ordinary success versus second-acknowledgement text and visibility beside failed/nonparticipant reads. Open/All action URLs stay exact; Acknowledged hides open rows and offers no write. Existing committed-warning/no-replay controls remain.

Independent browser QA has one pass: native keyboard submit, focus/result discoverability and announcement probe on full-page results, first/second acknowledgements, exact refusal/uncertainty semantics and sign-in return. An AX-tree/role observation alone is not a screen-reader speech claim; record the named reader+version if actual speech is exercised, otherwise retain the limit. The original a11y note is a proposed probe, not a confirmed accessibility defect.

Later cursor normalization and named-action pagination cleanup remain separate intake; this slice does not change paging/provider precedence or add client permission inference. Naming a specific affected alarm in feedback remains optional copy work, not a silent expansion here.
