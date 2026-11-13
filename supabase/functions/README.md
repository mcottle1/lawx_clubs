# Edge Functions

Server-side code that needs secrets. Deploy all with `npx supabase functions deploy` (or one with `npx supabase functions deploy <name>`).

| Function | Auth | Purpose |
| --- | --- | --- |
| `invite-university-admin` | Logged-in site admin | Creates a one-time invite and emails the link |
| `accept-admin-invite` | Public (`--no-verify-jwt`); checks the invite token | Preview an invite; create the admin account |
| `notify` | Logged-in user | Sends the email for an action the caller just took (pending approval, message, proposal, accept/decline, approve/deny); verifies the caller did it and de-duplicates |

`_shared/` holds CORS, Supabase clients, token hashing and the Resend email helper (which logs
every send to `email_log` and skips duplicates by `dedupe_key`).

Coming later: `run-daily-jobs` (Phase 4), AI functions (Phase 5).

Secrets are set with `npx supabase secrets set NAME=value` — never committed.
