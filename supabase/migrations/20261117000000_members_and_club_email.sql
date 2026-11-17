-- Club members (individual roster), leadership roles, and emailing members.
--
--   club_members      one row per member (name, email, optional free-text role)
--   member_emails     log of emails a club sent to its members (written by the
--                     email-members Edge Function with the service role)
--   email-attachments private bucket for files attached from the club's device
--
-- The dashboard member count follows the list automatically once the club has
-- chosen to use the list for its count (latest club_member_counts row has
-- source = 'members'), or when the club has no count yet.

-- ---------------------------------------------------------------------------
-- club_members
-- ---------------------------------------------------------------------------
create table public.club_members (
  id          uuid primary key default gen_random_uuid(),
  club_id     uuid not null references public.clubs (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 200),
  email       text not null check (length(email) <= 320 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  email_key   text generated always as (lower(btrim(email))) stored,
  -- Free-text leadership role (e.g. "President", "VP of Events"); null = member.
  role        text check (role is null or length(btrim(role)) between 1 and 80),
  joined_on   date not null default current_date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (club_id, email_key)
);

create index club_members_club_idx on public.club_members (club_id, name);

create trigger club_members_updated_at
  before update on public.club_members
  for each row execute function public.set_updated_at();

-- Member counts may now also come from the member list.
alter table public.club_member_counts drop constraint if exists club_member_counts_source_check;
alter table public.club_member_counts
  add constraint club_member_counts_source_check check (source in ('manual', 'roster', 'members'));

-- Keeps today's member count equal to the list size for clubs whose count
-- follows the list (or that have no count yet).
create or replace function public.sync_member_count(p_club_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_latest_source text;
  v_has_any boolean;
  v_count int;
begin
  select source into v_latest_source
    from public.club_member_counts
   where club_id = p_club_id
   order by recorded_on desc, created_at desc
   limit 1;
  v_has_any := found;
  if v_has_any and v_latest_source <> 'members' then
    return;
  end if;
  select count(*) into v_count from public.club_members where club_id = p_club_id;
  if not v_has_any and v_count = 0 then
    return;
  end if;
  insert into public.club_member_counts (club_id, count, recorded_on, source)
  values (p_club_id, v_count, current_date, 'members')
  on conflict (club_id, recorded_on) do update set count = excluded.count, source = 'members';
end;
$$;

revoke all on function public.sync_member_count(uuid) from public, anon, authenticated;

create or replace function public.club_members_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club uuid;
begin
  if tg_op = 'INSERT' then
    for v_club in select distinct club_id from new_rows loop
      perform public.sync_member_count(v_club);
    end loop;
  else
    for v_club in select distinct club_id from old_rows loop
      perform public.sync_member_count(v_club);
    end loop;
  end if;
  return null;
end;
$$;

create trigger club_members_after_insert
  after insert on public.club_members
  referencing new table as new_rows
  for each statement execute function public.club_members_after_change();

create trigger club_members_after_delete
  after delete on public.club_members
  referencing old table as old_rows
  for each statement execute function public.club_members_after_change();

-- Lets the club switch its dashboard count to follow the member list.
create or replace function public.use_member_list_for_count()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club uuid := public.current_club_id();
  v_count int;
begin
  if v_club is null then
    raise exception 'Only clubs can do this' using errcode = '42501';
  end if;
  select count(*) into v_count from public.club_members where club_id = v_club;
  insert into public.club_member_counts (club_id, count, recorded_on, source)
  values (v_club, v_count, current_date, 'members')
  on conflict (club_id, recorded_on) do update set count = excluded.count, source = 'members';
  return v_count;
end;
$$;

revoke all on function public.use_member_list_for_count() from public, anon;
grant execute on function public.use_member_list_for_count() to authenticated;

-- ---------------------------------------------------------------------------
-- member_emails (history of club emails; written by the Edge Function)
-- ---------------------------------------------------------------------------
create table public.member_emails (
  id               uuid primary key default gen_random_uuid(),
  club_id          uuid not null references public.clubs (id) on delete cascade,
  sent_by          uuid references auth.users (id) on delete set null,
  audience         text not null check (audience in ('all', 'leadership')),
  subject          text not null check (length(subject) <= 200),
  body             text not null check (length(body) <= 20000),
  recipient_count  int not null default 0,
  delivered_count  int not null default 0,
  attachment_names text[] not null default '{}',
  status           text not null check (status in ('sent', 'partial', 'failed', 'skipped')),
  error            text,
  created_at       timestamptz not null default now()
);

create index member_emails_club_idx on public.member_emails (club_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.club_members  enable row level security;
alter table public.member_emails enable row level security;

revoke all on public.club_members, public.member_emails from anon, authenticated;

-- Member names and emails are private to the club (and site admins for support).
grant select, delete on public.club_members to authenticated;
grant insert (club_id, name, email, role, joined_on) on public.club_members to authenticated;
grant update (name, email, role, joined_on) on public.club_members to authenticated;

create policy "club manages own members" on public.club_members for all to authenticated
  using (club_id = (select public.current_club_id()))
  with check (club_id = (select public.current_club_id()));
create policy "site admin reads members" on public.club_members for select to authenticated
  using ((select public.is_site_admin()));

grant select on public.member_emails to authenticated;

create policy "club reads own member emails" on public.member_emails for select to authenticated
  using (club_id = (select public.current_club_id()));
create policy "site admin reads member emails" on public.member_emails for select to authenticated
  using ((select public.is_site_admin()));

-- ---------------------------------------------------------------------------
-- email-attachments bucket (private). Files the club attaches from its device
-- are uploaded to <user_id>/... here, read by the Edge Function with the
-- service role, and removed after sending.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('email-attachments', 'email-attachments', false, 10485760,
   array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif',
         'text/plain', 'text/csv',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'application/vnd.ms-powerpoint',
         'application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do nothing;

create policy "clubs write own email attachments" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'email-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.current_club_id()) is not null
  );
create policy "clubs read own email attachments" on storage.objects for select to authenticated
  using (bucket_id = 'email-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "clubs delete own email attachments" on storage.objects for delete to authenticated
  using (bucket_id = 'email-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
