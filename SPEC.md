# Build Prompt: Law Club Manager (working name)

## Context

We want to build a prototype website that helps university clubs (starting with BYU Law student organizations, but built to support many universities) manage their operations, find partners/sponsors, plan events, and report on how events went. Partners and sponsors (law firms, bar prep companies, local businesses) use the site to find clubs to sponsor and to see the results of their sponsorships. A university administrator approves events and partnerships and processes reimbursements.

This is a **prototype**. Keep hosting costs at or near $0, favor simple and well-documented tools over clever ones, and make it easy for one person to maintain. I studied CS but haven't set up a database or GitHub Actions in a while, so **explain any setup step I have to do by hand** (creating accounts, adding secrets, running migrations) in a README as you go.

---

## Tech stack (use this unless you see a strong reason not to, and tell me if you do)

- **Frontend:** React + TypeScript + Vite, Tailwind CSS for styling. React Router (use `HashRouter`, or the `404.html` redirect trick, so deep links work on GitHub Pages).
- **Hosting:** GitHub Pages, deployed automatically by a **GitHub Actions** workflow on every push to `main`.
- **Backend/database:** **Supabase** (free tier) for:
  - Postgres database (schema managed as SQL migration files in `/supabase/migrations`)
  - Authentication (email + password)
  - Storage (logos, flyers, constitutions, receipts, photos)
  - Edge Functions for anything that needs a secret key (AI calls, sending email, admin invites)
  - **Row Level Security (RLS) on every table.** The frontend only ever uses the public anon key, so RLS is the real security layer. Never put a service-role key or API key in frontend code.
- **Email:** Resend (free tier), called from Supabase Edge Functions.
- **Scheduled jobs:** a GitHub Actions workflow on a daily cron schedule that calls a Supabase Edge Function (`run-daily-jobs`) with a shared secret. That function sends reminders and post-event report requests.
- **AI:** Anthropic Claude API, called only from an Edge Function. Put the model name in an environment variable so I can change it. Turn on Claude's web search tool for the "find local partners" feature so that it suggests real businesses instead of invented ones.
- **UI libraries:** FullCalendar (React) for the interactive calendar; Recharts for graphs.

---

## User types

There are four account types. Each user has exactly one role.

1. **University Clubs:** club name, the club's home university (selected from the list of universities that participate in the site's service), club email (also the login username), account password, initial annual budget, and a short club description.

2. **Partners/Sponsors:** sponsor name, sponsor email, location of operation (city/state), account password, uploaded logo/photo, a short description of purpose/organization, and a business category (drop-down, e.g., law firm, bar prep/test prep, restaurant/catering, legal tech, nonprofit, other). Partners also have a "currently open to sponsorships" toggle and a short "what we're willing to offer" description (e.g., "we sponsor lunches for 20–60 students in exchange for 10 minutes to present").

3. **Club Administrator (university admin):** one per participating university. Fields: university name (drop-down of U.S. universities and colleges, including law schools, medical schools, and other graduate schools, and community colleges) and contact email. Site administrators create these accounts after verifying the person's identity and purpose, and the system emails the university administrator an invite link. When they open the link, the administrator sets an account password and adds either a link to their space-scheduling system or written instructions for how clubs schedule spaces. A university becomes "participating" (and shows up in the club sign-up drop-down) once its administrator activates their account.

4. **Site Administrator (us):** an internal role, with no public sign-up. Can create university-admin invites, see all universities/clubs/partners, and deactivate accounts. A simple admin page is enough.

**University list:** seed the `universities` table from the U.S. Department of Education's IPEDS institution directory (name, city, state, institution type). Add a script in `/scripts` that imports a downloaded CSV. For early development, a seed file with about 50 institutions (including BYU, BYU Law, University of Utah, Utah Valley, Salt Lake Community College) is fine.

---

## Landing page and authentication

- Public landing page with a short explanation of the site and **Log in**, **Sign up as a Club**, and **Sign up as a Partner** buttons.
- Users can log in and out with their email and password. "Forgot password" works.
- After login, route each user to the dashboard for their role.

---

## Club user flow

We want the club to be able to:

1. **Log in** to their account with a username (club email) and password.

2. **Reach a club dashboard/landing page** that shows:
   1. Remaining club budget (initial annual budget minus reported event spending; show the math on hover or click)
   2. Running total of club members. Clubs update this manually or by uploading a roster CSV, and each update is saved with a date so we can graph it over time.
   3. Access to uploaded club files, including:
      1. Past club flyers (event flyers are also filed here automatically)
      2. Club logo
      3. Club constitution
      4. Other club documents
   4. Interactive calendar with upcoming and past events
   5. A list of upcoming club to-do items. Clubs can add their own, and the system adds some automatically (e.g., "Find a sponsor for [event]," "Book a room for [event]," "Submit report for [event]," "Follow up with [partner]").
   6. Graphs of event attendance metrics and club membership metrics
   7. A sidebar with pending approvals (events or partnerships waiting on the university admin) and pending partner proposals

