-- =============================================================================
-- Migration 0002: account tables (clubs, partners, university admins),
-- admin invites, email log, logos bucket.
--
-- Sign-up flow: the browser calls supabase.auth.signUp() with the profile
-- fields in user metadata. The handle_new_user trigger validates them and
-- creates the profiles row plus the clubs/partners row in the same
-- transaction, so it works whether or not email confirmation is enabled.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.partner_category as enum (
  'law_firm',
  'bar_prep',            -- bar prep / test prep
  'restaurant_catering',
  'legal_tech',
  'nonprofit',
  'other'
);

-- ---------------------------------------------------------------------------
-- clubs
-- ---------------------------------------------------------------------------
create table public.clubs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null unique references auth.users (id) on delete cascade,
  university_id     uuid not null references public.universities (id),
  name              text not null check (length(btrim(name)) between 1 and 200),
  email             text not null,               -- = login email
  description       text not null default '' check (length(description) <= 2000),
  initial_budget    numeric(12, 2) not null default 0 check (initial_budget >= 0),
  budget_year_start date not null default current_date,
  logo_path         text,                        -- path in the `logos` bucket
  social_links      jsonb not null default '{}'::jsonb,  -- e.g. {"instagram": "...", "tiktok": "..."}
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index clubs_university_idx on public.clubs (university_id);

create trigger clubs_updated_at
  before update on public.clubs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- partners
