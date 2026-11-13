-- =============================================================================
-- Migration 0004: club core — events, event reports (read side), member
-- counts, club files, to-dos, flyers/club-docs buckets, budget summary view.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.approval_status as enum ('pending', 'approved', 'denied');
create type public.club_file_type  as enum ('flyer', 'logo', 'constitution', 'other');
create type public.todo_source     as enum ('manual', 'system');

-- ---------------------------------------------------------------------------
-- Helper: which university a club belongs to (used by admin policies).
-- ---------------------------------------------------------------------------
create or replace function public.club_university_id(p_club_id uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select university_id from public.clubs where id = p_club_id
$$;

-- True when the current user is the active admin of the club's university.
create or replace function public.is_admin_of_club(p_club_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    public.club_university_id(p_club_id) = public.current_admin_university_id(),
    false
  )
$$;

-- ---------------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------------
create table public.events (
  id                         uuid primary key default gen_random_uuid(),
  club_id                    uuid not null references public.clubs (id) on delete cascade,
  name                       text not null check (length(btrim(name)) between 1 and 200),
  starts_at                  timestamptz not null,
  ends_at                    timestamptz not null,
  -- IANA zone the club entered the times in; used for "event date" logic.
  time_zone                  text not null default 'America/Denver',
  description                text not null default '' check (length(description) <= 5000),
  location                   text check (length(location) <= 300),
  partner_id                 uuid references public.partners (id) on delete set null,
  outside_sponsor_name       text check (length(outside_sponsor_name) <= 200),
  potential_sponsor_notes    text check (length(potential_sponsor_notes) <= 2000),
  flyer_path                 text,                 -- path in the `flyers` bucket
  budget                     numeric(12, 2) not null default 0 check (budget >= 0),
  approval_status            public.approval_status not null default 'pending',
  denial_reason              text,
  reviewed_at                timestamptz,
  reviewed_by                uuid references auth.users (id) on delete set null,
  -- Reminder settings (null = no reminder). Emails are sent by the daily job (Phase 4).
  partner_reminder_days      int check (partner_reminder_days between 1 and 120),
  location_reminder_days     int check (location_reminder_days between 1 and 120),
  partner_reminder_sent_at   timestamptz,
  location_reminder_sent_at  timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint events_end_after_start check (ends_at > starts_at),
  constraint events_one_sponsor check (partner_id is null or outside_sponsor_name is null)
);

create index events_club_starts_idx on public.events (club_id, starts_at);
create index events_status_idx on public.events (approval_status);
create index events_partner_idx on public.events (partner_id) where partner_id is not null;

create trigger events_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

-- Guard rails for club edits (admins/service role are not restricted here):
--   * valid time zone, no new events in the past
--   * past events can't be edited or deleted by the club
--   * editing an approved/denied event's details sends it back to "pending"
create or replace function public.events_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  is_club boolean := public.current_user_role() = 'club';
begin
  if tg_op = 'DELETE' then
    if is_club and old.starts_at <= now() then
      raise exception 'Past events cannot be deleted';
    end if;
    return old;
  end if;

  perform now() at time zone new.time_zone;  -- raises on an unknown zone

  -- Empty strings → null so "no sponsor"/"no location" are unambiguous.
  new.location             := nullif(btrim(coalesce(new.location, '')), '');
  new.outside_sponsor_name := nullif(btrim(coalesce(new.outside_sponsor_name, '')), '');

  if tg_op = 'INSERT' then
    if is_club and new.starts_at <= now() then
      raise exception 'Events must start in the future';
    end if;
    return new;
  end if;

  -- UPDATE
  if is_club then
    if old.starts_at <= now() then
      raise exception 'Past events cannot be edited';
    end if;
    if new.starts_at <= now() then
      raise exception 'Events must start in the future';
    end if;
    if old.approval_status <> 'pending' and (
         new.name, new.starts_at, new.ends_at, new.description, new.location,
         new.partner_id, new.outside_sponsor_name, new.budget
       ) is distinct from (
         old.name, old.starts_at, old.ends_at, old.description, old.location,
         old.partner_id, old.outside_sponsor_name, old.budget
       ) then
      new.approval_status := 'pending';
      new.denial_reason   := null;
      new.reviewed_at     := null;
      new.reviewed_by     := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger events_guard
  before insert or update or delete on public.events
  for each row execute function public.events_guard();

-- ---------------------------------------------------------------------------
-- event_reports (post-event metrics). The submission flow is Phase 4; the
-- table exists now so the budget math and calendar history are final.
-- ---------------------------------------------------------------------------
create table public.event_reports (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null unique references public.events (id) on delete cascade,
  attendees        int not null check (attendees >= 0),
  amount_spent     numeric(12, 2) not null default 0 check (amount_spent >= 0),
  offers_redeemed  int check (offers_redeemed >= 0),
  notes            text check (length(notes) <= 5000),
  submitted_at     timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger event_reports_updated_at
  before update on public.event_reports
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- club_member_counts (one row per club per day; re-entering the same day
-- replaces that day's number)
-- ---------------------------------------------------------------------------
create table public.club_member_counts (
  id           uuid primary key default gen_random_uuid(),
  club_id      uuid not null references public.clubs (id) on delete cascade,
  count        int not null check (count between 0 and 100000),
  recorded_on  date not null default current_date,
  source       text not null default 'manual' check (source in ('manual', 'roster')),
  created_at   timestamptz not null default now(),
  unique (club_id, recorded_on)
);

-- ---------------------------------------------------------------------------
-- club_files
-- ---------------------------------------------------------------------------
create table public.club_files (
  id            uuid primary key default gen_random_uuid(),
  club_id       uuid not null references public.clubs (id) on delete cascade,
  file_type     public.club_file_type not null,
  bucket        text not null check (bucket in ('logos', 'flyers', 'club-docs')),
  storage_path  text not null,
  file_name     text not null check (length(file_name) <= 255),
  mime_type     text,
  size_bytes    bigint check (size_bytes between 0 and 10485760),
  event_id      uuid references public.events (id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (bucket, storage_path)
);

create index club_files_club_idx on public.club_files (club_id, file_type);

-- ---------------------------------------------------------------------------
-- todos
-- ---------------------------------------------------------------------------
create table public.todos (
  id                uuid primary key default gen_random_uuid(),
  club_id           uuid not null references public.clubs (id) on delete cascade,
  title             text not null check (length(btrim(title)) between 1 and 300),
  due_on            date,
  done              boolean not null default false,
  done_at           timestamptz,
  source            public.todo_source not null default 'manual',
  -- For system to-dos: what kind, so each event gets at most one of each.
  system_kind       text check (system_kind in ('find_sponsor', 'book_room', 'submit_report', 'follow_up')),
  related_event_id  uuid references public.events (id) on delete cascade,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index todos_club_idx on public.todos (club_id, done, due_on);
create unique index todos_system_unique on public.todos (related_event_id, system_kind)
  where system_kind is not null;

create trigger todos_updated_at
  before update on public.todos
  for each row execute function public.set_updated_at();

create or replace function public.todos_set_done_at()
returns trigger
language plpgsql
as $$
begin
  if new.done and not coalesce(old.done, false) then new.done_at := now(); end if;
  if not new.done then new.done_at := null; end if;
  return new;
end;
$$;

create trigger todos_done_at
  before insert or update on public.todos
  for each row execute function public.todos_set_done_at();

-- System to-dos follow the event: "Find a sponsor" while an upcoming event
-- has no sponsor, "Book a room" while it has no location. They're completed
-- automatically once the gap is filled. (Closing leftovers once an event has
-- passed, and report/follow-up to-dos, come with the Phase 4 daily job.)
create or replace function public.sync_event_todos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_day date := (new.starts_at at time zone new.time_zone)::date;
  upcoming boolean := new.starts_at > now();
  needs_sponsor boolean := upcoming and new.partner_id is null and new.outside_sponsor_name is null;
  needs_room boolean := upcoming and new.location is null;
begin
  perform public.upsert_system_todo(
    new.club_id, new.id, 'find_sponsor', 'Find a sponsor for ' || new.name,
    event_day - coalesce(new.partner_reminder_days, 0), needs_sponsor);
  perform public.upsert_system_todo(
    new.club_id, new.id, 'book_room', 'Book a room for ' || new.name,
    event_day - coalesce(new.location_reminder_days, 0), needs_room);
  return new;
end;
$$;

create or replace function public.upsert_system_todo(
  p_club_id uuid, p_event_id uuid, p_kind text, p_title text, p_due date, p_needed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_needed then
    insert into public.todos (club_id, title, due_on, source, system_kind, related_event_id)
    values (p_club_id, p_title, p_due, 'system', p_kind, p_event_id)
    on conflict (related_event_id, system_kind) where system_kind is not null
    do update set title = excluded.title, due_on = excluded.due_on, done = false;
  else
    update public.todos set done = true
    where related_event_id = p_event_id and system_kind = p_kind and not done;
  end if;
end;
$$;

revoke all on function public.sync_event_todos() from public, anon, authenticated;
revoke all on function public.upsert_system_todo(uuid, uuid, text, text, date, boolean) from public, anon, authenticated;

create trigger events_sync_todos
  after insert or update of name, starts_at, time_zone, location, partner_id,
    outside_sponsor_name, partner_reminder_days, location_reminder_days
  on public.events
  for each row execute function public.sync_event_todos();

-- ---------------------------------------------------------------------------
-- Budget summary: remaining = initial budget − spending reported for events
-- in the current budget year. security_invoker → normal RLS applies.
-- ---------------------------------------------------------------------------
create view public.club_budget_summary with (security_invoker = true) as
select
  c.id as club_id,
  c.initial_budget,
  c.budget_year_start,
  coalesce(sum(r.amount_spent) filter (where e.starts_at >= c.budget_year_start), 0)::numeric(12, 2) as spent,
  count(r.id) filter (where e.starts_at >= c.budget_year_start) as reported_events,
  (c.initial_budget - coalesce(sum(r.amount_spent) filter (where e.starts_at >= c.budget_year_start), 0))::numeric(12, 2) as remaining
from public.clubs c
left join public.events e on e.club_id = c.id
left join public.event_reports r on r.event_id = e.id
group by c.id;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.events             enable row level security;
alter table public.event_reports      enable row level security;
alter table public.club_member_counts enable row level security;
alter table public.club_files         enable row level security;
alter table public.todos              enable row level security;

revoke all on public.events, public.event_reports, public.club_member_counts,
              public.club_files, public.todos, public.club_budget_summary
  from anon, authenticated;

-- ---- events ---------------------------------------------------------------
-- Clubs can't set approval/review/reminder-sent columns (column grants).
grant select, delete on public.events to authenticated;
grant insert (club_id, name, starts_at, ends_at, time_zone, description, location, partner_id,
              outside_sponsor_name, potential_sponsor_notes, flyer_path, budget,
              partner_reminder_days, location_reminder_days)
  on public.events to authenticated;
grant update (name, starts_at, ends_at, time_zone, description, location, partner_id,
              outside_sponsor_name, potential_sponsor_notes, flyer_path, budget,
              partner_reminder_days, location_reminder_days)
  on public.events to authenticated;

create policy "club reads own events" on public.events for select to authenticated
  using (club_id = (select public.current_club_id()));
create policy "admin reads university events" on public.events for select to authenticated
  using ((select public.is_admin_of_club(club_id)));
create policy "site admin reads events" on public.events for select to authenticated
  using ((select public.is_site_admin()));
create policy "club creates own events" on public.events for insert to authenticated
  with check (club_id = (select public.current_club_id()));
create policy "club updates own events" on public.events for update to authenticated
  using (club_id = (select public.current_club_id()))
  with check (club_id = (select public.current_club_id()));
create policy "club deletes own events" on public.events for delete to authenticated
  using (club_id = (select public.current_club_id()));

-- ---- event_reports (read-only for now) -----------------------------------
grant select on public.event_reports to authenticated;

create policy "club reads own reports" on public.event_reports for select to authenticated
  using (exists (select 1 from public.events e
                 where e.id = event_id and e.club_id = (select public.current_club_id())));
create policy "admin reads university reports" on public.event_reports for select to authenticated
  using (exists (select 1 from public.events e
                 where e.id = event_id and public.is_admin_of_club(e.club_id)));
create policy "site admin reads reports" on public.event_reports for select to authenticated
  using ((select public.is_site_admin()));

-- ---- club_member_counts ---------------------------------------------------
grant select, delete on public.club_member_counts to authenticated;
grant insert (club_id, count, recorded_on, source) on public.club_member_counts to authenticated;
-- Upsert (same-day re-entry) sends every column; the policy still pins club_id.
grant update (club_id, count, recorded_on, source) on public.club_member_counts to authenticated;

create policy "club manages own member counts" on public.club_member_counts for all to authenticated
  using (club_id = (select public.current_club_id()))
  with check (club_id = (select public.current_club_id()) and recorded_on <= current_date + 1);
create policy "admin reads university member counts" on public.club_member_counts for select to authenticated
  using ((select public.is_admin_of_club(club_id)));
create policy "site admin reads member counts" on public.club_member_counts for select to authenticated
  using ((select public.is_site_admin()));

-- ---- club_files -----------------------------------------------------------
grant select, delete on public.club_files to authenticated;
grant insert (club_id, file_type, bucket, storage_path, file_name, mime_type, size_bytes, event_id)
  on public.club_files to authenticated;

create policy "club reads own files" on public.club_files for select to authenticated
  using (club_id = (select public.current_club_id()));
create policy "club adds own files" on public.club_files for insert to authenticated
  with check (
    club_id = (select public.current_club_id())
    -- The file must live in the uploader's own storage folder.
    and split_part(storage_path, '/', 1) = (select auth.uid())::text
    and (event_id is null or exists (select 1 from public.events e
                                     where e.id = event_id and e.club_id = club_files.club_id))
  );
create policy "club deletes own files" on public.club_files for delete to authenticated
  using (club_id = (select public.current_club_id()));
create policy "site admin reads files" on public.club_files for select to authenticated
  using ((select public.is_site_admin()));

-- ---- todos ----------------------------------------------------------------
-- Clubs create manual to-dos only (source/system_kind aren't insertable).
grant select, delete on public.todos to authenticated;
grant insert (club_id, title, due_on, done) on public.todos to authenticated;
grant update (title, due_on, done) on public.todos to authenticated;

create policy "club manages own todos" on public.todos for all to authenticated
  using (club_id = (select public.current_club_id()))
  with check (club_id = (select public.current_club_id()));

-- ---- budget view ----------------------------------------------------------
grant select on public.club_budget_summary to authenticated;

-- ---------------------------------------------------------------------------
-- Storage buckets
--   flyers    — public (shown to partners/admins), images + PDF
--   club-docs — private (constitution, other docs), read via signed URLs
-- Files live under <user_id>/… and only that user can write there.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('flyers', 'flyers', true, 10485760,
   array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']),
  ('club-docs', 'club-docs', false, 10485760,
   array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

create policy "clubs write own flyers/docs" on storage.objects for insert to authenticated
  with check (
    bucket_id in ('flyers', 'club-docs')
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.current_club_id()) is not null
  );
create policy "clubs read own flyers/docs" on storage.objects for select to authenticated
  using (bucket_id in ('flyers', 'club-docs') and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "clubs update own flyers/docs" on storage.objects for update to authenticated
  using (bucket_id in ('flyers', 'club-docs') and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id in ('flyers', 'club-docs') and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "clubs delete own flyers/docs" on storage.objects for delete to authenticated
  using (bucket_id in ('flyers', 'club-docs') and (storage.foldername(name))[1] = (select auth.uid())::text);
