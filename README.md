# Law Club Manager (lawx_clubs)

Prototype site that helps university clubs manage budgets, events and sponsors, and helps
partners find clubs to sponsor. See [`SPEC.md`](SPEC.md) for the full spec and
[`ASSUMPTIONS.md`](ASSUMPTIONS.md) for decisions made along the way.

**Stack:** React + TypeScript + Vite + Tailwind CSS · Supabase (Postgres, Auth, Storage,
Edge Functions) · Resend (email) · GitHub Pages via GitHub Actions.

**Status:** Phase 1 (auth & roles) complete.

## Repository layout

```
.github/workflows/deploy.yml   Build + deploy to GitHub Pages on every push to main
src/                           React app (HashRouter, so deep links work on Pages)
  auth/                        Session/profile context, role guards
  lib/                         Supabase client, constants, types, upload helpers
  pages/                       Route components (one folder per role)
  components/                  Shared UI
  index.css                    Tailwind + theme tokens (accent color lives here)
supabase/
  config.toml                  Supabase CLI config (local dev, auth, function settings)
  migrations/                  SQL migrations — the source of truth for the schema
  functions/                   Edge Functions (server code that needs secret keys)
scripts/                       IPEDS importer, local bootstrap, RLS test suite
```

## Accounts and roles

| Role | How the account is created | Lands on |
| --- | --- | --- |
| Club | Public sign-up (`/#/signup/club`); only universities that have an active admin are listed | `/#/club` |
| Partner | Public sign-up (`/#/signup/partner`) | `/#/partner` |
| University admin | Site admin sends an invite → admin opens the emailed link, sets a password and scheduling info. This marks the university "participating" | `/#/university-admin` |
| Site admin | Granted by hand in SQL (step 7 below) | `/#/site-admin` |

---

## One-time setup (hosted)

Steps 1–6 were in Phase 0; **steps 7–11 are new in Phase 1.**

### 1. Install dependencies

```bash
npm install
```

### 2. Create the Supabase project

1. Sign in at <https://supabase.com/dashboard> → **New project**. Save the database password.
2. **Project Settings → API**: note the **Project URL**, the **anon/public** key, and the
   project ref (the `abcd1234` in `https://abcd1234.supabase.co`). The **service_role** key is
   secret — never put it in the frontend or commit it.

### 3. Link the CLI and run the migrations

```bash
npx supabase login
```

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
```

```bash
npx supabase db push
```

Re-run `db push` whenever new files appear in `supabase/migrations/`.

### 4. Auth URL configuration

Supabase dashboard → **Authentication → URL Configuration**:

- **Site URL:** `https://mcottle1.github.io/lawx_clubs/`
- **Redirect URLs:** `https://mcottle1.github.io/lawx_clubs/**` and `http://localhost:5173/**`

### 5. Local environment variables

