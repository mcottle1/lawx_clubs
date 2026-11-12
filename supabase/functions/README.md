# Edge Functions

Server-side code that needs secrets (Resend, Anthropic, service role). Added in later phases:

- `invite-university-admin` (Phase 1)
- `run-daily-jobs` (Phase 4)
- AI functions (Phase 5)

Secrets are set with `npx supabase secrets set NAME=value` — never committed.
