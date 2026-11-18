# App-manager single-grant approval — author evidence

Candidate based on portal merge fba5b5f00, server M1 merge 192d1d0a8ce49d12851a874b1dcfd2efd4f81b43. Private disposable Incus stack gene1716, API localhost:29116 and portal localhost:29117. All people, grants, nodes and passkeys were synthetic. No production, provider, enforcement activation or real device credential was used.

Real Chromium with the production portal build confirmed:

- The native POST opens the exact server-returned ceremonyUrl. A synthetic P-256 software passkey signs on the server page; explicit Refresh subsequently shows the server's activated grant and removes Approve.
- Approved-by-me filtering and requester/issuer/verifier history display the server's stored facts.
- Two requests for the same pending grant produce different request IDs while the earlier request remains open. Declining on the server page leaves the grant pending and signable after Refresh.
- 390px and 1280px light/dark documents have no horizontal overflow (screenshots here).
- The server independently returns GRANT_NOT_PENDING and its reader message for an activated grant. The action's refusal envelope and redaction are pinned in unit tests; the development probe's APIRequest transport alternated HTML and SvelteKit action JSON, so no transport-status assertion from that probe is claimed.

The first browser attempts found and fixed two handoff defects: noreferrer made Chrome send Origin:null (SvelteKit refused the POST); then form-action self blocked the ceremony redirect. The candidate keeps noopener and appends only the configured runtime PUBLIC_SERVER_URL HTTP(S) origin to the response's form-action policy. It rejects wildcard/userinfo/unsupported configuration, preserves nonces and other directives, and applies on source documents across SPA navigation. It never uses an internal server URL or a submitted origin.

Mounted tests cover focus rereads and their ownership fences; the visibility handler is not independently event-pinned. The headless/Xvfb browser did not consistently deliver a return focus event, so the native claim above is explicit Refresh, not automatic focus replay. Page reach (including an empty filtered page with a match on the next served page), expiry, holder departure, pre-start pending state and non-manager/impersonation refusals are pinned in focused tests. Independent QA must execute the stamped native matrix at the final frozen head; these author checks do not replace that seat.

Red-first commit a6277a789: 20 expected structural failures, 4 passes on the dependency main. Eleven production mutants were killed for relevant assertions (manager, capability, page binding, URL composition, refusal redaction, departed holder, issuer filter, paging, return read, native Origin policy, and refreshed creation receipt); source restored. The CSP policy has separate rejection/preservation tests. No schema or platform contract changes.