3. **Access from the dashboard to a "Partnership/Sponsor Opportunities" page** that shows:
   1. A list of active partners (partners with "open to sponsorships" turned on), with:
      1. Logo/photo for the partner
      2. A short description of the partner's focus/opportunity willingness
      3. A button to reach out to the partner (sends an on-site message and an email notification to the partner; also show a `mailto:` fallback)
      4. Filters by category and location
   2. An AI chat space where the club can:
      1. Input an event they are trying to plan and get back a list of local businesses or firms that might be willing to partner/sponsor if the club reached out
      2. Use background club information automatically (club description, university location, past events, past partners, budget) so the club doesn't have to start from zero each time
      3. See partners already on the platform first, then outside businesses found through web search, with a one-line reason why each might be a fit and a link to their website
   3. A **"Create a sponsorship opportunity"** tool (from the solution sketch). The club describes what they want to offer partners (optionally tied to an event), uploads a photo, and the AI drafts:
      - a description of the opportunity, which the club can edit before posting
      - a suggested amount to ask for, based on the event budget, the club's remaining budget, and amounts from past partnerships

      Posted opportunities appear on the partner dashboard. The club can also copy a share link and an AI-suggested social media caption to post on Instagram/TikTok.
   4. A list of the club's own posted opportunities and incoming partner proposals, with Accept/Decline buttons

4. **Access to a page that is used for creating events**
   1. Club can input:
      1. Event name
      2. Event date
      3. Event time (start and end)
      4. Event description
      5. List of potential sponsor opportunities (free text, or link to a posted opportunity)
      6. Event partner/sponsor (choose from platform partners or enter an outside name)
         1. If there is no partner, the club can set a reminder: an email to the club email, sent a chosen number of days before the event, with a link to the partnership opportunities page.
      7. Event location
         1. If there is no event location, the club can set a reminder: an email to the club email, sent a chosen number of days before the event, with a link to the university's scheduling software or its scheduling instructions (provided by the administrator).
      8. Event flyer or photo (uploaded)
      9. Event budget
   2. Events integrate with the interactive calendar.
      1. When club users click on an event in the calendar, they can see the information above about that event, and can edit it if the event hasn't happened yet.
   3. Submitting an event sends it to the university administrator for approval (status: pending → approved/denied). If an event includes a sponsor, the partnership is approved along with it.

5. **A post-event reporting service**
   1. After a scheduled event has happened, the service will:
      1. Send an email to the club email with a link to a page used for reporting event metrics, including:
         1. Number of attendees
         2. Amount spent on the event
            1. This amount is then deducted from the budget
         3. Offers redeemed, if the partner made an offer (e.g., bar prep discount sign-ups). Optional.
         4. Any other notes about how the event went
         5. Receipts for the event
            1. Receipts become a task for the club administrator, who processes them and reimburses the club if necessary.
      2. Report info also integrates with the interactive calendar, so clubs can look back on past events and review the notes and approximate cost when planning in future years.
      3. If the report isn't submitted, send one reminder 3 days later and keep a to-do item on the dashboard until it's done.
   2. After the report is submitted, show the club:
      - Social media recommendations (AI-drafted post ideas recapping the event)
      - A partner follow-up checklist (e.g., send a thank-you note, share the attendance numbers, ask about future events)

---

## Partner user flow

1. **Sign up and log in.** The partner fills out their profile, uploads a logo, picks a category, and sets "open to sponsorships" and "what we're willing to offer."
2. **Partner dashboard** shows:
   - A paginated list of open sponsorship opportunities posted by clubs, with photo, club name, university, event date, and amount/support being sought. Filter by university, date, and category.
   - Last activity (recent messages, proposals, and approvals)
   - Success metrics from events they sponsored: attendance and offers redeemed, shown as graphs over time
   - Next-step suggestions (e.g., "3 new opportunities at schools you've sponsored before," "Event X report is in — see results")
   - An interactive calendar of upcoming events they're sponsoring
3. **Respond to an opportunity or to a club's outreach.** The partner selects an opportunity and fills out what they're willing to provide, for example:
   - Number of lunches / headcount covered
   - Dollar amount or in-kind support
   - Offer for students (e.g., a discount code)
   - Time requested to present or pitch (minutes)
   - Message to the club

   They can do this on the site, or from the email notification, which links straight to the response form. The proposal goes to the club to accept, then to the university admin for approval.
4. **Post-event results.** When a sponsored event's report is submitted, the partner gets an email and a dashboard view with attendance, offers redeemed, and the club's notes. The email also links to other upcoming opportunities. Bundles (sponsoring several events or clubs at once) are a later idea; leave room for them in the data model but don't build them yet.

---

## University administrator flow

