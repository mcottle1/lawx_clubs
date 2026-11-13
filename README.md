# Law Club Manager (lawx_clubs)

Prototype site that helps university clubs manage budgets, events and sponsors, and helps
partners find clubs to sponsor. See [`SPEC.md`](SPEC.md) for the full spec and
[`ASSUMPTIONS.md`](ASSUMPTIONS.md) for decisions made along the way.

**Stack:** React + TypeScript + Vite + Tailwind CSS · Supabase (Postgres, Auth, Storage,
Edge Functions) · Resend (email) · GitHub Pages via GitHub Actions.

**Status:** Phase 4 (automation, reports, receipts) complete.

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

## Prerequisites

- **Node.js 22 or newer** and npm. Check with `node -v`. With nvm, `nvm use` picks the version
  from `.nvmrc`. (Older Node fails with "native WebSocket not found".)
- A free [Supabase](https://supabase.com) account.
- Docker Desktop, only for the optional fully local setup.

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

## Updating after a new phase

Each phase may add migrations or functions. After merging a phase into `main`:

```bash
git pull
```

```bash
npx supabase db push
```

Then deploy any new or changed Edge Functions (safe to re-run; deploys all of them):

```bash
npx supabase functions deploy
```

- **Phase 2** added one migration (events, files, member counts, to-dos, the `flyers` and
  `club-docs` buckets).
- **Phase 3** added one migration (opportunities, conversations/messages, proposals, approval
  functions) and one function, `notify`, which sends the emails that go with actions (new
  pending approval, new message, new proposal, accepted/declined, approved/denied). No new
  secrets: it uses the same `RESEND_API_KEY`, `EMAIL_FROM` and `SITE_URL`.

- **Phase 4** added one migration (reports, receipts + private `receipts` bucket, daily-job
  bookkeeping), a new function `run-daily-jobs`, a new workflow `.github/workflows/daily-jobs.yml`,
  and one new secret, `CRON_SECRET` (set it up once — see **Daily jobs** below).

## Daily jobs (Phase 4)

Once a day, GitHub Actions calls the `run-daily-jobs` Edge Function, which:

- emails "find a sponsor" / "book a room" reminders on the day each event's reminder setting says
  (the room reminder includes your university's scheduling link or instructions);
- the day after an approved event, emails the club a link to the report form and adds a
  "Submit report" to-do; if there's still no report 3 days later, sends **one** reminder;
- closes leftover "find a sponsor"/"book a room" to-dos once an event has passed;
- re-sends any "approval needed" email the browser didn't trigger.

It's safe to run more than once a day: every email is recorded in `email_log` and stamped on the
event, so nothing is sent twice.

### One-time setup

1. Make a long random secret (any password generator works), e.g.:

```bash
openssl rand -hex 32
```

2. Give it to Supabase (the function checks it):

```bash
npx supabase secrets set CRON_SECRET=paste-the-secret-here
```

3. Give the **same** value to GitHub: repo **Settings → Secrets and variables → Actions →
   Secrets** tab → **New repository secret** → name `CRON_SECRET`. (This one *is* a secret,
   unlike the two `VITE_` variables.) The workflow also uses your existing `VITE_SUPABASE_URL`
   variable.
4. Deploy the function (it needs no login token; it checks the secret instead):

```bash
npx supabase functions deploy
```

   If the test in step 5 fails with `Invalid JWT` / `Missing authorization header`, deploy it
   explicitly without login checks: `npx supabase functions deploy run-daily-jobs --no-verify-jwt`
   (same for `accept-admin-invite`).
5. Test it: GitHub → **Actions → Daily jobs → Run workflow**, tick **dry run**, run. The log ends
   with JSON like `{"ok":true,"dry_run":true,"counts":{...},"actions":[...]}` listing what it
   *would* send. Run it again without dry run to actually send. After that it runs by itself every
   day at 14:17 UTC (about 7–8 AM in Utah; GitHub sometimes starts scheduled runs a bit late).

> GitHub pauses scheduled workflows in repos with no activity for 60 days. If that happens,
> the Actions tab shows a banner with a button to re-enable it.

## How to test Phase 4 (reports and receipts)

1. **Make an event that already happened.** The form only allows future events, so either wait
   for a real one or, in the Supabase **SQL Editor**, move one of your approved test events into
   the past (replace the name):

```sql
update public.events
set starts_at = now() - interval '2 days', ends_at = now() - interval '2 days' + interval '1 hour',
    approval_status = 'approved'
where name = 'Your event name';
```

2. **Run the daily job** (Actions → Daily jobs → Run workflow). The club gets a "How did … go?"
   email and a **Submit report** to-do.
3. **Club → the event → Submit report:** attendees, amount spent, offers redeemed, notes, and one
   or more receipts (photo or PDF + amount). After saving: the budget drops by the amount spent,
   the follow-up checklist appears (with a pre-written thank-you message if the sponsor is a site
   partner), a "Follow up with …" to-do is added, and the sponsor is emailed the results.
4. **Admin → Receipts:** preview each receipt, **Approve** → **Mark reimbursed**, or **Deny**
   (note required). The club sees each status on its dashboard and gets an email.
5. **Partner dashboard:** "Results from events you sponsored" shows attendance, offers redeemed
   and the club's notes (never the amount spent), plus a "report is in" next step.

## How to test Phase 3 (partnerships)

Use three browsers (or one normal + two private windows): a **club**, a **partner** (open to
sponsorships), and that university's **admin**.

1. **Club → Partnerships → Find partners:** filter by category/state; click **Reach out** on the
   partner, optionally pick an event, send. (The mailto link is the fallback.)
2. **Club → an upcoming event → Post a sponsorship opportunity:** title, support needed, ask
   amount, description, photo. Under **Your opportunities**, **Copy share link** and open it in a
   logged-out window — the public page shows the opportunity and "Sign up as a partner".
3. **Partner dashboard:** the opportunity is in the feed (try the University / Support / date
   filters); **Recent activity** shows the club's message. Open the opportunity → fill in
   lunches, minutes to present, student offer → **Send proposal**. Reply to the club under
   **Messages**.
4. **Club dashboard:** the sidebar shows the proposal and the unread message. **Partnerships →
   Proposals → Accept.** The partner is now the event's sponsor and the event goes back to
   *pending* so the university approves both together.
5. **Admin → Approvals:** the event card says "Event + partnership"; **Review** shows the terms.
   **Deny** needs a reason; **Approve** approves both. Check **Clubs** for the overview.
6. **Partner → Proposals** shows *Approved*; the dashboard calendar lists the event.
7. Repeat with an opportunity that isn't tied to an event — it shows up for the admin as a
   separate "Partnership" card.

Each step sends an email (or, without `RESEND_API_KEY`, records a "skipped" row in
`email_log`, which you can check in the Table Editor).

## How to test Phase 2 (club dashboard)

Log in as a club (or sign up one at a participating university), then:

1. **Budget:** the dashboard shows "Budget remaining"; click **How is this calculated?** to see
   annual budget − reported spending. Change the budget or budget-year start in **Settings**.
   (Spending comes from post-event reports, which arrive in Phase 4, so it's $0 for now.)
2. **Members:** **Update member count** → enter a number, or upload a roster CSV (one member per
   row; the header row is detected). Record a few dates to see the chart.
3. **New event:** fill in the form with no sponsor and no location, upload a flyer, and submit.
   You land on the event page marked *Pending approval*. Your university's room-booking
   link/instructions appear when there's no location.
4. **Dashboard again:** the event is under **Waiting on approval** and on the calendar, and the
   to-do list has automatic "Find a sponsor…" and "Book a room…" items.
5. **Edit the event:** add a location and a sponsor → both automatic to-dos are checked off.
6. **Files:** the flyer is already under Flyers (linked to the event). Upload a constitution
   (private) and a logo; open and delete files.
7. **To-dos:** add your own, check them off, show completed.
8. On a phone, the calendar switches to a list view.

University-admin approval of events comes in Phase 3, and reminder emails in Phase 4.

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
- `npm run test:rls` runs ~130 security checks against the local database: sign-up role rules,
  who can read/edit what, deactivation, storage folders, event approval/editing rules, files,
  to-dos, member counts, budgets, opportunities, messages, proposals, approvals, reports and
  receipts.
- `npx supabase db reset` wipes the local DB and re-runs all migrations (then bootstrap again).
- To test the daily job locally, create `supabase/functions/.env` (git-ignored) containing
  `CRON_SECRET=local-test-secret`, restart `npx supabase functions serve`, then run
  `npm run test:jobs` (~20 checks: each reminder fires once, on the right day, and never twice).

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
| `npm run test:jobs` | (Local only) daily-job checks (needs `CRON_SECRET` in `supabase/functions/.env`) |

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
| `CRON_SECRET` | Supabase function secret **and** GitHub Actions secret (same value) | **Yes** | Lets the daily workflow call `run-daily-jobs` |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to Edge
Functions automatically. Phase 5 adds `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`.

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
- Clubs can't approve their own events, can't create or edit past events, and editing an
  approved event's details sends it back to pending (enforced by a database trigger).
- Partners never query club or event tables directly: they read limited-column views
  (`opportunity_cards`, `partner_events`, `conversation_list`, `proposal_details`) that never
  include budgets. Proposals, approvals and conversations are created only through database
  functions that check who is calling (e.g. only the club can accept, only that university's
  admin can approve, a deny needs a reason).
- Storage: users can only write inside `<bucket>/<their user id>/`, 10 MB max per file, with
  per-bucket type limits. `logos` and `flyers` are public; `club-docs` (constitutions, other
  documents) is private and opened through 10-minute signed links. `receipts` is private too:
  only the club and its university's admin can open a receipt.

## Changing the accent color

Edit the `--color-accent-*` values at the top of `src/index.css`.
