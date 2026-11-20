-- New review outcomes. Kept in their own migration: Postgres can't use an enum
-- value in the same transaction that adds it.
--
--   approval_status 'changes_requested'  sent back to the club with a note
--   proposal_status 'pending_review'     waiting for the university to screen it
--                                        before the club sees it (optional setting)
--   proposal_status 'changes_requested'  sent back to the partner with a note
alter type public.approval_status add value if not exists 'changes_requested';
alter type public.proposal_status add value if not exists 'pending_review' before 'pending_club';
alter type public.proposal_status add value if not exists 'changes_requested';