```bash
cp .env.example .env.local
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

### 6. GitHub Pages + Actions

- **Settings → Pages → Source:** GitHub Actions (repo must be public on a free plan).
- **Settings → Secrets and variables → Actions → Variables:** `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`.

### 7. Decide how sign-up emails work ⚠️

Supabase's built-in email sender **only delivers to members of your Supabase team** and is
limited to a few emails per hour. That affects sign-up confirmation and password-reset emails.
Pick one:

- **A — Quickest for the prototype:** Authentication → **Sign In / Providers → Email** → turn
  **off "Confirm email"**. Sign-ups log in immediately. Password reset still only reaches team
  members' addresses.
- **B — Real email (recommended before real users):** verify a domain in Resend (step 9), then
  Authentication → **Emails → SMTP Settings** → enable custom SMTP:
  host `smtp.resend.com`, port `465`, username `resend`, password = your Resend API key,
  sender = an address on your verified domain.

The app handles both: with confirmation on, sign-up shows "check your email"; partners upload
their logo after their first login.

### 8. Deploy the Edge Functions

```bash
npx supabase functions deploy invite-university-admin
```

```bash
npx supabase functions deploy accept-admin-invite --no-verify-jwt
```

(`accept-admin-invite` is opened by people who don't have an account yet, so it must not
require a login token; it validates the invite token itself.) Redeploy after changing anything
in `supabase/functions/`.

### 9. Set function secrets (Resend email)

1. Create a free account at <https://resend.com> → **API Keys → Create API key** (sending access).
2. Set the secrets:

```bash
npx supabase secrets set SITE_URL=https://mcottle1.github.io/lawx_clubs/
```

```bash
npx supabase secrets set RESEND_API_KEY=re_your_key_here
```

Until you verify a domain in Resend (**Domains → Add domain**, then add the DNS records it
shows), Resend only sends *to your own Resend account email*, from `onboarding@resend.dev`.
Once a domain is verified:

```bash
npx supabase secrets set EMAIL_FROM="Law Club Manager <noreply@yourdomain.com>"
```

If email isn't set up (or fails), the site-admin page still shows the invite link once so you
can send it yourself. Every attempt is recorded in the `email_log` table.

### 10. Make yourself a site administrator

Site admins have no public sign-up, and accounts created in the Supabase dashboard's "Add user"
button are rejected (they carry no role). Instead:

1. Sign up on the site **as a partner** with your own email (any city/category). If "Confirm
   email" is on, click the confirmation link.
2. Supabase → **SQL Editor**, run (with your email):

```sql
update public.profiles set role = 'site_admin'
where user_id = (select id from auth.users where email = 'you@example.com');
delete from public.partners where email = 'you@example.com';
```

3. Log out and back in → you land on **Site administration**.

### 11. (Optional) Load the full IPEDS university list

The migrations include ~55 starter institutions. For the full U.S. list:

1. Go to <https://nces.ed.gov/ipeds/datacenter/DataFiles.aspx>, pick the latest year, and
   download the **HD** ("Directory information") data file, e.g. `HD2023.zip`. Unzip it.
2. Preview, then import (service-role key from Project Settings → API — paste it only into
   your terminal):

```bash
node scripts/import-ipeds.mjs ~/Downloads/hd2023.csv --dry-run
```

```bash
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co SUPABASE_SERVICE_ROLE_KEY=your-service-role-key node scripts/import-ipeds.mjs ~/Downloads/hd2023.csv
```

It's safe to re-run; starter rows are matched by name + state rather than duplicated.

---

## How to test Phase 1 on the live site

1. Log in as your site admin → **Invite a university administrator** → pick a university,
   enter an email you can read → **Send invite**. Copy the link shown.
2. In a private window, open the link → set a password and a scheduling link/instructions →
   you land on the university-admin page.
3. Log out → **Sign up as a Club** → that university now appears in the list.
4. **Sign up as a Partner** with a logo → the partner page shows it.
5. **Forgot password** → the reset link opens "Choose a new password" (see step 7 for which
   addresses can receive it).
6. As site admin, click **Active** next to a club to deactivate it → the club now sees
   "Account deactivated".

## Local development (fully offline, needs Docker)

```bash
npx supabase start
```

It prints a local API URL and anon key: put them in `.env.local`. Then, in a second terminal:

```bash
npx supabase functions serve
```

Then:

```bash
npm run bootstrap:local
```

```bash
npm run dev
```

- Bootstrap creates `siteadmin@example.com` and `admin@byu.example` (password `password123`)
  and makes BYU participating. Local email confirmation is off.
- Emails (password reset etc.) appear in the local inbox at <http://127.0.0.1:54324>.
- `npm run test:rls` runs ~29 security checks (sign-up role rules, who can read/edit what,
  deactivation, storage folders) against the local database.
- `npx supabase db reset` wipes the local DB and re-runs all migrations (then bootstrap again).

## Day-to-day commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server at <http://localhost:5173> |
| `npm run build` | Type-check and build to `dist/` |
| `npm run lint` | ESLint |
| `npm run db:push` | Apply new migrations to the linked Supabase project |
| `npm run db:reset` | (Local only) wipe and re-run all migrations |
| `npm run bootstrap:local` | (Local only) create demo site admin + BYU admin |
| `npm run test:rls` | (Local only) Row Level Security test suite |

`/#/status` (linked in the footer) confirms the app can reach Supabase.

## Environment variables and secrets

| Name | Where | Secret? | Purpose |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | `.env.local`, GitHub Actions variable | No | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | `.env.local`, GitHub Actions variable | No | Public anon key (RLS enforces access) |
| `VITE_BASE_PATH` | Set by the deploy workflow | No | Pages sub-path (`/lawx_clubs/`) |
| `SITE_URL` | Supabase function secret | No | Base URL used in emailed links |
| `RESEND_API_KEY` | Supabase function secret | **Yes** | Sending email |
| `EMAIL_FROM` | Supabase function secret | No | Sender, once a domain is verified |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to Edge
Functions automatically. Later phases add `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` and `CRON_SECRET`.

## Security model

- The browser only ever has the anon key. **Row Level Security is on for every table.**
- Self sign-up can only create `club` or `partner` accounts. The `handle_new_user` trigger
  validates every field and rejects any other role. University-admin profiles are inserted
  only by the `accept-admin-invite` function (service role) after it validates a one-time
  invite token (only its SHA-256 hash is stored). `site_admin` is granted by hand.
- Nobody can change their own role; users can only update specific columns of their own row
  (e.g. a club can't move itself to another university).
- Clubs see only their club; university admins see only their university's clubs; partners
  can't see club budgets. Deactivated accounts lose access to everything.
- Storage: users can only write inside `logos/<their user id>/`; images only, 10 MB max.

## Changing the accent color

Edit the `--color-accent-*` values at the top of `src/index.css`.
