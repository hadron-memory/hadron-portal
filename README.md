# hadron-web

SvelteKit SaaS frontend for [Hadron](https://hadrongraph.io) — a versioned knowledge graph platform for AI agents and developer tools.

Connects to the [hadron-controller](https://github.com/baragaun/hadron-controller) GraphQL API.

## Tech stack

| Concern | Choice |
|---|---|
| Framework | SvelteKit 2 + Svelte 5 (runes) |
| Styling | Tailwind CSS v4 |
| GraphQL | `graphql-request` (server-side only) |
| Auth | GitHub OAuth or email magic link via hadron-controller → JWT cookie |
| Language | TypeScript strict |

## Prerequisites

- Node.js ≥ 20
- [hadron-controller](https://github.com/baragaun/hadron-controller) running (defaults to `http://localhost:4000`)

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `CONTROLLER_URL` | Controller GraphQL base URL — server-side only | `http://localhost:4000` |
| `PUBLIC_CONTROLLER_URL` | Controller base URL — exposed to the browser (used for OAuth sign-in link) | `http://localhost:4000` |

Both variables point to the same controller; the `PUBLIC_` prefix makes SvelteKit expose it to client-side code.

## Auth flow

Authentication is handled by hadron-controller. Two identity providers are supported:

**GitHub OAuth:**
1. "Continue with GitHub" → `GET {CONTROLLER_URL}/auth/github?redirect=/app/dashboard`
2. GitHub OAuth → controller exchanges code, upserts user, issues JWT
3. Controller redirects to `{FRONTEND}/auth/callback?token=<jwt>`

**Email magic link:**
1. "Continue with Email" → `POST {CONTROLLER_URL}/auth/email` with `{ email }`
2. Controller sends a magic-link email via Resend
3. User clicks link → controller verifies token, upserts user, issues JWT
4. Controller redirects to `{FRONTEND}/auth/callback?token=<jwt>`

**Common flow (both providers):**
4. `/auth/callback` sets `hadron_token` httpOnly cookie, redirects to dashboard
5. `src/hooks.server.ts` decodes the JWT on every request → `event.locals.user` / `event.locals.token`
6. `/auth/signout` clears the cookie

The frontend never sees or stores OAuth credentials or email tokens.

## Routes

| Path | Description |
|---|---|
| `/` | Landing page — hero, features, public graph preview |
| `/signup` | Create account (GitHub or email) |
| `/signin` | Sign in (GitHub or email) |
| `/browse` | Browse all public graphs (no auth required) |
| `/auth/callback` | Auth callback — sets cookie and redirects |
| `/auth/signout` | Clears auth cookie |
| `/app/dashboard` | Summary: my orgs and clients |
| `/app/orgs` | List organisations |
| `/app/orgs/new` | Create organisation |
| `/app/orgs/[id]` | Org overview |
| `/app/orgs/[id]/members` | Manage org members |
| `/app/orgs/[id]/graphs` | List + manage graph configs |
| `/app/orgs/[id]/graphs/new` | Add graph config |
| `/app/orgs/[id]/graphs/[gid]` | Graph settings, sync, org subscriptions |
| `/app/clients` | List API clients |
| `/app/clients/new` | Create API client |
| `/app/clients/[id]` | Client detail, graph subscriptions |

All `/app/*` routes require authentication and redirect to `/` otherwise.

## Development

```bash
npm run dev        # start dev server on :5173
npm run check      # svelte-check type checking
npm run build      # production build
npm run preview    # preview production build
```
