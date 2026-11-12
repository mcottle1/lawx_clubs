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
