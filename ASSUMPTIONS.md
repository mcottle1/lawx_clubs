# Assumptions & decisions

Running log of judgment calls made where the spec was ambiguous.

## Phase 0

- **Single-package layout.** The Vite app lives at the repo root (not `/web`) — simplest for
  GitHub Pages and one-person maintenance. Supabase config/migrations live in `/supabase`.
- **Tailwind v4** via the official Vite plugin. Theme tokens (incl. the one accent color) are
  defined with `@theme` in `src/index.css` instead of a `tailwind.config.js`.
- **HashRouter** (URLs like `/#/status`) rather than the `404.html` trick — no extra files and
  email links work reliably.
- **Deploy config uses repository *variables*, not secrets,** for the Supabase URL and anon key
  because both are public by design and end up in the JS bundle anyway.
- **Supabase CLI as an npm dev dependency** (`npx supabase`) so no global install is needed.
- **First migration scope:** only the foundation every later table depends on — `user_role`
  and `institution_type` enums, `universities`, `profiles`, the sign-up trigger, and RLS helper
  functions (`current_user_role()`, `is_site_admin()`). Remaining tables are added in the phase
  that uses them so each migration can be reviewed alongside its feature.
- **Role assignment is server-controlled.** The sign-up trigger accepts only `club`/`partner`
  from user metadata; `university_admin` must come from `app_metadata` (only settable with the
  service role); anything else aborts sign-up. Profiles have **no self-update policy**, and the
  API can only update `profiles.is_active` (site admins only).
