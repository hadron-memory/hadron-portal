# hadron-web

SvelteKit SaaS frontend for [Hadron](https://hadrongraph.io) — a knowledge graph platform for AI agents.

Serves both consumers (browse marketplace, one-click setup) and teams (org management, graph sync, role-based access). The UI adapts automatically: users with only a personal workspace see a simplified consumer experience; users with organizations see the full enterprise navigation.

Connects to the [hadron-server](https://github.com/baragaun/hadron-server) GraphQL API.

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
- [hadron-server](https://github.com/baragaun/hadron-server) running (defaults to `http://localhost:4000`)

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

**Marketplace intent preservation:** Sign-up/sign-in pages accept a `?graph=<id>` query param. After auth, the user is redirected to `/browse?addGraph=<id>` which auto-adds the graph to their personal workspace.

The frontend never sees or stores OAuth credentials or email tokens.

## Routes

### Public (no auth required)

| Path | Description |
|---|---|
| `/` | Landing page — hero, features, public graph preview |
| `/signup` | Create account (GitHub or email); accepts `?graph=<id>` for marketplace intent |
| `/signin` | Sign in (GitHub or email); accepts `?graph=<id>` |
| `/browse` | Marketplace — browse all public graphs, "Use this graph" buttons |
| `/auth/callback` | Auth callback — sets cookie and redirects |
| `/auth/signout` | Clears auth cookie |

### Consumer (authenticated, personal workspace)

| Path | Description |
|---|---|
| `/app/dashboard` | Overview — graph stats, quick links, marketplace CTA |
| `/app/graphs` | My Graphs — all graphs across personal workspace and orgs |
| `/app/setup` | AI Setup — one-time config file download (Claude, Cursor, Windsurf) |

### Enterprise (authenticated, visible when user has explicit orgs)

| Path | Description |
|---|---|
| `/app/orgs` | List organisations |
| `/app/orgs/new` | Create organisation |
| `/app/orgs/[id]` | Org overview |
| `/app/orgs/[id]/members` | Manage org members |
| `/app/orgs/[id]/graphs` | List + manage graphs (with sync-all) |
| `/app/orgs/[id]/graphs/new` | Add graph config |
| `/app/orgs/[id]/graphs/[gid]` | Graph settings, sync, org subscriptions |
| `/app/orgs/[id]/graphs/[gid]/nodes` | Node list with usage stats and sorting |
| `/app/orgs/[id]/graphs/[gid]/browse` | Force-directed graph visualization |
| `/app/orgs/[id]/bundles` | Manage graph bundles |
| `/app/stations` | List API stations |
| `/app/stations/new` | Create API station |
| `/app/stations/[id]` | Station detail, bundle subscriptions |

All `/app/*` routes require authentication and redirect to `/` otherwise.

## Adaptive sidebar (consumer mode)

The UI adapts based on whether the user is in **consumer mode** — determined by having exactly one organization with `isVisible: null` (the auto-created org for users who signed up without an invitation).

- **Consumer mode**: Dashboard, My Memories, Browse Marketplace, AI Setup. Organization and station management routes redirect to the dashboard.
- **Full mode**: Dashboard, My Memories, Browse Marketplace, Organizations, Stations, AI Setup.

The transition is automatic — when a user creates a real organization or is invited to one, the full navigation appears. The `isConsumerMode` flag is derived server-side in the `/app` layout and flows through `$page.data`.

## Development

```bash
pnpm run dev        # start dev server on :5173
pnpm run check      # svelte-check type checking
pnpm run build      # production build
pnpm run preview    # preview production build
```