1. Opens the invite link, sets a password, and enters scheduling link/instructions (editable later).
2. **Pending approvals dashboard:** cards for each pending event and partnership at their university, with Review / Approve / Deny buttons (Deny requires a short reason). Each new pending item also triggers an email to the admin with a link to that item.
3. **Receipts/reimbursement queue:** a list of submitted receipts with club, event, amount, and image/PDF preview. Statuses: pending → approved → reimbursed, or denied (with a note). The club sees status updates on its dashboard.
4. **Clubs overview:** a read-only list of the clubs at their university with budget remaining, events this year, and member count.
5. An admin can only ever see data for their own university (enforce with RLS).

---

## Data model (starting point; adjust as needed and explain changes)

- `universities` (name, city, state, type, ipeds_id, is_participating)
- `profiles` (user_id, role)
- `clubs` (user_id, university_id, name, email, description, initial_budget, budget_year_start, logo_path, social links)
- `club_member_counts` (club_id, count, recorded_on)
- `partners` (user_id, name, email, city, state, category, description, offer_description, open_to_sponsorships, logo_path, website)
- `university_admins` (user_id, university_id, contact_email, scheduling_url, scheduling_instructions)
- `admin_invites` (university_id, email, token, expires_at, used_at)
- `club_files` (club_id, file_type: flyer | logo | constitution | other, storage_path, event_id nullable)
- `events` (club_id, name, starts_at, ends_at, description, location, partner_id nullable, outside_sponsor_name, potential_sponsor_notes, flyer_path, budget, approval_status, partner_reminder_days, location_reminder_days, reminder_sent flags)
- `opportunities` (club_id, event_id nullable, title, description, photo_path, amount_sought, status)
- `proposals` (opportunity_id or event_id, partner_id, lunches, amount, offer, pitch_minutes, message, status)
- `messages` (proposal_id or thread, sender_user_id, body)
- `event_reports` (event_id, attendees, amount_spent, offers_redeemed, notes)
- `receipts` (event_report_id, storage_path, amount, status, admin_note)
- `todos` (club_id, title, due_on, done, source: manual | system, related_event_id)
- `email_log` (to, template, related ids, sent_at), so scheduled jobs never send duplicates

Storage buckets: `logos` (public), `flyers` (public), `club-docs` (private), and `receipts` (private; visible only to the owning club and that university's admin).

---

## Scheduled jobs and emails (daily `run-daily-jobs` function)

- Partner-needed reminders and location-needed reminders, based on each event's reminder settings
- Post-event report request (the day after the event ends) and one follow-up reminder
- System to-do creation (missing sponsor, missing location, missing report)
- Email templates: university-admin invite, new pending approval (to admin), approval/denial (to club), new proposal (to club), proposal accepted (to partner), report available (to partner), receipt status change (to club)

Make the jobs **idempotent**: check `email_log` so running the job twice never sends the same email twice. Keep emails plain and short, each with one clear link.

---

## Non-functional requirements

- Responsive design; club officers will often use this on their phones.
- Accessible forms (labels, keyboard navigation, sufficient contrast).
- Clean, professional look; neutral colors with one accent color I can change in one place.
- Validate file uploads (type and size limits, e.g., 10 MB).
- Seed script with demo data: 2 universities, 3 clubs, 4 partners, 1 admin per university, and past and future events with reports, so every dashboard and graph has something to show.
- Demo login credentials listed in the README.

---

## Out of scope for the prototype

Payments, in-app reimbursement payouts (the admin just marks them "reimbursed"), student/member accounts, native mobile apps, sponsorship bundles, and direct social media posting (we only generate captions and share links).

---

## How to work

Build in phases. **After each phase, stop and give me:** what you built, anything I need to do by hand (with exact steps), and how to test it. Don't start the next phase until I confirm.

1. **Phase 0 — Setup:** repo structure, Vite/React/TS/Tailwind, Supabase project config, first migration, GitHub Actions deploy to Pages, README with setup steps and environment variables.
2. **Phase 1 — Auth and roles:** sign-up flows for clubs and partners, login/logout, role-based routing, university seed, site-admin page, university-admin invite flow.
3. **Phase 2 — Club core:** dashboard, files, member counts, event creation, calendar, to-dos.
4. **Phase 3 — Partnerships:** partner profiles and dashboard, opportunities directory, posting opportunities, proposals and messaging, admin approvals.
5. **Phase 4 — Automation:** daily job, reminder emails, post-event report flow, receipts queue.
6. **Phase 5 — AI:** partner-finder chat, opportunity description and ask-amount drafting, social media and follow-up suggestions.
7. **Phase 6 — Metrics and polish:** club and partner graphs, seed data, empty states, mobile pass.

Where this spec is ambiguous, make a reasonable assumption, note it in `ASSUMPTIONS.md`, and keep going rather than stopping to ask, unless the decision would be hard to undo (e.g., schema decisions that affect security).