- **`profiles.is_active`** added (not in the spec's data model) to support "site admins can
  deactivate accounts". Inactive users' `current_user_role()` returns null, so role-based
  policies stop matching for them.
- **`universities.type`** is an enum: university, law_school, medical_school, graduate_school,
  community_college, other. The IPEDS importer (Phase 1) will map IPEDS codes onto these.
- **`/status` page** is a developer check that the app can reach Supabase; it will stay unlinked
  (or be removed) once real dashboards exist.

## Phase 1

- **Sign-up data travels in auth user metadata and the database trigger creates the
  club/partner row.** This works whether or not "Confirm email" is on (with confirmation on,
  the browser has no session yet and couldn't insert rows itself). The trigger re-validates
  everything (role, participating university, budget ≥ 0, category, 2-letter state), so a
  hand-crafted request can't bypass the form.
- **University-admin accounts:** the Phase 0 plan (trigger reads `app_metadata.role`) didn't
  work — Supabase writes `app_metadata` *after* the user row is inserted, so the trigger never
  saw it. Instead the invite function creates the user with `role: 'invited_admin'`, for which
  the trigger creates **no profile**, then inserts the `university_admin` profile itself with
  the service role. A stranger who signs up with `invited_admin` gets an account with no
  profile and therefore no access. (Migration 0001 is unchanged; 0002 replaces the function.)
- **Custom invite tokens instead of Supabase's built-in `inviteUserByEmail`,** so invites go
  through Resend with our own wording, can be revoked/re-sent, expire after 7 days, and the
  site admin can copy the link when email isn't configured. Only the token's SHA-256 hash is
  stored. Sending a new invite for a university revokes its older pending ones. A university
  that already has an admin can't be re-invited (deactivate/replace flow is a later concern).
- **Admin activation requires a scheduling link *or* instructions** (spec says "either"); both
  are allowed and editable later on the university-admin page.
- **A university becomes participating when its admin activates** and stays participating
  even if that admin is later deactivated.
- **Deactivation** (`profiles.is_active = false`) doesn't block login itself (Supabase Auth
  has no simple flag for that); instead every RLS helper ignores inactive users, so they see
  no data, and the UI shows an "Account deactivated" notice.
- **Partner directory visibility:** any active signed-in user can read partner profiles
  (clubs browse them in Phase 3). Club rows (which include budgets) are visible only to the
  club, its university's admin, and site admins. Phase 3 will expose the club info partners
  need (name, university) through opportunities rather than the `clubs` table.
- **Partner logo at sign-up:** uploaded immediately if the sign-up returns a session;
  otherwise (email confirmation on) the partner page prompts for it after first login.
  Logo upload is optional at sign-up so a slow upload can't block account creation.
- **Logos bucket** is public (logos are shown to other users), accepts PNG/JPEG/WebP/GIF up to
  10 MB. SVG is excluded because it can carry scripts.
- **`budget_year_start`** defaults to the sign-up date; the club dashboard (Phase 2) will let
  clubs reset it each academic year.
- **Auth redirects with HashRouter:** Supabase email links return as
  `<site>/#access_token=…&type=recovery`. `main.tsx` lets supabase-js consume the tokens before
  the router starts, then rewrites the hash to `#/reset-password` or `#/dashboard`. The
  implicit flow is used (not PKCE) so links work when opened on a different device.
- **University seed is a migration** (not `seed.sql`) so `db push` loads it in production.
  It has no IPEDS ids; the importer links rows by name + state. Law/medical schools that IPEDS
  folds into their parent university (BYU Law, Utah Law) are manual rows. IPEDS type mapping:
  law-school names → law_school; graduate-only (INSTCAT 1) → medical_school if the name says
  medical/medicine/osteopathic, else graduate_school; ICLEVEL 1 → university; ICLEVEL 2 →
  community_college; otherwise other. Inactive and non-degree-granting institutions are skipped.
- **`email_log` was created now** (spec lists it for Phase 4) because the invite email uses it.
  Rows have a unique `dedupe_key` so scheduled jobs can be idempotent later.
- **Minimum password length is 8** (Supabase's default is 6) in all forms; consider setting it
  to 8 in Supabase → Authentication → Policies too.

## Phase 2

- **Budget math:** remaining = annual budget − `amount_spent` from event reports for events
  that start on or after `budget_year_start`. It's computed by the `club_budget_summary` view
  (with `security_invoker`, so normal RLS applies). Overspending shows as a negative number in
  red. Clubs change the budget and the budget-year start in Settings.
- **`event_reports` was created now (read-only)** so the budget math and calendar history are
  final; submitting reports (and receipts) is Phase 4.
- **Events are single-day** (date + start time + end time), stored as `timestamptz` plus the
  browser's IANA time zone so "event date" logic (to-do due dates, Phase 4 jobs) uses the
  club's local date.
- **Event rules enforced in the database** (`events_guard` trigger), not just the form: no new
  events in the past; past events can't be edited or deleted; clubs can't set approval columns
  (column grants). Editing the name, time, description, location, sponsor or budget of an
  approved/denied event sends it back to *pending*; changing only the flyer, reminder settings or
  sponsor notes doesn't. Denied events are resubmitted by editing them.
- **Choosing a platform partner on an event records them as the sponsor directly** (assumes the
  club already arranged it). The proposal/acceptance flow, partners seeing events they sponsor,
  and admin approval of events + partnerships are Phase 3. Event sponsor = a platform partner
  *or* an outside name, never both (DB constraint).
- **"Potential sponsor opportunities" is free text for now;** linking to a posted opportunity
  comes with opportunities in Phase 3.
- **Reminder settings are stored now; the emails are sent by the Phase 4 daily job.** Default
  14 days, allowed 1–120. Reminders only apply while the sponsor/location is still missing.
- **System to-dos are created by a database trigger** (not the daily job) so they appear the
  moment an event is saved: "Find a sponsor for X" and "Book a room for X" for upcoming events
  missing those, due on the event date minus the reminder days (or the event date). They're
  checked off automatically once the gap is filled. Report, follow-up, and closing leftovers after
  an event passes are Phase 4. Clubs can't create system to-dos; the UI only lets them check
  them off (delete is offered for manual to-dos only).
- **Member counts: one value per club per day;** re-entering the same date replaces it. Roster
  CSVs are counted in the browser (one member per non-empty row, header auto-detected with an
  override checkbox) and are not stored. A simple membership chart is included now; attendance
  graphs and chart polish are Phase 6.
- **Files:** flyers → public `flyers` bucket, logo → public `logos` bucket (the newest logo is the
  club's logo), constitution/other → private `club-docs` bucket opened with 10-minute signed
  URLs. Event flyers are recorded in `club_files` linked to the event; replacing a flyer keeps the
  old one under Files ("past flyers"). Deleting a file clears it from the club logo / an
  upcoming event that used it. Allowed types: images (+PDF for flyers; +PDF, Word, text, CSV for
  documents), 10 MB max, enforced by both the form and the bucket.
- **University admins can already read** their clubs' events, member counts and reports (needed
  for Phase 3 approvals and the clubs overview). Private club documents are club-only.
- **Social links** (Instagram, TikTok, website) are edited in club Settings and stored in
  `clubs.social_links`.
- **Calendar:** month grid on desktop, list view on phones; colored by approval status, past
  events gray (with attendance once reported). Events are keyboard-focusable.
- **Club pages are lazy-loaded** so the calendar/chart libraries don't slow down the landing and
  login pages.

## Phase 3

- **Proposal lifecycle:** `pending_club` → (club) `declined` | `pending_admin` → (university
  admin) `approved` | `denied`; the partner can `withdraw` until it's final. Only one open
  proposal per partner per opportunity (or per conversation when there's no opportunity).
- **Accepting a proposal tied to an event makes that partner the event's sponsor** and, because
  the sponsor changed, sends an approved event back to *pending*. The admin then sees one
  "Event + partnership" card and the decision applies to both ("approved along with it").
  Denying it takes the partner back off the event and reopens the opportunity. Proposals not
  tied to an event (or whose event is already decided) show as separate "Partnership" cards.
- **One sponsor per event** (unchanged from Phase 2). Accepting a proposal for an event that
  already lists a sponsor is blocked with a message telling the club to remove it first.
  Multiple sponsors per event / bundles are future work; `proposals.bundle_id` is reserved.
- **Opportunity statuses:** `open` → `filled` automatically when a proposal is accepted (back to
  `open` if that partnership is denied or withdrawn); clubs can close/reopen manually.
- **"Category" filter on the partner dashboard = the kind of support a club is asking for**
  (food, funding, in-kind, speaker, other), stored as `opportunities.support_type`. The spec
  didn't say what "category" meant for opportunities; partners already have a business category.
- **Partners see clubs only through limited views** (`opportunity_cards`, `partner_events`,
  `conversation_list`, `proposal_details`) — club name, logo, university, event name/date/
  location/description — never budgets. These views are owner-privileged with explicit
  `where` filters (Supabase may flag them as "security definer views"; that's intentional).
- **Public share link** (`#/o/<id>`) works without logging in via `get_public_opportunity()`,
  which returns a fixed set of non-sensitive fields and only for *open* opportunities. Partners
  who open it while logged in go straight to the response form.
- **Messaging:** one conversation per outreach (club → partner, optionally about an event) or per
  partner question/proposal on an opportunity. Status changes (accepted, approved, denied,
  withdrawn) are posted into the conversation as system lines. No realtime: an open thread
  refreshes every 15 seconds; unread = new messages since that side last opened the thread.
- **Partners can start conversations only about an open opportunity** (to avoid partners
  cold-messaging clubs); clubs can message any partner in the directory. Replies are open to
  both sides.
- **Emails for actions are sent by the `notify` Edge Function**, which the browser calls right
  after the action succeeds. It re-checks that the caller performed the action and uses
  `email_log` dedupe keys, so it can't be used to spam. Message emails are limited to one per
  thread per recipient per day. If a call is missed (e.g. the browser closes), the in-app state
  is still correct; the Phase 4 daily job can be extended to sweep missed notifications.
  Withdrawals don't send email (they appear in the conversation).
- **Event approval emails:** the admin is emailed when an event is created, when an approved/
  denied event is edited back to pending, and when a club accepts a proposal (event card or
  partnership card). The club (and partner, for partnerships) is emailed the decision.
- **Partner dashboard:** "next steps" are computed in the browser (new opportunities at schools
  they've sponsored before, unread messages, proposals waiting, profile gaps). Success-metric
  graphs need post-event reports (Phase 4) and are drawn in Phase 6; a placeholder explains this.
- **University admin "events this year"** on the Clubs overview = non-denied events since each
  club's budget-year start.
- **University admin area** now has tabs: Approvals (default), Clubs, Settings (the Phase 1
  scheduling form). Pending events whose date already passed are still reviewable and flagged.
- **Opportunity photos** go in the public `flyers` bucket under the club's folder but are not
  listed under Club files (they're marketing images, not flyers).

## Phase 4

- **Daily job = one Edge Function (`run-daily-jobs`) called by a GitHub Actions cron**, as the
  spec asked. It's authenticated by a shared `CRON_SECRET` header (compared in constant time)
  instead of a Supabase login token, and supports `?dry_run=1`. Runs at 14:17 UTC daily
  (≈7–8 AM Mountain); the odd minute avoids GitHub's top-of-the-hour congestion.
- **Idempotency:** every email has an `email_log.dedupe_key`, and the event row records
  `partner_reminder_sent_at`, `location_reminder_sent_at`, `report_requested_at`,
  `report_reminder_sent_at`. Those stamps are set even when email isn't configured (status
  "skipped"), so a missing API key never causes daily repeats.
- **"Today" is computed in each event's own time zone.** A reminder for "N days before" fires the
  first daily run on or after (event date − N); a missed day (e.g. GitHub skipped a run) catches up
  the next day rather than being lost. The report request goes out the first run after the event's
  local date has ended; the reminder goes ≥3 days (minus an hour of slack for schedule drift)
  after the request. Only **approved** events get report requests; events older than 60 days are
  ignored so turning the job on late doesn't email about ancient events.
- **Reports:** clubs can submit (and later correct) a report only for their own events that have
  ended and weren't denied (RLS). Amount spent is required (can be $0); offers redeemed is
  optional. The budget updates automatically through the Phase 2 budget view.
- **To-dos:** the job adds "Submit report for X" (due 3 days later); submitting the report checks
  it off (database trigger) and adds "Follow up with <sponsor> after X" (due in a week) when the
  event had a sponsor. The job also closes leftover sponsor/room to-dos for past events.
- **Partner follow-up checklist** is guidance plus one action: a pre-written thank-you (attendance,
  offers redeemed, notes, "can we work together again?") sent as an on-site message for site
  partners, or copied to the clipboard for outside sponsors. The checklist items themselves aren't
  stored; the "Follow up" to-do tracks completion. AI social-media recaps are Phase 5.
- **Sponsors are emailed the results automatically** when the report is first submitted (once —
  later edits don't re-email). They see attendance, offers redeemed and the club's notes, never
  the amount spent (`partner_event_results` view).
- **Receipts** are attached to a report (one or many; photo or PDF, 10 MB, with an amount and
  optional "what for"). They live in the private `receipts` bucket; only the club and its
  university's admin can open them. Clubs can remove a receipt only while it's pending.
- **Receipt statuses:** pending → approved → reimbursed, or pending/approved → denied (note
  required); enforced by `review_receipt()`. Receipt totals are informational: the amount that
  counts against the budget is the report's "amount spent".
- **Admin emails for receipts:** one "Receipts to review" email per report submission (and again
  if more receipts are added). Clubs get an email on every receipt status change.
- **Approval catch-up:** if the browser never called `notify` for a pending event (closed tab,
  network error), the daily job sends the admin's "approval needed" email for events that have been
  pending more than an hour with no such email logged.

## Phase 5

- **Scope change (agreed 2026-11-13, recorded in SPEC.md → Revisions):** every suggestion feature
  works without AI using rules and templates, at $0. AI is an optional upgrade that appears only
  when `ANTHROPIC_API_KEY` is set. With no key, AI buttons are hidden (the `ai` function reports
  `enabled: false`) and nothing calls Anthropic.
- **Partner finder rules** (all visible to the club as plain-English reasons): +30 same state as
  the university, +20 same city, +30 business category fits the event (keyword lists for lunch/
  food → catering, bar/exam → bar prep, firm/career/panel → law firm, tech/AI → legal tech,
  service/pro bono → nonprofit), +25 sponsored this club before, +15 sponsored at this
  university, up to +15 for words shared between the event and the partner's offer. Only partners
  open to sponsorships are shown; with an event/keywords selected, zero-score partners are hidden.
  The weights live in `src/lib/suggest/partnerMatch.ts` and are easy to tune.
- **Cross-club numbers come from aggregate-only database functions:** `partner_match_stats()`
  (per-partner sponsorship counts at your university / with your club) and
  `proposal_amount_stats()` (median approved amount for a kind of support, at your university,
  falling back to the whole site). Neither reveals other clubs' rows.
- **Outside businesses without AI = search links** (Google Maps and web search pre-filled with the
  business type and the university's city). OpenStreetMap lookups were considered and skipped
  for now (patchy data, usage-policy limits); they could be added later.
- **Ask-amount formula:** expected attendees × cost per attendee (median of the club's past
  reports; defaults $12 food, $10 funding, $5 in-kind, $8 other); use the event budget if higher;
  blend with what sponsors actually gave for that support type (50% weight with 3+ examples, 25%
  with 1–2); round to $25 (minimum $50). Speaker requests suggest $0 (ask for lunch/travel
  instead). Every step is shown under "How we got this". Expected attendees default to the
  club's average past attendance, else its latest member count, else 30.
- **Templates:** opportunity title/description built from the club, event, headcount, support
  type and chosen perks (present N minutes, logo on flyer, social shout-out, table, member email,
  thank-you); three share captions with hashtags and the public link; three post-event recap
  ideas using attendance, sponsor and offers redeemed. Clubs edit everything before using it.
- **Optional AI design:** one Edge Function (`ai`) with `find_partners` (Claude + web search,
  max 5 searches, located near the university, excludes partners already on the site, returns
  name/website/city/category/reason through a strict tool call; results without a valid http(s)
  website are dropped), `draft_opportunity` (rewrites title/description and proposes an ask with
  a reason, given the formula's answer), and `social_posts` (opportunity captions or recaps).
  Each sends the club's context automatically (description, university, budget, last year of
  events with attendance/spending/notes/sponsors).
- **AI model and settings:** default `claude-opus-5-5` (changeable with `ANTHROPIC_MODEL`),
  effort `medium` for web search and `low` for drafting, with the server-side refusal fallback
  turned on for models that support it. If the AI declines a request, the club sees a message and
  the template result stays.
- **AI limits and logging:** per club, 10 searches and 30 drafts per rolling 24 hours (secrets
  `AI_DAILY_LIMIT_SEARCH` / `AI_DAILY_LIMIT_DRAFT`); requests rejected before reaching the AI don't
  count. Every request is logged in `ai_usage` with tokens, web searches and an estimated cost
  (prices in the function: Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50 per million
  tokens, web search $10 per 1,000).
- **Safety:** web content and club-entered text are passed as information with an instruction to
  ignore any instructions inside them; AI output is shown as plain text and external links open
  with `rel="noreferrer nofollow"`. AI answers are labeled "AI" with a reminder to check them.
- **Testing:** the AI code path was tested end to end against a local mock of the Anthropic API
  (paused web search → resumed → results, daily limits, cost logging, drafts, captions, error
  handling) — not against the real API, since no key was available. The first real run should
  be watched (see README → Optional AI).

## Phase 6

- **Name and brand:** "CampusBridge" everywhere (header, page title, landing page, emails, docs).
  Logo = a simple bridge mark (SVG, also the favicon). Font: Plus Jakarta Sans from Google Fonts
  (falls back to the system font if it can't load).
- **Colors:** indigo primary (`accent`, #4a3ae0) for buttons, links and active states; two bright
  accents — coral (`pop`, #f0612e/#ff7a4d) for the main calls to action, the active-tab underline
  and hero highlights, and teal (`fresh`, #0d9488) for positive numbers and the second chart
  series. Status colors (pending amber, approved green, denied red) are unchanged and never reused
  as brand colors. Every text/background pair used was checked for WCAG AA contrast (e.g. dark
  ink on coral buttons 6:1, white on indigo 7:1), and the three brand colors pass a
  colorblind-safety check as chart colors.
- **One place for colors:** the tokens at the top of `src/index.css`; charts and the calendar read
  them at runtime (`src/lib/theme.ts`) instead of hard-coding hex values.
- **Custom domain:** GitHub Pages stays the host. The deploy workflow builds for the domain root
  when the repository variable `CUSTOM_DOMAIN` is set, otherwise for `/<repo>/` as before, so
  nothing changes until it's set up. Recommended address: a subdomain of the already-owned
  lawxclub.com (one CNAME record, free). Supabase's Site URL/redirects and the `SITE_URL` secret
  must be updated by hand (README → Custom domain).
- **Charts:** club dashboard — "Event attendance" (headline numbers: students reached, average per
  event, cost per attendee; bars per reported event, last 12) next to "Membership over time".
  Partner dashboard — "Results from events you sponsored" (events reported, students reached,
  offers redeemed, redemption rate) with **two separate** bar charts (attendance; offers
  redeemed) rather than one chart with two y-axes. Each chart has a hover tooltip, a text
  summary for screen readers and a "Show as table" view. Redemption rate = offers redeemed ÷
  attendance at events where offers were reported.
- **Demo data** is a script (`scripts/seed-demo.mjs`), not `seed.sql`, so the same data can be
  loaded locally or into the hosted project (explicit `--yes`), re-created with `--reset`, and
  removed by deleting the demo users. It uses BYU and the University of Utah; if a university
  already has a real administrator, that admin is kept. Demo accounts use `@example.com`
  addresses, and the email helper now skips reserved domains (example.com, .test, …) so demos
  never send real email. Logos and receipt images are generated as plain colored PNGs.
- **Empty states:** a new club sees a "Plan your first event" prompt; partners with no open
  opportunities see guidance (and a "Clear filters" button when filters hide everything);
  existing empty messages elsewhere were kept.
- **Mobile pass:** all 31 routes were checked at iPhone SE width (no sideways scrolling, no
  errors). Tab bars scroll sideways on phones with a fade at the edge as a hint. The club
  dashboard keeps the order numbers → approvals/to-dos → calendar → charts on phones.
