-- =============================================================================
-- Migration 0001: roles, profiles, universities
--
-- Foundation for every later table:
--   * user_role enum + profiles table (one role per auth user)
--   * universities table (seeded from IPEDS in Phase 1)
--   * helper functions used by RLS policies in later migrations
--   * RLS on every table created here
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('club', 'partner', 'university_admin', 'site_admin');

create type public.institution_type as enum (
  'university',          -- 4-year college / university
  'law_school',
  'medical_school',
  'graduate_school',     -- other stand-alone graduate/professional schools
  'community_college',
  'other'
);

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at current
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- universities
-- ---------------------------------------------------------------------------
create table public.universities (
  id               uuid primary key default gen_random_uuid(),
  ipeds_id         text unique,                 -- IPEDS UNITID; null for manual entries
  name             text not null,
  city             text,
  state            text,                        -- 2-letter USPS code
  type             public.institution_type not null default 'university',
  is_participating boolean not null default false,  -- true once its admin activates
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index universities_name_idx on public.universities (name);
create index universities_participating_idx on public.universities (is_participating) where is_participating;

create trigger universities_updated_at
  before update on public.universities
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- profiles: exactly one row (and one role) per auth user
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  role        public.user_role not null,
  is_active   boolean not null default true,    -- site admins can deactivate accounts
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Auto-create a profile on sign-up.
--
-- SECURITY: the browser can put anything in user metadata, so only the two
-- self-service roles ('club', 'partner') are accepted from it. Any other value
-- (including 'site_admin') is rejected and the sign-up fails.
--   * university_admin profiles are created by the invite Edge Function
--     (service role), which passes app_metadata.role — app_metadata cannot be
--     set by the client.
--   * site_admin is granted by hand in SQL (see README).
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  app_role  text := new.raw_app_meta_data ->> 'role';
  user_role text := new.raw_user_meta_data ->> 'role';
  chosen    public.user_role;
begin
  if app_role = 'university_admin' then
    chosen := 'university_admin';
  elsif user_role in ('club', 'partner') then
    chosen := user_role::public.user_role;
  else
    raise exception 'Invalid or missing role for new user';
  end if;

  insert into public.profiles (user_id, role) values (new.id, chosen);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS helper functions (SECURITY DEFINER so policies can call them without
-- recursive RLS checks on profiles). Later migrations build on these.
-- ---------------------------------------------------------------------------
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles
  where user_id = auth.uid() and is_active
$$;

create or replace function public.is_site_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_user_role() = 'site_admin', false)
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.universities enable row level security;
alter table public.profiles     enable row level security;

-- universities: public directory. Anyone (even logged out) can read it, since
-- the club sign-up form needs the participating list. Only site admins write;
-- the admin-activation Edge Function uses the service role (bypasses RLS).
create policy "universities are readable by everyone"
  on public.universities for select
  to anon, authenticated
  using (true);

create policy "site admins manage universities"
  on public.universities for all
  to authenticated
  using ((select public.is_site_admin()))
  with check ((select public.is_site_admin()));

-- profiles: users read their own row; site admins read/update all.
-- No one can change their own role (no self-update policy exists).
create policy "users read own profile"
  on public.profiles for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "site admins read all profiles"
  on public.profiles for select
  to authenticated
  using ((select public.is_site_admin()));

create policy "site admins update profiles"
  on public.profiles for update
  to authenticated
  using ((select public.is_site_admin()))
  with check ((select public.is_site_admin()));

-- Column-level guard: even site admins edit only is_active through the API.
revoke update on public.profiles from authenticated;
grant update (is_active) on public.profiles to authenticated;
