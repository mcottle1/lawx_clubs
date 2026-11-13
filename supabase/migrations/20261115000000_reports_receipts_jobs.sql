-- =============================================================================
-- Migration 0006: post-event reports, receipts/reimbursements, daily-job
-- bookkeeping.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Daily-job bookkeeping on events (set only by the run-daily-jobs function).
-- ---------------------------------------------------------------------------
alter table public.events
  add column report_requested_at      timestamptz,
  add column report_reminder_sent_at  timestamptz;

-- ---------------------------------------------------------------------------
-- event_reports: clubs submit/edit reports for their own events once the
-- event has ended (denied events can't be reported).
-- ---------------------------------------------------------------------------
create or replace function public.can_report_event(p_event_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id
      and e.club_id = public.current_club_id()
      and e.ends_at <= now()
      and e.approval_status <> 'denied'
  )
$$;

grant insert (event_id, attendees, amount_spent, offers_redeemed, notes) on public.event_reports to authenticated;
grant update (attendees, amount_spent, offers_redeemed, notes) on public.event_reports to authenticated;

create policy "club submits reports for its ended events" on public.event_reports for insert to authenticated
  with check ((select public.can_report_event(event_id)));
create policy "club edits its reports" on public.event_reports for update to authenticated
  using ((select public.can_report_event(event_id)))
  with check ((select public.can_report_event(event_id)));

-- When a report comes in: tick off "Submit report for X" and add a
-- "Follow up with <sponsor>" to-do if the event had a sponsor.
create or replace function public.event_reports_after_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  e record;
  sponsor text;
begin
  select ev.*, pa.name as partner_name into e
    from public.events ev left join public.partners pa on pa.id = ev.partner_id
    where ev.id = new.event_id;
  update public.todos set done = true
    where related_event_id = new.event_id and system_kind = 'submit_report' and not done;
  sponsor := coalesce(e.partner_name, e.outside_sponsor_name);
  if sponsor is not null then
    insert into public.todos (club_id, title, due_on, source, system_kind, related_event_id)
    values (e.club_id, 'Follow up with ' || sponsor || ' after ' || e.name, current_date + 7, 'system', 'follow_up', e.id)
    on conflict (related_event_id, system_kind) where system_kind is not null do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.event_reports_after_insert() from public, anon, authenticated;

create trigger event_reports_after_insert
  after insert on public.event_reports
  for each row execute function public.event_reports_after_insert();

-- ---------------------------------------------------------------------------
-- receipts
-- ---------------------------------------------------------------------------
create type public.receipt_status as enum ('pending', 'approved', 'reimbursed', 'denied');

create table public.receipts (
  id               uuid primary key default gen_random_uuid(),
  club_id          uuid not null references public.clubs (id) on delete cascade,
  event_id         uuid not null references public.events (id) on delete cascade,
  event_report_id  uuid not null references public.event_reports (id) on delete cascade,
  storage_path     text not null unique,     -- in the private `receipts` bucket
  file_name        text not null check (length(file_name) <= 255),
  mime_type        text,
  size_bytes       bigint check (size_bytes between 0 and 10485760),
  amount           numeric(12, 2) not null check (amount >= 0),
  description      text check (length(description) <= 500),
  status           public.receipt_status not null default 'pending',
  admin_note       text check (length(admin_note) <= 1000),
  reviewed_at      timestamptz,
  reviewed_by      uuid references auth.users (id) on delete set null,
  reimbursed_at    timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index receipts_club_idx on public.receipts (club_id, status);
create index receipts_status_idx on public.receipts (status, created_at);

create trigger receipts_updated_at
  before update on public.receipts
  for each row execute function public.set_updated_at();

alter table public.receipts enable row level security;
revoke all on public.receipts from anon, authenticated;

grant select on public.receipts to authenticated;
grant insert (club_id, event_id, event_report_id, storage_path, file_name, mime_type, size_bytes, amount, description)
  on public.receipts to authenticated;
grant delete on public.receipts to authenticated;

create policy "club reads own receipts" on public.receipts for select to authenticated
  using (club_id = (select public.current_club_id()));
create policy "club adds receipts to its reports" on public.receipts for insert to authenticated
  with check (
    club_id = (select public.current_club_id())
    and split_part(storage_path, '/', 1) = (select auth.uid())::text
    and exists (select 1 from public.event_reports r join public.events e on e.id = r.event_id
                where r.id = event_report_id and r.event_id = receipts.event_id and e.club_id = receipts.club_id)
  );
create policy "club removes pending receipts" on public.receipts for delete to authenticated
  using (club_id = (select public.current_club_id()) and status = 'pending');
create policy "admin reads university receipts" on public.receipts for select to authenticated
  using ((select public.is_admin_of_club(club_id)));
create policy "site admin reads receipts" on public.receipts for select to authenticated
  using ((select public.is_site_admin()));

-- Admin moves a receipt along: pending → approved → reimbursed, or → denied (note required).
create or replace function public.review_receipt(p_receipt_id uuid, p_status public.receipt_status, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.receipts%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into r from public.receipts where id = p_receipt_id for update;
  if r.id is null or not public.is_admin_of_club(r.club_id) then raise exception 'Receipt not found'; end if;
  if not (
       (r.status = 'pending'  and p_status in ('approved', 'denied'))
    or (r.status = 'approved' and p_status in ('reimbursed', 'denied'))
  ) then
    raise exception 'Cannot change a % receipt to %', r.status, p_status;
  end if;
  if p_status = 'denied' and v_note is null then raise exception 'A note is required to deny'; end if;

  update public.receipts set
    status = p_status,
    admin_note = coalesce(v_note, admin_note),
    reviewed_at = now(), reviewed_by = auth.uid(),
    reimbursed_at = case when p_status = 'reimbursed' then now() else reimbursed_at end
  where id = r.id;
end;
$$;

revoke all on function public.review_receipt(uuid, public.receipt_status, text) from public, anon;
grant execute on function public.review_receipt(uuid, public.receipt_status, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Private `receipts` bucket: the club writes under its own folder; the club
-- and its university's admin can read.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('receipts', 'receipts', false, 10485760,
   array['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;

create policy "clubs upload receipts to own folder" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.current_club_id()) is not null
  );
create policy "clubs read own receipt files" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "clubs delete own receipt files" on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "admins read their university's receipt files" on storage.objects for select to authenticated
  using (
    bucket_id = 'receipts'
    and exists (select 1 from public.receipts r where r.storage_path = name and public.is_admin_of_club(r.club_id))
  );

-- ---------------------------------------------------------------------------
-- Results for partners: reports of events they sponsored (no spending).
-- ---------------------------------------------------------------------------
create view public.partner_event_results as
select
  e.id as event_id, e.name as event_name, e.starts_at, e.time_zone,
  c.name as club_name, u.name as university_name,
  r.attendees, r.offers_redeemed, r.notes, r.submitted_at
from public.event_reports r
join public.events e on e.id = r.event_id
join public.clubs c on c.id = e.club_id
join public.universities u on u.id = c.university_id
where e.partner_id = public.current_partner_id()
  and e.approval_status = 'approved';

revoke all on public.partner_event_results from anon, authenticated;
grant select on public.partner_event_results to authenticated;
