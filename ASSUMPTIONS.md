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
