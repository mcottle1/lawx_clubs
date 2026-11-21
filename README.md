# CampusBridge (repo: lawx_clubs)

CampusBridge is a prototype site that helps university clubs manage budgets, events and
sponsors, helps partners find clubs to sponsor, and lets university administrators approve
events and process reimbursements. See [`SPEC.md`](SPEC.md) for the full spec and
[`ASSUMPTIONS.md`](ASSUMPTIONS.md) for decisions made along the way.

**Stack:** React + TypeScript + Vite + Tailwind CSS · Supabase (Postgres, Auth, Storage,
Edge Functions) · Resend (email) · GitHub Pages via GitHub Actions.

**Status:** All phases (0–6) complete. Try it with the [demo data](#demo-data).

## Repository layout

```
.github/workflows/deploy.yml   Build + deploy to GitHub Pages on every push to main
src/                           React app (HashRouter, so deep links work on Pages)
  auth/                        Session/profile context, role guards
  lib/                         Supabase client, constants, types, upload helpers
  pages/                       Route components (one folder per role)
  components/                  Shared UI
  index.css                    Tailwind + brand color tokens (change the colors here)
supabase/
  config.toml                  Supabase CLI config (local dev, auth, function settings)
  migrations/                  SQL migrations — the source of truth for the schema
  functions/                   Edge Functions (server code that needs secret keys)
scripts/                       Demo data, IPEDS importer, local bootstrap, test suites
```

## Accounts and roles

| Role | How the account is created | Lands on |
| --- | --- | --- |
| Club | Public sign-up (`/#/signup/club`): choose a university, then one of its colleges. Only colleges with an active admin are listed | `/#/club` |
| Partner | Public sign-up (`/#/signup/partner`) | `/#/partner` |
| Organization admin | Runs a whole university. Site admin sends an invite → they set a password. They add the university's colleges and invite each college's admins | `/#/org-admin` |
| College admin | Approves one college's clubs (events, partnerships, posts, messages, receipts). Invited by the organization admin (or site admin); the first admin of a college also enters its room-booking info. Several per college | `/#/university-admin` |
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

- **Site URL:** `https://mcottle1.github.io/lawx_clubs/` (or your custom domain — see
  **Custom domain** below)
- **Redirect URLs:** `https://mcottle1.github.io/lawx_clubs/**` and `http://localhost:5173/**`
  (plus `https://your-domain/**` if you use one)

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
npx supabase secrets set EMAIL_FROM="CampusBridge <noreply@yourdomain.com>"
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

- **Phase 5** added one migration (two summary functions for the partner finder and ask
  formula, and an `ai_usage` log) and one function, `ai`. **Nothing to set up** unless you want
  the optional AI features — see **Optional AI** below. Without it, everything in Phase 5 works and
  costs nothing.

- **Phase 6** added no migrations or secrets. It renames the site to **CampusBridge**, adds the
  new colors, charts and the demo-data script, and lets the site run on your own domain. Two
  optional follow-ups: rename the email sender (`npx supabase secrets set EMAIL_FROM="CampusBridge
  <noreply@lawxclub.com>"`) and set up a **custom domain** (below). Redeploy functions once
  (`npx supabase functions deploy`) so emails use the new name.

- **Members & sponsorship history** added one migration (the `club_members` list, the
  `member_emails` log and a private `email-attachments` bucket) and one function,
  `email-members`. Run `npx supabase db push` and `npx supabase functions deploy` as above. No new
  secrets: club emails use the same `RESEND_API_KEY` and `EMAIL_FROM`. See **Emailing club
  members** below for the Resend limits.

- **Approval settings & send back** added two migrations (new review statuses; university
  approval settings, the review/resubmit functions and the admin's message-review view) and
  changed the `notify` and `email-members` functions. Run `npx supabase db push` and
  `npx supabase functions deploy` as above. No new secrets. **Heads-up:** the new settings default
  to *on* for clubs' first messages and opportunity posts, so after you deploy, those wait for the
  university admin until the admin turns them off (**Settings → What needs your approval**).
  Messages and posts that already exist stay live.

- **Colleges and organization admins** added two migrations and changed the `invite-university-admin`,
  `accept-admin-invite`, `notify` and `run-daily-jobs` functions. Run `npx supabase db push` and
  `npx supabase functions deploy`. The migration moves your existing data automatically (see
  **Colleges and organization admins** below), so **back up first**: Supabase → Database →
  Backups, or `npx supabase db dump --data-only > backup.sql`. Then, as site admin, **invite an
  organization admin** for each university that's using the site.

- **Admin calendar, events notice, history and reopening approvals** added one migration (two
  functions for sending back an approved event or partnership). Run `npx supabase db push`; no
  function changes. Re-run the demo data (`--reset`) to get demo flyers.

- **University colors** added one migration (three color columns on `universities` and two small
  functions). Run `npx supabase db push`; no functions or secrets changed. Test it: log in as a
  university admin → **Settings → Colors for your university**, type or pick three colors (the
  page previews them), **Save colors**, then log in as one of that university's clubs.

## Emailing club members

Clubs can email their member list (or just their leadership) from **Members → Email members**,
with attachments from Club files or their device. How it's sent:

- From your `EMAIL_FROM` address, shown as "*Club name* via CampusBridge". **The club's own email
  (the one they log in with) always gets a copy**, as the "To" address, and replies go there.
  For clubs with more than 49 recipients, the club gets one copy per batch of 49 (see below).
- Members are **BCC'd** in batches of 49, so nobody sees anyone else's address.
- **A verified Resend domain is required** (you already have `lawxclub.com`). Without it Resend
  only delivers to your own address.
- **Mind Resend's free-plan quota** (about 100 emails a day and 3,000 a month at the time of
  writing). Plan for each recipient (To + BCC) counting toward it, so a 60-member club email may
  use most of a day's quota. If clubs will email often, upgrade Resend (check
  <https://resend.com/pricing>).
- Each club can send **5 member emails per 24 hours** (test emails don't count). To change it:

```bash
npx supabase secrets set MEMBER_EMAIL_DAILY_LIMIT=10
```

- Attachments: up to 10 files and 10 MB in total. Files from the device are uploaded to a private
  bucket only for sending and deleted right after.
- Demo addresses (`@example.com`) are never emailed. The demo data's sent email is sample
  history only.

## How to test members and sponsorship history

1. Log in as a club (demo: `demo-club-moot@example.com`) → **Members** tab. The demo club has 61
   members, 6 of them with leadership roles.
2. **Add member**: give them your own email address. Then **Edit** them and type a role
   (anything, e.g. "Moot Court Coach"). They now show up under **Leadership**.
3. **Import roster**: upload a CSV with `Name` and `Email` columns (optional `Role`). The preview
   shows new members, changes, and skipped rows. Tick "Remove … who aren't in this file" to
   replace the list.
4. The dashboard's **Members** number follows the list (once you've imported a roster, or used
   "Use this list for the dashboard count"). Adding or removing members updates it.
5. **Email members** → choose **Leadership only**, write a subject and message, tick a club file,
   add a file from your computer → **Send to 7 leaders**. Your own address gets the email with
   both attachments, BCC'd. The demo addresses are skipped. The email shows under **Sent emails**.
   (With a real club account, **Send me a test** sends a copy to the club's address first.)
6. **Download roster** saves the current list as a CSV (Name, Email, Role, Joined) that you can
   edit and import again.
7. Log in as a partner (demo: `demo-partner-wasatch@example.com`) → **History** tab: every
   sponsorship the university approved, with totals, results per event, a year filter and
   **Download CSV**.

## University approvals

Each university administrator chooses what needs their approval in **Settings → What needs your
approval**:

| Setting | Default | What it does |
| --- | --- | --- |
| A club's first message to a partner | On | The partner only receives the message after the admin approves it. Replies after that flow normally. |
| Sponsorship opportunities clubs post | On | Partners only see a post (and its share link) after approval, and again after the club edits what partners see. Closing/reopening doesn't need approval. |
| Partner proposals, before the club sees them | Off | The admin screens each proposal first. If approved, the club sees it and accepts or declines as usual; accepted partnerships still come back for final approval. |

Events and final partnership agreements always need approval, as before. Changing a setting
affects new submissions; anything already waiting stays in the queue.

**Approve, send back, or deny.** Every item in the admin's **Approvals** queue (events,
partnerships, proposals to screen, opportunity posts, first messages) has three choices:

- **Approve.**
- **Send back** with a note saying what to change. The item is marked **Changes requested** (not
  denied). The club (or, for proposals, the partner) sees the note, edits the item, and resubmits
  it, or resubmits it as is. It then comes back to the queue, labelled with the earlier note.
- **Deny** with a reason (final, as before; for events, editing still resubmits).

Everyone involved gets an email at each step. Receipts keep their own approve/deny/reimburse flow.

## How to test approvals

1. Log in as the BYU admin (demo: `admin@byu.example`, or your real BYU admin) → **Settings**.
   Check the three switches; turn on **Partner proposals** and save.
2. **Approvals**: the demo data has a first message (Moot Court Society → Cougar Town Catering) and
   an opportunity post (Women in Law's Mentorship Brunch) waiting. **Send back** the brunch with a
   note, and **Approve** the message.
3. As `demo-club-wil@example.com` → **Partnerships → Your opportunities**: the brunch shows your
   note. **Edit and resubmit** it. Then **All partners → Reach out** to a partner: the button says
   **Submit for approval**, and the conversation shows that it's waiting.
4. As the admin, approve the brunch. As `demo-partner-summit@example.com`, open it from the
   dashboard and send a proposal: it says the university reviews it first.
5. As the admin, **Send back** the proposal. As Summit → **Proposals**: **Edit and resubmit**. As
   the admin, approve it. Women in Law now sees it under **Proposals**.
6. **Send back** a pending event, then as that club open the event: **Resubmit without changes**
   or **Edit and resubmit**.

## Colleges and organization admins

Universities are now run at two levels:

- An **organization admin** (one or more per university) adds the university's **colleges**
  (or schools, or departments: they choose the word), invites each college's admins, renames
  colleges and moves clubs between them. They can **see** every club and request at the
  university, but they only **decide** for a college that has no admin of its own. They also pick
  the university's colors.
- **College admins** (one or more per college) do what university admins did before: approve
  their clubs' events, partnerships, posts and first messages; review receipts; set their
  college's room-booking info and approval settings; and optionally give their clubs their own
  colors. Approval emails go to all of a college's admins, or to the organization admins if the
  college has none.
- **Clubs** choose a university and then a college when they sign up. A college appears there once
  it has an admin.
- **Partners** see where a club is: "Moot Court Society · J. Reuben Clark Law School · Brigham
  Young University".

**What the migration does to existing data.** Every university that already had an admin, clubs
or a pending invite gets one college **named after the university**; its admin becomes that
college's admin (same login), and its clubs, settings and pending invite move in. The organization
admin can rename it (e.g. to "J. Reuben Clark Law School"). The hand-added "BYU J. Reuben Clark
Law School" and "University of Utah S.J. Quinney College of Law" entries, if anyone used them,
become colleges of BYU and Utah. Nobody is an organization admin yet: invite one per university
from the site admin page. Until then, a college without an admin has nobody to approve its
clubs' requests.

**One role per login.** A person who is both an organization admin and a college admin needs two
email addresses (e.g. a personal and a shared office address).

## How to test colleges

1. As site admin → **Invite an administrator** → **Organization admin**, pick BYU, use an email
   you can read → open the link and set a password. You land on **Colleges**.
2. **Add a college** (e.g. "J. Reuben Clark Law School"), then **Invite admin** for it → open that
   link in a private window and set a password plus room-booking info → you land on that
   college's page.
3. Log out → **Sign up as a Club** → choose BYU → the **College** list shows your college (a
   college without an admin doesn't appear).
4. As the organization admin: **Approvals** shows every college's requests, with buttons only for
   colleges without an admin. **Clubs** lets you move a club to another college. **Settings** has
   the name for units and the university's colors.
5. As the college admin → **Settings**: co-admins, room booking, approval settings, and
   "Colors for your clubs" (overrides the university's colors for this college only).

Demo data has all of this ready: `demo-org-byu@example.com` (organization admin) and
`demo-admin-byu@example.com` (J. Reuben Clark Law School admin); BYU's "Marriott School of
Business" has no admin yet.

## Admin calendar, events notice and history

College admins (and organization admins, for the whole university) now have:

- **Calendar**: every club's events in one month/list calendar, labelled by club and colored by
  status. Click an event for its details.
- **Upcoming events notice** (under the calendar): pick a date range (and whether to include
  events still waiting for approval) → **Create notice**. It lists each event in date order with
  its time, location, host club, description and flyer. **Copy for email** pastes it into an email
  with the flyers as images; **Download PDF** saves it to attach.
- **History**: every event (past, upcoming or all; filter by status; search), plus decided
  partnerships. Each event opens a page with everything about it: details, flyer, the approval
  record (who decided and when, notes), partnerships and their terms, the post-event report and
  the receipts.
- **Changing an approval**: until an event starts, an approved event or partnership can be **sent
  back for changes** from its detail page (or History → Partnerships), with a note. It works like
  "Send back" on a pending request: the club (or, for a partnership, the partner) edits and
  resubmits, and it returns to Approvals. Everyone involved is emailed.

**Test it** (demo: `demo-admin-byu@example.com`): **Calendar** → set **To** a month or two out,
tick "Include events still waiting for approval" → **Create notice** → **Copy for email** and paste
into an email, then **Download PDF**. **History** → **Bar Prep Info Lunch** shows a finished event
with its report and receipts. **History → Upcoming → Moot Court Finals Night** → **Send
partnership back for changes**, then **Send back for changes**; log in as
`demo-club-moot@example.com` to see the note on the event.

## Custom domain

By default the site is at `https://mcottle1.github.io/lawx_clubs/`. To give people a cleaner link
you can share (e.g. `https://app.lawxclub.com`), point a domain you own at GitHub Pages. GitHub
then serves the site there and automatically redirects the old github.io link.

**Pick the address.** Easiest and free: a **subdomain of lawxclub.com**, which you already own
(e.g. `app.lawxclub.com` or `campusbridge.lawxclub.com`). This doesn't affect your email setup.
You could also buy a brand-new domain (e.g. a `campusbridge` name, usually about $10–15/year) —
the steps are the same.

1. **DNS** (at the company where you bought lawxclub.com → DNS settings), add one record:
   - Type **CNAME**, name **`app`** (the part before `.lawxclub.com`), value **`mcottle1.github.io`**.
   - (Using a whole domain instead of a subdomain? Add four **A** records for `@` pointing to
     `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`.)
2. **GitHub → Settings → Pages → Custom domain:** enter `app.lawxclub.com` → **Save**. Wait for
   the DNS check to turn green (minutes, occasionally up to a day), then tick **Enforce HTTPS**.
3. **GitHub → Settings → Secrets and variables → Actions → Variables:** add **`CUSTOM_DOMAIN`** =
   `app.lawxclub.com`. (This makes the build serve from `/` instead of `/lawx_clubs/`.)
4. **Actions → Deploy to GitHub Pages → Run workflow.**
5. **Supabase → Authentication → URL Configuration:** set **Site URL** to
   `https://app.lawxclub.com/` and add `https://app.lawxclub.com/**` to **Redirect URLs** (keep
   the github.io one until you've switched).
6. Make emailed links (invites, reminders) use the new address:

```bash
npx supabase secrets set SITE_URL=https://app.lawxclub.com/
```

7. Open `https://app.lawxclub.com`, log in, and send that link to anyone.

> Optional but recommended: verify the domain with GitHub (your profile **Settings → Pages → Add
> a domain**, then add the TXT record it shows) so nobody else can claim it on GitHub.
> On a free GitHub plan the repository must stay public for Pages to work.

## Demo data

`scripts/seed-demo.mjs` fills the site with realistic data so every dashboard and chart has
something to show: **Brigham Young University** and **University of Utah**, each with an
organization admin and a law school college with its own admin (BYU also has an empty business
school with no admin), **3 clubs**, **4 partners**, past events with reports and receipts, upcoming
events, opportunities, proposals in every state, conversations, member history and to-dos.

**Locally** (after `npx supabase start`): `npm run seed:demo`

**On your hosted project** (service-role key from Supabase → Project Settings → API; paste it only
in your terminal):

```bash
printf "Service role key: " && read -s SUPABASE_SERVICE_ROLE_KEY && export SUPABASE_SERVICE_ROLE_KEY && echo
```

Paste the key and press **Enter** (nothing appears while you paste; this works in the Mac's default
zsh as well as bash). When you're done, clear it with `unset SUPABASE_SERVICE_ROLE_KEY`.

```bash
SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co node scripts/seed-demo.mjs --yes
```

Re-running needs `--reset`, which deletes the demo accounts (and everything they own) and creates
them again. Real administrators and colleges are left alone; the demo colleges (found or created
by name) are reset to the default settings.

**Demo logins** — password for all: `campusbridge-demo`

| Who | Email | Good for trying |
| --- | --- | --- |
| BYU organization admin | `demo-org-byu@example.com` | Colleges, inviting a college admin, read-only approvals, moving clubs, colors |
| BYU Law college admin | `demo-admin-byu@example.com` | Approvals (an event + partnership, a first message, a post), receipts queue, clubs overview |
| Utah organization admin | `demo-org-utah@example.com` | A university with one college |
| Utah Law college admin | `demo-admin-utah@example.com` | A receipt waiting for review |
| Moot Court Society (BYU) | `demo-club-moot@example.com` | Full dashboard and charts, a proposal to accept, unread message |
| Women in Law (BYU) | `demo-club-wil@example.com` | A report that's due, a partnership waiting on the university |
| Public Interest Law Society (Utah) | `demo-club-pils@example.com` | A smaller club at another university |
| Summit Bar Review (partner) | `demo-partner-summit@example.com` | Results charts, open opportunities, a pending proposal |
| Wasatch Legal Partners (partner) | `demo-partner-wasatch@example.com` | Sponsored events calendar |
| Cougar Town Catering (partner) | `demo-partner-cougar@example.com` | A declined proposal |
| LexiCode (partner) | `demo-partner-lexicode@example.com` | A partnership waiting on approval |

Demo accounts use `@example.com` addresses; the site never actually sends email to them. Remove
the demo data any time by deleting those users in Supabase → Authentication.

### Start over with a clean database

`scripts/wipe-data.mjs` deletes **everything except site admin accounts**: all clubs, partners,
college and organization admins (and everything they own), all colleges, invites, the email log
and every uploaded file. It also resets every university (not participating, default colors). The
universities list and the database structure stay. Run it without `--yes` first to see what it
would delete; nothing changes until you add `--yes`. **This can't be undone**, so take a backup
first if anything real is in there (Supabase → Database → Backups).

With the service role key set as in the demo data steps above:

```bash
SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co node scripts/wipe-data.mjs
```

```bash
SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co node scripts/wipe-data.mjs --yes
```

```bash
SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co node scripts/seed-demo.mjs --yes
```

Locally it's `npm run wipe:data -- --yes` and then `npm run seed:demo`.

## How to test Phase 6 (branding, charts, polish)

1. Open the site: the **CampusBridge** name, bridge logo and new colors (indigo with coral and
   teal accents) appear everywhere, including the browser tab icon.
2. Load the demo data, then log in as **Moot Court Society**: the dashboard shows **Event
   attendance** (headline numbers + a bar per event; hover a bar for details, or **Show as
   table**) next to **Membership over time**.
3. Log in as **Summit Bar Review**: **Results from events you sponsored** shows events reported,
   students reached, offers redeemed, redemption rate, and a chart for each.
4. On your phone: every page fits the screen; the tab bar scrolls sideways.
5. A brand-new club sees a "Plan your first event" prompt; partners with no opportunities see a
   friendly empty state.

## Optional AI (Phase 5)

Every suggestion feature works without AI: the partner finder ranks partners with simple rules,
the opportunity form fills in a template and calculates an ask amount (showing its math), and
captions and post-event recaps come from templates filled with real numbers. When you add an
Anthropic API key, the same screens also show **"Search the web with AI"**, **"Improve with AI"**
and **"Write more with AI"** buttons. Remove the key and the buttons disappear.

**Cost:** pay-as-you-go from prepaid credit. Roughly $0.15–0.30 per AI web search and a few cents
per draft with the default model (Claude Opus 5.5); about half that with Claude Sonnet 5.5. Each
club gets 10 AI searches and 30 AI drafts per 24 hours by default.

### Turn it on

1. Go to <https://console.anthropic.com>, create an account (separate from any Claude.ai
   subscription), add a payment method and **buy a small amount of credit** (e.g. $10). Leave
   auto-reload off if you want a hard stop when it runs out.
2. In the Console's billing/limits settings, set a **monthly spend limit** (e.g. $20).
3. **API Keys → Create key.** Copy it (it's shown once) and store it in Supabase — only paste it
   into your terminal:

```bash
npx supabase secrets set ANTHROPIC_API_KEY=paste-your-key-here
```

4. Deploy the function (if you haven't since Phase 5 was merged):

```bash
npx supabase functions deploy
```

5. Log in as a club → **Partnerships → Partner finder**: the "Search the web with AI" button
   should appear.

### Options (all optional)

Pick a different model (default `claude-opus-5-5`; `claude-sonnet-5-5` costs about half):

```bash
npx supabase secrets set ANTHROPIC_MODEL=claude-sonnet-5-5
```

Change the per-club limits (requests per 24 hours):

```bash
npx supabase secrets set AI_DAILY_LIMIT_SEARCH=5 AI_DAILY_LIMIT_DRAFT=20
```

**See what AI is costing:** Supabase → Table Editor → `ai_usage` (one row per request, with
tokens, web searches and an estimated cost), or the usage page in the Anthropic Console.

**Turn it off:** `npx supabase secrets unset ANTHROPIC_API_KEY`. The app goes back to rules and
templates only.

If credit runs out, clubs see "AI credit has run out" and the non-AI suggestions keep working.

## How to test Phase 5 (suggestions and drafting)

Works with AI off. Have at least two partners that are open to sponsorships (one in your
university's city with a matching category, e.g. a bar prep company for a "Bar exam kickoff
lunch") and one upcoming event.

1. **Club → Partnerships → Partner finder:** pick the event. Partners are ranked with reasons
   ("Located in Provo, UT — same city as your university", "Bar prep — fits an event about bar,
   exam", "Sponsored your club before"). **Reach out** opens the message form with the event
   selected. Below, map/web search links look for businesses that aren't on the site yet.
2. **Event page → Post a sponsorship opportunity → Fill in from template:** the title and
   description fill in (with your perks), and a **Suggested ask** appears. Open **How we got
   this** to see the math (past cost per attendee, event budget, what sponsors gave before).
   **Use this amount** fills in the ask.
3. After posting: **Your opportunities → Social caption** shows three captions with your share
   link and Copy buttons.
4. **A reported event → Edit report & receipts:** the **Social media recap** section has three
   post ideas with your attendance and sponsor.
5. **With AI on:** the same screens show the AI buttons. "Search the web with AI" can take up to a
   minute and lists real businesses with links and a reason; the note under it shows how many AI
   uses your club has left today.

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

1. Log in as your site admin → **Invite an administrator** (organization admin for a university,
   then as that admin add a college and invite its admin; see **How to test colleges**). Copy
   the link shown.
2. In a private window, open the link → set a password (and, for a college's first admin, a
   scheduling link/instructions).
3. Log out → **Sign up as a Club** → that university and college now appear in the lists.
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
| `npm test` | Unit tests for the partner-matching rules, ask formula and templates (no database needed) |
| `npm run seed:demo` | Demo data (local; see **Demo data** for hosted) |

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
| `CUSTOM_DOMAIN` | GitHub Actions variable (optional) | No | Your domain, e.g. `app.lawxclub.com`; builds the site for the domain root |
| `ANTHROPIC_API_KEY` | Supabase function secret (optional) | **Yes** | Turns on the optional AI features |
| `ANTHROPIC_MODEL` | Supabase function secret (optional) | No | AI model, default `claude-opus-5-5` |
| `AI_DAILY_LIMIT_SEARCH` / `AI_DAILY_LIMIT_DRAFT` | Supabase function secrets (optional) | No | Per-club AI requests per 24 h (defaults 10 / 30) |
| `MEMBER_EMAIL_DAILY_LIMIT` | Supabase function secret (optional) | No | Member emails a club can send per 24 h (default 5) |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to Edge
Functions automatically.

## Security model

- The browser only ever has the anon key. **Row Level Security is on for every table.**
- Self sign-up can only create `club` or `partner` accounts. The `handle_new_user` trigger
  validates every field and rejects any other role. University-admin profiles are inserted
  only by the `accept-admin-invite` function (service role) after it validates a one-time
  invite token (only its SHA-256 hash is stored). `site_admin` is granted by hand.
- Nobody can change their own role; users can only update specific columns of their own row
  (e.g. a club can't move itself to another university).
- Clubs see only their club; college admins see only their college's clubs; organization admins
  see (read-only) their whole university and act only for colleges without an admin; partners
  can't see club budgets. Deactivated accounts lose access to everything.
- Clubs can't approve their own events, can't create or edit past events, and editing an
  approved event's details sends it back to pending (enforced by a database trigger).
- Partners never query club or event tables directly: they read limited-column views
  (`opportunity_cards`, `partner_events`, `conversation_list`, `proposal_details`) that never
  include budgets. Proposals, approvals and conversations are created only through database
  functions that check who is calling (e.g. only the club can accept, only that university's
  admin can approve, a deny needs a reason).
- Optional AI: the Anthropic key lives only in Supabase secrets; only clubs can call the `ai`
  function, with per-club daily limits; every request is logged in `ai_usage` (clubs see only
  their own rows). Web pages the AI reads are treated as information, never instructions, and
  links it returns are shown as plain external links.
- Storage: users can only write inside `<bucket>/<their user id>/`, 10 MB max per file, with
  per-bucket type limits. `logos` and `flyers` are public; `club-docs` (constitutions, other
  documents) is private and opened through 10-minute signed links. `receipts` is private too:
  only the club and its university's admin can open a receipt. `email-attachments` is private
  and emptied after each send.
- Member names and emails are visible only to their club (and site admins). Only a club can call
  `email-members`, only for its own list and its own files, with a daily limit; members are
  BCC'd so their addresses aren't shared with each other.

## Changing the colors

All brand colors are tokens at the top of `src/index.css`: `--color-accent-*` (indigo, the main
color for buttons, links and active states), `--color-pop-*` (coral, bright highlights) and
`--color-fresh-*` (teal, the second bright accent). Charts and the calendar read the same tokens,
so changing them there updates the whole site. If you change them, keep text readable (dark text
on the coral buttons, white text on indigo).

**Per-university colors.** A university's organization admin can pick three colors in
**Settings → Colors for your university**, and each college admin can override them for their own
clubs (**Settings → Colors for your clubs**). They replace these defaults only for that
university's clubs and admins; partners, other universities and logged-out visitors keep the
CampusBridge colors. The site builds the full set of shades from the three picks
(`src/lib/universityTheme.ts`) and nudges any shade that would make text hard to read, so even a
very light pick stays readable. A club sees new colors the next time it opens the site.
