<!--
PARENT RE-RATIFICATION — 2026-05-07 (parent v1.2.0 → v1.3.0)

The Hadron-wide parent constitution was amended via spec-kits PR
#27 (commit 35246dbd) to formalize the fifth nodeType `abstract`
in Invariant 2. This is corrective — `abstract` was already in
active use server-side and documented in hadron-docs; the parent
amendment regularized the constitutional record to match.

Portal-local impact: none. The portal constitution's refinements
(Principle II/III/V) and portal-only invariants (P1–P6) do not
restate Invariant 2; the parent's nodeType enumeration is
inherited unchanged. Re-ratifying this document at v1.0.0 with
the new parent pin (v1.3.0 + new SHA) per the parent-sync clause
in the Inheritance section.

No version change to this document. No content change beyond the
parent pin update.

————————————————————————————————————————————————————————————————

SYNC IMPACT REPORT — initial ratification → 1.0.0

This is the first hadron-portal-local constitution. It does NOT
replace the Hadron-wide constitution; it inherits from it and adds
portal-specific refinements. Cross-cutting principles (test-first,
docs-concurrent, accessibility/i18n-readiness, brainstorm→spec→
implement, zero-trust apps, spec-code coherence) and the 14
technology invariants live in the parent and are not restated here.

Sections added:
- Inheritance pin (parent constitution + version + SHA)
- Refinements (portal-local interpretations of inherited principles)
- Portal Technology Invariants (additional, portal-only)
- Spec Workflow (where portal-targeted specs live)
- Governance

Templates requiring updates:
- none yet — no `.specify/templates/` directory exists in
  hadron-portal at ratification time. When portal-local templates
  are introduced, this section flags them for sync.

Follow-up TODOs:
- none.
-->

# Hadron Portal Constitution

## Inheritance

This constitution **extends** the Hadron-wide constitution at
`spec-kits/.specify/memory/constitution.md`, version **1.3.0**,
SHA `35246dbdf0421ae7831690bf63120041f6569d31` (last amended
2026-05-07).

