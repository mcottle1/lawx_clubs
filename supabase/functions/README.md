# Edge Functions

Server-side code that needs secrets. Deploy all with `npx supabase functions deploy` (or one with `npx supabase functions deploy <name>`).

| Function | Auth | Purpose |
| --- | --- | --- |
| `invite-university-admin` | Logged-in site admin | Creates a one-time invite and emails the link |
| `accept-admin-invite` | Public (`--no-verify-jwt`); checks the invite token | Preview an invite; create the admin account |
| `notify` | Logged-in user | Sends the email for an action the caller just took (pending approval, message, proposal, accept/decline, approve/deny); verifies the caller did it and de-duplicates |

`_shared/` holds CORS, Supabase clients, token hashing and the Resend email helper (which logs
every send to `email_log` and skips duplicates by `dedupe_key`).

| `run-daily-jobs` | `x-cron-secret` header (`--no-verify-jwt`) | Daily reminders, report requests, to-do upkeep; `?dry_run=1` reports without sending |

`notify` also handles `report_submitted` (results to the sponsor, receipts alert to the admin) and
`receipt_reviewed` (status email to the club).

| `ai` | Logged-in club | **Optional.** Only active when `ANTHROPIC_API_KEY` is set: `status`, `find_partners` (Claude + web search), `draft_opportunity`, `social_posts`; per-club daily limits; logs to `ai_usage` |

Secrets are set with `npx supabase secrets set NAME=value` — never committed.