-- ---------------------------------------------------------------------------
create table public.partners (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null unique references auth.users (id) on delete cascade,
  name                  text not null check (length(btrim(name)) between 1 and 200),
  email                 text not null,           -- = login email
  city                  text not null,
  state                 text not null check (state ~ '^[A-Z]{2}$'),
  category              public.partner_category not null default 'other',
  description           text not null default '' check (length(description) <= 2000),
  offer_description     text not null default '' check (length(offer_description) <= 2000),
  open_to_sponsorships  boolean not null default true,
  logo_path             text,
  website               text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index partners_open_idx on public.partners (open_to_sponsorships) where open_to_sponsorships;

create trigger partners_updated_at
  before update on public.partners
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- university_admins (one per university)
-- ---------------------------------------------------------------------------
create table public.university_admins (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null unique references auth.users (id) on delete cascade,
  university_id            uuid not null unique references public.universities (id),
  contact_email            text not null,
  scheduling_url           text,
  scheduling_instructions  text check (length(scheduling_instructions) <= 5000),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create trigger university_admins_updated_at
  before update on public.university_admins
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- admin_invites
-- Only a SHA-256 hash of the token is stored; the raw token exists only in
-- the emailed link (and in the response shown once to the site admin).
-- ---------------------------------------------------------------------------
create table public.admin_invites (
  id             uuid primary key default gen_random_uuid(),
  university_id  uuid not null references public.universities (id),
  email          text not null,
  token_hash     text not null unique,
  created_by     uuid references auth.users (id) on delete set null,
  expires_at     timestamptz not null default now() + interval '7 days',
  used_at        timestamptz,
  revoked_at     timestamptz,
  created_at     timestamptz not null default now()
);

create index admin_invites_university_idx on public.admin_invites (university_id);

-- ---------------------------------------------------------------------------
-- email_log: every email the system sends (or skips). dedupe_key makes
-- scheduled jobs idempotent (Phase 4).
-- ---------------------------------------------------------------------------
create table public.email_log (
  id           uuid primary key default gen_random_uuid(),
  to_email     text not null,
  template     text not null,
  dedupe_key   text unique,
  related_id   uuid,
  status       text not null check (status in ('sent', 'skipped', 'failed')),
  provider_id  text,
  error        text,
  sent_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS helper functions
-- ---------------------------------------------------------------------------
create or replace function public.is_active_user()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and is_active)
$$;

create or replace function public.current_club_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select c.id from public.clubs c
  join public.profiles p on p.user_id = c.user_id and p.is_active
  where c.user_id = auth.uid()
$$;

create or replace function public.current_club_university_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select c.university_id from public.clubs c
  join public.profiles p on p.user_id = c.user_id and p.is_active
  where c.user_id = auth.uid()
$$;

create or replace function public.current_partner_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select pa.id from public.partners pa
  join public.profiles p on p.user_id = pa.user_id and p.is_active
  where pa.user_id = auth.uid()
$$;

create or replace function public.current_admin_university_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select ua.university_id from public.university_admins ua
  join public.profiles p on p.user_id = ua.user_id and p.is_active
  where ua.user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Sign-up trigger (replaces the Phase 0 version).
--
-- SECURITY: user metadata is fully client-controlled, so:
--   * only 'club' / 'partner' profiles are created from it;
--   * 'invited_admin' creates NO profile (a user without a profile has no
--     access at all). The accept-admin-invite Edge Function, running with the
--     service role, then inserts the university_admin profile itself. A
--     stranger sending 'invited_admin' just gets a useless account.
--   * every field is validated here — a bad value aborts the sign-up.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta     jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  req_role text  := meta ->> 'role';
  v_uni    uuid;
  v_budget numeric;
begin
  if req_role = 'invited_admin' then
    null;  -- profile + university_admins row are created by the Edge Function

  elsif req_role = 'club' then
    begin
      v_uni    := (meta ->> 'university_id')::uuid;
      v_budget := coalesce(nullif(meta ->> 'initial_budget', ''), '0')::numeric;
    exception when others then
      raise exception 'Invalid club sign-up data';
    end;

    if v_uni is null or not exists (
      select 1 from public.universities where id = v_uni and is_participating
    ) then
      raise exception 'Club university must be a participating university';
    end if;
    if v_budget < 0 then
      raise exception 'Initial budget cannot be negative';
    end if;

    insert into public.profiles (user_id, role) values (new.id, 'club');
    insert into public.clubs (user_id, university_id, name, email, description, initial_budget)
    values (
      new.id,
      v_uni,
      btrim(meta ->> 'club_name'),
      new.email,
      coalesce(meta ->> 'description', ''),
      v_budget
    );

  elsif req_role = 'partner' then
    insert into public.profiles (user_id, role) values (new.id, 'partner');
    begin
      insert into public.partners (
        user_id, name, email, city, state, category, description,
        offer_description, open_to_sponsorships, website
      ) values (
        new.id,
        btrim(meta ->> 'partner_name'),
        new.email,
        btrim(meta ->> 'city'),
        upper(btrim(meta ->> 'state')),
        coalesce(nullif(meta ->> 'category', ''), 'other')::public.partner_category,
        coalesce(meta ->> 'description', ''),
        coalesce(meta ->> 'offer_description', ''),
        coalesce((meta ->> 'open_to_sponsorships')::boolean, true),
        nullif(btrim(coalesce(meta ->> 'website', '')), '')
      );
    exception when invalid_text_representation then
      raise exception 'Invalid partner sign-up data';
    end;

  else
    raise exception 'Invalid or missing role for new user';
  end if;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.clubs             enable row level security;
alter table public.partners          enable row level security;
alter table public.university_admins enable row level security;
alter table public.admin_invites     enable row level security;
alter table public.email_log         enable row level security;

-- Default: the API roles get nothing on these tables except what is granted below.
revoke all on public.clubs, public.partners, public.university_admins,
              public.admin_invites, public.email_log
  from anon, authenticated;

-- ---- clubs ----------------------------------------------------------------
grant select on public.clubs to authenticated;
grant update (name, description, initial_budget, budget_year_start, logo_path, social_links)
  on public.clubs to authenticated;

create policy "club reads own club"
  on public.clubs for select to authenticated
  using (id = (select public.current_club_id()));

create policy "university admin reads own university's clubs"
  on public.clubs for select to authenticated
  using (university_id = (select public.current_admin_university_id()));

create policy "site admin reads all clubs"
  on public.clubs for select to authenticated
  using ((select public.is_site_admin()));

create policy "club updates own club"
  on public.clubs for update to authenticated
  using (id = (select public.current_club_id()))
  with check (id = (select public.current_club_id()));

-- ---- partners -------------------------------------------------------------
-- Partner profiles are a directory for signed-in users (clubs browse them).
grant select on public.partners to authenticated;
grant update (name, city, state, category, description, offer_description,
              open_to_sponsorships, logo_path, website)
  on public.partners to authenticated;

create policy "signed-in users read partners"
  on public.partners for select to authenticated
  using ((select public.is_active_user()));

create policy "partner updates own profile"
  on public.partners for update to authenticated
  using (id = (select public.current_partner_id()))
  with check (id = (select public.current_partner_id()));

-- ---- university_admins ----------------------------------------------------
grant select on public.university_admins to authenticated;
grant update (contact_email, scheduling_url, scheduling_instructions)
  on public.university_admins to authenticated;

create policy "admin reads own row"
  on public.university_admins for select to authenticated
  using (university_id = (select public.current_admin_university_id()));

-- Clubs need their university's scheduling link/instructions for reminders.
create policy "clubs read their university's admin"
  on public.university_admins for select to authenticated
  using (university_id = (select public.current_club_university_id()));

create policy "site admin reads all university admins"
  on public.university_admins for select to authenticated
  using ((select public.is_site_admin()));

create policy "admin updates own row"
  on public.university_admins for update to authenticated
  using (university_id = (select public.current_admin_university_id()))
  with check (university_id = (select public.current_admin_university_id()));

-- ---- admin_invites / email_log: site admins read; writes via Edge Functions
grant select on public.admin_invites, public.email_log to authenticated;

create policy "site admin reads invites"
  on public.admin_invites for select to authenticated
  using ((select public.is_site_admin()));

create policy "site admin reads email log"
  on public.email_log for select to authenticated
  using ((select public.is_site_admin()));

-- ---------------------------------------------------------------------------
-- Storage: public `logos` bucket. Each user may only write inside a folder
-- named after their own user id: logos/<user_id>/<file>.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy "users upload logos to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_active_user())
  );

create policy "users update own logos"
  on storage.objects for update to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'logos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "users delete own logos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Needed for upsert/overwrite (public URLs work without it).
create policy "users read own logo objects"
  on storage.objects for select to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = (select auth.uid())::text);
