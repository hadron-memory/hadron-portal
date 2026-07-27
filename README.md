# hadron-web

SvelteKit SaaS frontend for [Hadron](https://hadrongraph.io) — a knowledge graph platform for AI agents.

Serves both consumers (browse marketplace, one-click setup) and teams (org management, memory sync, role-based access). The UI adapts automatically: users with only a personal workspace see a simplified consumer experience; users with organizations see the full enterprise navigation.

Connects to the [hadron-server](https://github.com/hadron-memory/hadron-server) GraphQL API.

## Tech stack

| Concern | Choice |
|---|---|
| Framework | SvelteKit 2 + Svelte 5 (runes) |
| Styling | Tailwind CSS v4 |
| GraphQL | `graphql-request` (server-side only) |
| Auth | GitHub OAuth or email magic link via hadron-server → JWT cookie |
| Language | TypeScript strict |

## Prerequisites

- Node.js ≥ 22 (see `.nvmrc`)
- [pnpm](https://pnpm.io/) ≥ 10
- [hadron-server](https://github.com/hadron-memory/hadron-server) running (defaults to `http://localhost:4000`)

## Setup

```bash
cp .env.example .env
pnpm install
pnpm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `LOCAL_SERVER_URL` | server GraphQL base URL — server-side only | `http://localhost:4000` |
| `SERVER_URL` | server base URL — exposed to the browser (used for OAuth sign-in link) | `http://localhost:4000` |

Both variables point to the same server; the `PUBLIC_` prefix makes SvelteKit expose it to client-side code.

## Auth flow

Authentication is handled by hadron-server. Two identity providers are supported:

**GitHub OAuth:**
1. "Continue with GitHub" → `GET {LOCAL_SERVER_URL}/auth/github?redirect=/app/dashboard`
2. GitHub OAuth → server exchanges code, upserts user, issues JWT
3. Server redirects to `{FRONTEND}/auth/callback?token=<jwt>`

**Email magic link:**
1. "Continue with Email" → `POST {LOCAL_SERVER_URL}/auth/email` with `{ email }`
2. Server sends a magic-link email via Resend
3. User clicks link → server verifies token, upserts user, issues JWT
4. Server redirects to `{FRONTEND}/auth/callback?token=<jwt>`

**Common flow (both providers):**
4. `/auth/callback` sets `hadron_token` httpOnly cookie
5. New users are redirected to `/app/setup` (config file download); returning users go to `/app/dashboard`
6. `src/hooks.server.ts` decodes the JWT on every request → `event.locals.user` / `event.locals.token`
7. `/auth/signout` clears the cookie

**Marketplace intent preservation:** Sign-up/sign-in pages accept a `?memory=<id>` query param (legacy `?graph=<id>` also accepted). After auth, the user is redirected to `/browse?addMemory=<id>` (legacy `?addGraph=<id>` also accepted) which auto-adds the memory to their personal workspace. The `graph` aliases are transitional compat from the platform's Graph→Memory rename and may be removed without a constitution amendment per [.specify/memory/constitution.md](.specify/memory/constitution.md) P6.

The frontend never sees or stores OAuth credentials or email tokens.

## Routes

### Public (no auth required)

| Path | Description |
|---|---|
| `/` | Landing page — hero, features, public memory preview |
| `/signup` | Create account (GitHub or email); accepts `?memory=<id>` (or legacy `?graph=<id>`) for marketplace intent |
| `/signin` | Sign in (Apple, GitHub, Google, or email); accepts `?memory=<id>` (or legacy `?graph=<id>`) |
| `/browse` | Marketplace — browse all public memories, "Use this memory" buttons |
| `/about` | About page |
| `/contact` | Contact page |
| `/goodbye` | Post-account-deletion landing page (#662) — confirms the account is gone |
| `/auth/callback` | Auth callback — sets cookie and redirects |
| `/auth/signout` | Clears auth cookie |

### Consumer (authenticated, personal workspace)

| Path | Description |
|---|---|
| `/app/dashboard` | **302 redirector → `/app/orgs/<active>/`** (spec 014 — the rendered dashboard now lives under the active org's URL) |
| `/app/memories` | **302 redirector → `/app/orgs/<active>/memories`** (spec 014 FR-008) |
| `/app/agents` | **302 redirector → `/app/orgs/<active>/agents`** (spec 014 FR-008) |
| `/app/apps` | **302 redirector → `/app/orgs/<active>/apps`** (spec 014 FR-008) |
| `/app/marketplace` | Browse marketplace from inside the app (explicitly cross-org per spec 014 — not redirected) |
| `/app/setup` | AI Setup — one-time config file download (Claude, Cursor, Windsurf) |
| `/app/account` | User account settings and profile (includes "Create Organization" CTA) |

### Enterprise (authenticated, visible when user has explicit orgs)

Spec 014 ("single active organization") removed the top-level `ORGANIZATIONS` sidebar section in favor of a Slack-style switcher under "Signed in as". The active org is **URL-driven** (`/app/orgs/<id>/...`); the switcher opens other orgs in **new tabs** so multi-tab use is the default cross-org workflow. The membership-management list at `/app/orgs/` remains reachable from the switcher's "See all" link and from `/app/account`.

| Path | Description |
|---|---|
| `/app/orgs` | List organisations (membership-management surface; reachable from switcher "See all" and account page) |
| `/app/orgs/new` | Create organisation |
| `/app/orgs/[id]` | **Rendered active-org dashboard** (the destination of the `/app/dashboard` redirector since spec 014) |
| `/app/orgs/[id]/members` | Manage org members |
| `/app/orgs/[id]/memories` | List + manage memories (with sync-all) |
| `/app/orgs/[id]/memories/new` | Add memory config |
| `/app/orgs/[id]/memories/[gid]` | Memory settings, sync, org subscriptions |
| `/app/orgs/[id]/memories/[gid]/nodes/[nodeId]` | Node detail (with "+ Add child" affordance per spec 011) |
| `/app/orgs/[id]/memories/[gid]/nodes/[nodeId]/edit` | Edit a node's content / loc / edges |
| `/app/orgs/[id]/memories/[gid]/nodes/new` | Create a new node in this memory (optional `?parent=<loc>` to add as child) |
| `/app/orgs/[id]/memories/[gid]/browse` | Force-directed memory visualization |
| `/app/orgs/[id]/agents` | List + manage agents in this org |
| `/app/orgs/[id]/agents/new` | Define a new agent |
| `/app/orgs/[id]/agents/[aid]` | 301 redirect to the canonical detail page at `/app/agents/[aid]` (avoids maintaining two copies) |
| `/app/agents/[id]` | Canonical agent detail page (with "Install" affordance per spec 009) |
| `/app/orgs/[id]/agents/install/[aid]` | Install an agent (creates an App per spec 009) |
| `/app/orgs/[id]/apps` | List apps in this org (read-only since spec 009; create via Install) |
| `/app/orgs/[id]/apps/[appId]` | App detail — manage AppKey, members, surfaces |
| `/app/orgs/[id]/apps/[appId]/members` | Manage app members per spec 008 |
| `/app/orgs/[id]/create-chatbot` | Quick-create flow for a chatbot agent + app |
| `/app/orgs/[id]/exchange/[connectionId]` | Org-level exchange connection detail (no `/exchange` index route — this is the only exchange path) |
| `/app/usage/sessions` | Sessions usage view (full mode only) |
| `/app/usage/memory` | Memory usage view (full mode only) |

All `/app/*` routes require authentication and redirect to `/` otherwise.

## Adaptive sidebar (consumer mode)

The UI adapts based on whether the user is in **consumer mode** — determined by having exactly one organization with `isVisible: null` (the auto-created org for users who signed up without an invitation).

- **Consumer mode**: Dashboard, Memories, Docs (external link). Organization-level views are hidden until the user is invited to or creates a real org.
- **Full mode**: Dashboard, Memories, Agents, Apps, Docs (external link), plus a Usage section (Sessions, Memory) and the Organizations section (one entry per visible org).

Source of truth: the `consumerNav` and `fullNav` arrays in [`src/routes/app/+layout.svelte`](src/routes/app/+layout.svelte). Update both this README section and the route table above whenever those arrays change, per portal-constitution Refinement II.

The transition is automatic — when a user creates a real organization or is invited to one, the full navigation appears. The `isConsumerMode` flag is derived server-side in the `/app` layout and flows through `$page.data`.

## Development

```bash
pnpm run dev        # start dev server on :5173
pnpm run check      # svelte-check type checking
pnpm run build      # production build
pnpm run preview    # preview production build
```