The parent's six core principles (I–VI) and 14 technology invariants
apply to all work in this repository unmodified. This document only
captures portal-specific **refinements** to those principles and
**additional** portal-only invariants. In any conflict between the
parent and this document, the **more specific** rule wins (per the
parent's Conflict Resolution clause); if equally specific, the parent
wins.

When the parent is amended, this document MUST be reviewed within the
amending PR and either re-ratified at its current version (if no
portal-local impact) or amended in lockstep.

## Refinements

These refine inherited principles for portal-local work. Numbering
follows the parent.

### II. Docs-Concurrent — portal scope

`hadron-docs` remains the canonical user-facing documentation site
(per the parent). In addition: changes that add, remove, or rename
**portal routes** MUST update the route table in
[README.md](../../README.md) in the same PR. Changes that alter
**auth flows**, **environment variables**, or the **adaptive sidebar
mode rule** MUST update the corresponding README sections in the
same PR. The portal README is in-repo developer documentation —
keeping it accurate is part of "done."

### III. Accessible to Non-Technical Readers — i18n boundary

The parent requires i18n-readiness from day one. The portal-local
implementation of this requirement is:

- All user-visible strings in `.svelte` files and in any code that
  produces user-facing text MUST go through
  [src/lib/i18n/t.ts](../../src/lib/i18n/t.ts) — i.e., `t(id,
  defaultText)`. Hardcoded literals in templates or in error
  messages surfaced to the UI are violations.
- `id` MUST be a stable, hierarchical key (e.g.
  `"edge-conditions.builder.add-clause"`). Renaming an `id` is a
  breaking change once a real i18n loader is wired up; treat it
  with the same care as an API rename.
- The exception window: pre-existing literals in legacy components
  are not retroactively required to migrate — but any **touched**
  component MUST migrate its strings as part of the change. New
  components have no exception.

### V. Zero-Trust Apps — portal as an authenticated client

The portal is an authenticated client of `hadron-server` and is
itself subject to the parent's zero-trust rule:

- Authorization decisions MUST be made server-side. `+page.server.ts`
  and `+server.ts` handlers MUST verify `event.locals.user` /
  `event.locals.token` (set by [src/hooks.server.ts](../../src/hooks.server.ts))
  before reading or mutating data. Client-side guards (Svelte
  component conditionals, `$page.data` flags) are presentation
  only — never the trust boundary.
- The portal MUST NOT issue GraphQL mutations from the browser.
  Browser-originated mutations go through internal `/api/*` proxy
  routes under [src/routes/api/](../../src/routes/api/), which
  re-verify the JWT cookie before forwarding to `hadron-server`.
- The portal MUST NOT see OAuth credentials, magic-link tokens, or
  raw provider secrets. Identity is delivered as a JWT in an
  httpOnly cookie issued by `hadron-server`.

## Portal Technology Invariants

These are **additional** to the parent's 14 invariants and apply only
within `hadron-portal`. Changing any of them requires a portal
constitution amendment (and may also require a parent amendment if
it affects Invariant 9).

P1. **Stack pin** — SvelteKit 2 + Svelte 5 (runes mode), Tailwind
    CSS v4, TypeScript strict, Node adapter. Replacing the
    framework, downgrading to non-runes Svelte, or removing strict
    TypeScript requires a MAJOR amendment to **both** this document
    and the parent's Invariant 9.

P2. **GraphQL access locality** — `graphql-request` MUST be invoked
    only from server-side code: `+page.server.ts`, `+server.ts`,
    `src/hooks.server.ts`, or files under
    [src/lib/server/](../../src/lib/server/). Importing
    `graphql-request` (or any direct GraphQL transport) from a
    `.svelte` component, a `+page.ts`, or any other browser-reachable
    module is a violation. The boundary is enforced by file location;
    a CI guard is desirable but not yet required.

P3. **Type-driven UI** — UI shape MUST be derived from the typed
    entity it represents (the pattern restored in #184 and reinforced
    in #186). Where a field's presence, label, or behavior is
    expressible from the entity's type, the component MUST read from
    the type rather than duplicating the decision in markup. Adding
    parallel hardcoded UI for a typed property — when a type-driven
    rendering already exists — is a regression and must be justified.

P4. **Markdown sanitization** — any markdown rendered to the DOM that
    originates from a user, an agent, or any non-trusted source MUST
    pass through `DOMPurify` (or an equivalent vetted sanitizer) AFTER
    markdown-to-HTML conversion and BEFORE insertion. Direct
    `{@html}` of `marked()` output without sanitization is a
    violation (this was the 0a5e7ed/#186 fix; the rule generalizes
    it).

P5. **Consumer-mode derivation** — the `isConsumerMode` flag MUST be
    derived server-side in the `/app` layout loader and flow to
    components through `$page.data`. Client-side recomputation from
    raw user/org data is forbidden — it would let the trust boundary
    leak (a malformed client could "promote" a consumer to enterprise
    UI). The rule from the parent's Principle V applies: server is
    authoritative, client is presentation.

P6. **Marketplace intent preservation** — sign-up and sign-in pages
    MUST accept a memory-id query parameter, preserve it through the
    auth callback, and land the authenticated user on `/browse` with
    that memory queued for one-click add. The canonical parameter
    names today are `?memory=<id>` on the inbound (sign-in / sign-up)
    side and `?addMemory=<id>` on the `/browse` side; the legacy
    aliases `?graph=<id>` and `?addGraph=<id>` MAY be accepted for
    backwards compatibility (a transitional shim from the platform's
    Graph→Memory rename) but their removal does NOT require a
    constitution amendment. What requires an amendment is removing,
    breaking, or fundamentally restructuring the *intent-preservation
    contract* itself — the property that an external "Use this
    memory" link delivers an authenticated user to the right workspace
    with the memory ready to add. This is not just a UX nicety; it is
    the contract that makes external marketplace links work.

## Spec Workflow

Per the conversation that ratified this document:

- **All Hadron specs — including portal-only specs — live under**
  `spec-kits/specs/NNN-name/`. The portal repo does NOT host its
  own `specs/` directory. Reasons: a single contiguous ID space,
  graceful handling of scope creep when a "portal-only" spec
  unexpectedly expands to touch `hadron-server` or `hadron-client`,
  and co-location with brainstorming summaries in
  `hadron-concept/design-discussions/`.
- A spec whose **Repos & PRs** section lists only `hadron-portal`
  is what we mean by "portal-targeted." It still goes through
  `/speckit-specify`, `/speckit-plan`, `/speckit-tasks`,
  `/speckit-implement`, `/speckit-finalize` from the `spec-kits/`
  root.
- The trade-off accepted: PRs in `hadron-portal` cannot bundle
  spec-corpus edits with code edits, because the spec corpus lives
  in a sibling repo. Spec-Code Coherence (parent Principle VI) is
  enforced across both PRs at finalize time.

## Governance

Amendments to this document follow the parent's amendment process,
scoped to portal:

1. A dated brainstorming session in
   `hadron-concept/design-discussions/` proposing the change (the
   parent's Principle IV applies).
2. A PR against this file with a populated Sync Impact Report
   (version delta, changed items, templates requiring updates).
3. A version bump under semantic versioning, identical in meaning
   to the parent:
   - **MAJOR** — a refinement or portal invariant is removed or
     redefined incompatibly.
   - **MINOR** — a new refinement, portal invariant, or mandatory
     section is added.
   - **PATCH** — wording, typo, or non-semantic refinement.

**Parent sync**: when the parent constitution is amended, every PR
that amends the parent MUST either (a) confirm in its description
that no portal-local impact exists, or (b) include a paired
amendment to this file. Portal contributors reviewing parent-
amendment PRs are responsible for flagging portal impact.

**Conflict resolution**: as stated under Inheritance — more specific
rule wins; equally specific, parent wins; unresolved tension MUST
be called out in the affected `plan.md` rather than silently
chosen.

**Version**: 1.0.0 | **Ratified**: 2026-05-05 | **Last Amended**: 2026-05-05
