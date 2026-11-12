# Law Club Manager (lawx_clubs)

Prototype site that helps university clubs manage budgets, events and sponsors, and helps
partners find clubs to sponsor. See [`SPEC.md`](SPEC.md) for the full spec and
[`ASSUMPTIONS.md`](ASSUMPTIONS.md) for decisions made along the way.

**Stack:** React + TypeScript + Vite + Tailwind CSS · Supabase (Postgres, Auth, Storage,
Edge Functions) · GitHub Pages via GitHub Actions.

## Repository layout

```
.github/workflows/deploy.yml   Build + deploy to GitHub Pages on every push to main
src/                           React app (HashRouter, so deep links work on Pages)
  lib/supabase.ts              Supabase client (anon key only)
  pages/                       Route components
  components/                  Shared UI
  index.css                    Tailwind + theme tokens (accent color lives here)
supabase/
  config.toml                  Supabase CLI config (local dev + auth settings)
  migrations/                  SQL migrations — the source of truth for the schema
  functions/                   Edge Functions (later phases)
scripts/                       One-off scripts (IPEDS import, Phase 1)
```

## Prerequisites

- Node.js 20+ (CI uses 22) and npm
- A free [Supabase](https://supabase.com) account
- (Optional, for a fully local database) [Docker Desktop](https://www.docker.com/products/docker-desktop/)

The Supabase CLI is installed as a dev dependency, so use it through `npx supabase ...`.

## One-time setup (by hand)

### 1. Install dependencies

```bash
npm install
```

### 2. Create the Supabase project

1. Sign in at <https://supabase.com/dashboard> → **New project**.
2. Pick a name (e.g. `lawx-clubs`), set a strong **database password** (save it in a password
   manager — you'll need it once in step 3), and choose the region closest to your users.
3. Wait ~2 minutes for it to provision.
4. Go to **Project Settings → API** and note:
   - **Project URL** (e.g. `https://abcd1234.supabase.co`)
   - **anon / public** key — safe for the browser
   - **service_role** key — **secret**; never put it in the frontend or commit it
5. Note the **project ref** — the `abcd1234` part of the URL.

### 3. Link the CLI and run the migrations

```bash
npx supabase login
```

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
```

(It asks for the database password from step 2.)

```bash
npx supabase db push
```

`db push` applies every file in `supabase/migrations/` that hasn't run yet. Re-run it whenever
a new migration is added. Verify in the dashboard under **Table Editor**: you should see
`universities` and `profiles`, each marked "RLS enabled".

### 4. Configure Auth URLs

In the Supabase dashboard → **Authentication → URL Configuration**:

- **Site URL:** `https://mcottle1.github.io/lawx_clubs/`
- **Redirect URLs:** add `https://mcottle1.github.io/lawx_clubs/**` and `http://localhost:5173/**`

(Needed for password-reset and invite links, Phase 1.)

### 5. Local environment variables

```bash
cp .env.example .env.local
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from step 2. `.env.local` is
git-ignored.

### 6. GitHub Pages + Actions

1. On GitHub: **Settings → Pages → Build and deployment → Source:** choose **GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables tab → New repository variable**,
   add two *variables* (not secrets — they're public values that end up in the browser bundle):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Push to `main` (or run the workflow from the **Actions** tab → *Deploy to GitHub Pages* →
   **Run workflow**). The site appears at `https://mcottle1.github.io/lawx_clubs/`.

Later phases will add true *secrets* (Resend key, Anthropic key, cron shared secret); those go
in Supabase Edge Function secrets and, for the cron caller, GitHub Actions *Secrets*. Each phase's
notes will list exactly which.

### 7. Make yourself a site administrator (after Phase 1 sign-up exists)

Site admins have no public sign-up. Sign up as a club or partner, then in Supabase → **SQL
Editor** run:

```sql
update public.profiles set role = 'site_admin'
where user_id = (select id from auth.users where email = 'you@example.com');
```

## Day-to-day commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server at <http://localhost:5173> |
| `npm run build` | Type-check and build to `dist/` |
| `npm run lint` | ESLint |
| `npm run preview` | Serve the production build locally |
| `npm run db:push` | Apply new migrations to the linked Supabase project |
| `npm run db:reset` | (Local Docker DB only) wipe and re-run all migrations + seed |

Visit `/#/status` to confirm the app can reach Supabase and the migration ran.

### Optional: fully local Supabase

With Docker running: `npx supabase start` prints a local URL and anon key; put those in
`.env.local`. `npx supabase stop` shuts it down.

## Environment variables

| Name | Where | Secret? | Purpose |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | `.env.local`, GitHub Actions variable | No | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | `.env.local`, GitHub Actions variable | No | Public anon key (RLS enforces access) |
| `VITE_BASE_PATH` | Set automatically by the deploy workflow | No | Pages sub-path (`/lawx_clubs/`) |

Later phases add (as Supabase function secrets): `RESEND_API_KEY`, `ANTHROPIC_API_KEY`,
`ANTHROPIC_MODEL`, `CRON_SECRET`, `SITE_URL`.

## Security model

- The browser only ever has the anon key. **Row Level Security is on for every table** and is
  the real access control.
- Self sign-up can only create `club` or `partner` accounts — the `handle_new_user` trigger
  rejects any other role from client-supplied metadata. `university_admin` accounts are
  created by an Edge Function (service role) from an invite; `site_admin` is granted by hand.
- Users can't change their own role (no update grant on `profiles.role`).

## Changing the accent color

Edit the `--color-accent-*` values at the top of `src/index.css`.
