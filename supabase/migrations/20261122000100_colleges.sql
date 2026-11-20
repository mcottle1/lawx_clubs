-- Colleges (departments) inside universities, with two levels of administrators.
--
--   universities         the organization (a university). unit_label = what it
--                        calls its units: 'College' | 'School' | 'Department'
--   departments          its colleges/schools/departments; clubs belong to one
--   department_settings  per-college settings: room booking info, what needs
--                        approval, optional color override (private)
--   department_admins    college admins (role 'university_admin'), several per
--                        college, one college per account
--   org_admins           organization admins (role 'org_admin'), one university
--                        per account
--
-- Who can do what:
--   * is_admin_of_club(club)   ACTS as the club's admin (approve, review
--     receipts...): the club's college admins, or the organization admin when
--     that college has no active admin ("steps in").
--   * org_oversees_club(club)  READ-ONLY view of every club at the university
--     for its organization admins.
--
-- Existing data: each university that had an admin, clubs or a pending invite
-- gets one college (named after the university; the organization admin can
-- rename it) and its admin, settings, clubs and invites move into it. The
-- hand-added law-school rows for BYU and Utah become colleges of their
-- universities. The old university_admins table is then removed.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
alter table public.universities
  add column unit_label text not null default 'College' check (unit_label in ('College', 'School', 'Department'));

create table public.departments (
  id               uuid primary key default gen_random_uuid(),
  university_id    uuid not null references public.universities (id) on delete cascade,
  name             text not null check (length(btrim(name)) between 1 and 200),
  -- true while it has at least one active admin; only participating
  -- colleges are offered when a club signs up
  is_participating boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index departments_name_key on public.departments (university_id, lower(btrim(name)));
create trigger departments_updated_at before update on public.departments
  for each row execute function public.set_updated_at();

create table public.department_settings (
  department_id                uuid primary key references public.departments (id) on delete cascade,
  scheduling_url               text check (scheduling_url is null or scheduling_url ~* '^https?://\S+$'),
  scheduling_instructions      text check (length(scheduling_instructions) <= 5000),
  require_message_approval     boolean not null default true,
  require_opportunity_approval boolean not null default true,
  require_proposal_approval    boolean not null default false,
  theme_primary                text check (theme_primary ~ '^#[0-9a-f]{6}$'),
  theme_pop                    text check (theme_pop ~ '^#[0-9a-f]{6}$'),
  theme_fresh                  text check (theme_fresh ~ '^#[0-9a-f]{6}$'),
  updated_at                   timestamptz not null default now(),
  constraint department_theme_complete check (
    (theme_primary is null) = (theme_pop is null) and (theme_pop is null) = (theme_fresh is null)
  )
);
create trigger department_settings_updated_at before update on public.department_settings
  for each row execute function public.set_updated_at();

-- Every college gets a settings row.
create or replace function public.departments_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.department_settings (department_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.departments_after_insert() from public, anon, authenticated;
create trigger departments_after_insert after insert on public.departments
  for each row execute function public.departments_after_insert();

create table public.department_admins (
  id             uuid primary key default gen_random_uuid(),
  department_id  uuid not null references public.departments (id) on delete restrict,
  user_id        uuid not null unique references auth.users (id) on delete cascade,
  email          text not null,
  created_at     timestamptz not null default now()
);
create index department_admins_department_idx on public.department_admins (department_id);

create table public.org_admins (
  id             uuid primary key default gen_random_uuid(),
  university_id  uuid not null references public.universities (id) on delete cascade,
  user_id        uuid not null unique references auth.users (id) on delete cascade,
  email          text not null,
  created_at     timestamptz not null default now()
);
create index org_admins_university_idx on public.org_admins (university_id);

alter table public.clubs add column department_id uuid references public.departments (id) on delete restrict;
create index clubs_department_idx on public.clubs (department_id);

alter table public.admin_invites
  add column kind text not null default 'department' check (kind in ('org', 'department')),
  add column department_id uuid references public.departments (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Move existing data into colleges
-- ---------------------------------------------------------------------------
do $$
declare
  m record;
  u record;
  v_dept uuid;
begin
  -- 1. Hand-added law-school rows become colleges of their universities.
  for m in
    select child.id as child_id, parent.id as parent_id, x.dept_name
    from (values
      ('BYU J. Reuben Clark Law School', 'Brigham Young University', 'J. Reuben Clark Law School'),
      ('University of Utah S.J. Quinney College of Law', 'University of Utah', 'S.J. Quinney College of Law')
    ) as x(child_name, parent_name, dept_name)
    join public.universities child on child.name = x.child_name and child.ipeds_id is null
    join public.universities parent on parent.name = x.parent_name
    where exists (select 1 from public.clubs where university_id = child.id)
       or exists (select 1 from public.university_admins where university_id = child.id)
       or exists (select 1 from public.admin_invites where university_id = child.id and used_at is null and revoked_at is null)
  loop
    insert into public.departments (university_id, name) values (m.parent_id, m.dept_name) returning id into v_dept;
    update public.clubs set university_id = m.parent_id, department_id = v_dept where university_id = m.child_id;
    insert into public.department_admins (department_id, user_id, email)
      select v_dept, ua.user_id, coalesce(au.email, ua.contact_email)
      from public.university_admins ua left join auth.users au on au.id = ua.user_id
      where ua.university_id = m.child_id;
    update public.department_settings ds set
      scheduling_url = ua.scheduling_url, scheduling_instructions = ua.scheduling_instructions,
      require_message_approval = ua.require_message_approval,
      require_opportunity_approval = ua.require_opportunity_approval,
      require_proposal_approval = ua.require_proposal_approval
    from public.university_admins ua where ua.university_id = m.child_id and ds.department_id = v_dept;
    update public.admin_invites set university_id = m.parent_id, department_id = v_dept, kind = 'department'
      where university_id = m.child_id and used_at is null and revoked_at is null;
    update public.universities set is_participating = false where id = m.child_id;
    delete from public.university_admins where university_id = m.child_id;
  end loop;

  -- 2. Every other university with an admin, clubs or a pending invite gets one
  --    college named after itself.
  for u in
    select un.id, un.name from public.universities un
    where exists (select 1 from public.clubs where university_id = un.id and department_id is null)
       or exists (select 1 from public.university_admins where university_id = un.id)
       or exists (select 1 from public.admin_invites where university_id = un.id and department_id is null
                  and used_at is null and revoked_at is null)
  loop
    select id into v_dept from public.departments where university_id = u.id and lower(btrim(name)) = lower(btrim(u.name));
    if v_dept is null then
      insert into public.departments (university_id, name) values (u.id, u.name) returning id into v_dept;
    end if;
    update public.clubs set department_id = v_dept where university_id = u.id and department_id is null;
    insert into public.department_admins (department_id, user_id, email)
      select v_dept, ua.user_id, coalesce(au.email, ua.contact_email)
      from public.university_admins ua left join auth.users au on au.id = ua.user_id
      where ua.university_id = u.id
      on conflict (user_id) do nothing;
    update public.department_settings ds set
      scheduling_url = ua.scheduling_url, scheduling_instructions = ua.scheduling_instructions,
      require_message_approval = ua.require_message_approval,
      require_opportunity_approval = ua.require_opportunity_approval,
      require_proposal_approval = ua.require_proposal_approval
    from public.university_admins ua where ua.university_id = u.id and ds.department_id = v_dept;
    update public.admin_invites set department_id = v_dept, kind = 'department'
      where university_id = u.id and department_id is null and used_at is null and revoked_at is null;
  end loop;

  -- 3. Colleges with an admin are participating, and so are their universities.
  update public.departments d set is_participating = exists (
    select 1 from public.department_admins da join public.profiles p on p.user_id = da.user_id and p.is_active
    where da.department_id = d.id);
  update public.universities un set is_participating = true
    where exists (select 1 from public.departments d where d.university_id = un.id and d.is_participating);
end;
$$;

-- Old invites that were already used or revoked keep no college.
alter table public.admin_invites add constraint admin_invites_target check (
  (kind = 'org' and department_id is null)
  or (kind = 'department' and (department_id is not null or used_at is not null or revoked_at is not null))
);

alter table public.clubs alter column department_id set not null;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.current_admin_department_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select da.department_id from public.department_admins da
  join public.profiles p on p.user_id = da.user_id and p.is_active
  where da.user_id = auth.uid()
$$;

create or replace function public.current_org_university_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select oa.university_id from public.org_admins oa
  join public.profiles p on p.user_id = oa.user_id and p.is_active
  where oa.user_id = auth.uid()
$$;

-- The university this user administers at the organization level (used by
-- older policies: the organization admin reads all of its clubs, sets colors).
create or replace function public.current_admin_university_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select public.current_org_university_id()
$$;

create or replace function public.current_club_department_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select c.department_id from public.clubs c
  join public.profiles p on p.user_id = c.user_id and p.is_active
  where c.user_id = auth.uid()
$$;

create or replace function public.club_department_id(p_club_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select department_id from public.clubs where id = p_club_id
$$;

create or replace function public.department_has_admin(p_department_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.department_admins da
                 join public.profiles p on p.user_id = da.user_id and p.is_active
                 where da.department_id = p_department_id)
$$;

-- Acts as the club's administrator (see the header).
create or replace function public.is_admin_of_club(p_club_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    public.club_department_id(p_club_id) = public.current_admin_department_id()
    or (public.club_university_id(p_club_id) = public.current_org_university_id()
        and not public.department_has_admin(public.club_department_id(p_club_id))),
    false)
$$;

-- Read-only oversight for organization admins.
create or replace function public.org_oversees_club(p_club_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.club_university_id(p_club_id) = public.current_org_university_id(), false)
$$;

create or replace function public.is_org_admin_of_department(p_department_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select university_id from public.departments where id = p_department_id)
                  = public.current_org_university_id(), false)
$$;

-- Recomputes "participating" for a college and its university.
create or replace function public.refresh_participation(p_department_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uni uuid;
begin
  update public.departments set is_participating = public.department_has_admin(id)
    where id = p_department_id returning university_id into v_uni;
  update public.universities set is_participating = exists (
    select 1 from public.departments where university_id = v_uni and is_participating)
  where id = v_uni;
end;
$$;

revoke all on function public.refresh_participation(uuid) from public, anon, authenticated;
revoke all on function public.current_admin_department_id(), public.current_org_university_id(),
  public.current_club_department_id(), public.club_department_id(uuid), public.department_has_admin(uuid),
  public.org_oversees_club(uuid), public.is_org_admin_of_department(uuid) from public, anon;
grant execute on function public.current_admin_department_id(), public.current_org_university_id(),
  public.current_club_department_id(), public.club_department_id(uuid), public.department_has_admin(uuid),
  public.org_oversees_club(uuid), public.is_org_admin_of_department(uuid), public.is_admin_of_club(uuid)
  to authenticated;

-- Approval settings now live on the college.
create or replace function public.approval_required(p_club_id uuid, p_kind text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select case p_kind
             when 'message' then s.require_message_approval
             when 'opportunity' then s.require_opportunity_approval
             when 'proposal' then s.require_proposal_approval
           end
    from public.clubs c
    join public.department_settings s on s.department_id = c.department_id
    where c.id = p_club_id
  ), false)
$$;

-- The old one-admin-per-university table is replaced by the tables above.
drop table public.university_admins;

-- ---------------------------------------------------------------------------
-- Row Level Security on the new tables
-- ---------------------------------------------------------------------------
alter table public.departments         enable row level security;
alter table public.department_settings enable row level security;
alter table public.department_admins   enable row level security;
alter table public.org_admins          enable row level security;
revoke all on public.departments, public.department_settings, public.department_admins, public.org_admins
  from anon, authenticated;

-- Colleges are public (club sign-up lists them).
grant select on public.departments to anon, authenticated;
grant insert (university_id, name) on public.departments to authenticated;
grant update (name) on public.departments to authenticated;
grant delete on public.departments to authenticated;
create policy "colleges are public" on public.departments for select to anon, authenticated using (true);
create policy "organization admin adds colleges" on public.departments for insert to authenticated
  with check (university_id = (select public.current_org_university_id()) or (select public.is_site_admin()));
create policy "organization admin renames colleges" on public.departments for update to authenticated
  using (university_id = (select public.current_org_university_id()) or (select public.is_site_admin()))
  with check (university_id = (select public.current_org_university_id()) or (select public.is_site_admin()));
-- Only empty colleges can be removed (clubs and admins block it).
create policy "organization admin removes colleges" on public.departments for delete to authenticated
  using (university_id = (select public.current_org_university_id()) or (select public.is_site_admin()));

-- College settings: its clubs and admins, the organization admin, site admins.
grant select on public.department_settings to authenticated;
grant update (scheduling_url, scheduling_instructions, require_message_approval,
              require_opportunity_approval, require_proposal_approval)
  on public.department_settings to authenticated;
create policy "college members read settings" on public.department_settings for select to authenticated
  using (department_id = (select public.current_club_department_id())
         or department_id = (select public.current_admin_department_id())
         or (select public.is_org_admin_of_department(department_id))
         or (select public.is_site_admin()));
create policy "admins update college settings" on public.department_settings for update to authenticated
  using (department_id = (select public.current_admin_department_id())
         or (select public.is_org_admin_of_department(department_id)))
  with check (department_id = (select public.current_admin_department_id())
              or (select public.is_org_admin_of_department(department_id)));

-- College admins: themselves and co-admins, the organization admin, site admins.
grant select on public.department_admins to authenticated;
create policy "admins see their college's admins" on public.department_admins for select to authenticated
  using (user_id = (select auth.uid())
         or department_id = (select public.current_admin_department_id())
         or (select public.is_org_admin_of_department(department_id))
         or (select public.is_site_admin()));

grant select on public.org_admins to authenticated;
create policy "organization admins see each other" on public.org_admins for select to authenticated
  using (user_id = (select auth.uid())
         or university_id = (select public.current_org_university_id())
         or (select public.is_site_admin()));

-- ---------------------------------------------------------------------------
-- Existing tables: college admins read their clubs; organization admins
-- read everything at their university (read-only).
-- ---------------------------------------------------------------------------
create policy "college admins read their clubs" on public.clubs for select to authenticated
  using ((select public.is_admin_of_club(id)));
create policy "organization admin reads events" on public.events for select to authenticated
  using ((select public.org_oversees_club(club_id)));
create policy "organization admin reads reports" on public.event_reports for select to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and public.org_oversees_club(e.club_id)));
create policy "organization admin reads member counts" on public.club_member_counts for select to authenticated
  using ((select public.org_oversees_club(club_id)));
create policy "organization admin reads opportunities" on public.opportunities for select to authenticated
  using ((select public.org_oversees_club(club_id)));
create policy "organization admin reads proposals" on public.proposals for select to authenticated
  using ((select public.org_oversees_club(club_id)));
create policy "organization admin reads receipts" on public.receipts for select to authenticated
  using ((select public.org_oversees_club(club_id)));
create policy "organization admin reads receipt files" on storage.objects for select to authenticated
  using (bucket_id = 'receipts'
         and exists (select 1 from public.receipts r where r.storage_path = name and public.org_oversees_club(r.club_id)));

create policy "organization admin reads its invites" on public.admin_invites for select to authenticated
  using (university_id = (select public.current_org_university_id()));

-- ---------------------------------------------------------------------------
-- RPCs for organization admins
-- ---------------------------------------------------------------------------
create or replace function public.update_organization(p_unit_label text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.current_org_university_id() is null then raise exception 'Only organization admins can do this' using errcode = '42501'; end if;
  if p_unit_label not in ('College', 'School', 'Department') then raise exception 'Choose College, School or Department'; end if;
  update public.universities set unit_label = p_unit_label where id = public.current_org_university_id();
end;
$$;

-- Moves a club to another college of the same university.
create or replace function public.move_club(p_club_id uuid, p_department_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uni uuid := public.club_university_id(p_club_id);
begin
  if v_uni is null then raise exception 'Club not found'; end if;
  -- (coalesce: for anyone who isn't an organization admin the comparison is null, which must mean "no")
  if not (coalesce(v_uni = public.current_org_university_id(), false) or public.is_site_admin()) then
    raise exception 'Only the organization admin can move clubs' using errcode = '42501';
  end if;
  if not exists (select 1 from public.departments where id = p_department_id and university_id = v_uni) then
    raise exception 'Choose a college at the same university';
  end if;
  update public.clubs set department_id = p_department_id where id = p_club_id;
end;
$$;

-- Removes a college admin (their account is deactivated).
create or replace function public.remove_department_admin(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_dept uuid;
begin
  select department_id into v_dept from public.department_admins where user_id = p_user_id;
  if v_dept is null then raise exception 'Admin not found'; end if;
  if not (public.is_org_admin_of_department(v_dept) or public.is_site_admin()) then
    raise exception 'Only the organization admin can remove college admins' using errcode = '42501';
  end if;
  delete from public.department_admins where user_id = p_user_id;
  update public.profiles set is_active = false where user_id = p_user_id;
  perform public.refresh_participation(v_dept);
end;
$$;

revoke all on function public.update_organization(text), public.move_club(uuid, uuid),
  public.remove_department_admin(uuid) from public, anon;
grant execute on function public.update_organization(text), public.move_club(uuid, uuid),
  public.remove_department_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Colors: the organization's colors, optionally overridden per college.
-- ---------------------------------------------------------------------------
create or replace function public.set_department_theme(p_primary text, p_pop text, p_fresh text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_dept uuid := public.current_admin_department_id();
begin
  if v_dept is null then raise exception 'Only college admins can change college colors' using errcode = '42501'; end if;
  update public.department_settings set
    theme_primary = lower(p_primary), theme_pop = lower(p_pop), theme_fresh = lower(p_fresh)
  where department_id = v_dept;
end;
$$;

create or replace function public.current_university_theme()
returns json language sql stable security definer set search_path = '' as $$
  with dept as (
    select coalesce(public.current_club_department_id(), public.current_admin_department_id()) as id
  ), src as (
    select coalesce(s.theme_primary, u.theme_primary) as p,
           case when s.theme_primary is not null then s.theme_pop else u.theme_pop end as o,
           case when s.theme_primary is not null then s.theme_fresh else u.theme_fresh end as f
    from public.universities u
    left join dept on true
    left join public.departments d on d.id = dept.id
    left join public.department_settings s on s.department_id = d.id
    where u.id = coalesce(d.university_id, public.current_org_university_id())
  )
  select case when p is null then null else json_build_object('primary', p, 'pop', o, 'fresh', f) end from src
$$;

-- Each college admin's own college (and its organization colors), for the
-- college admin's settings page.
create or replace function public.department_theme_info()
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'override', case when s.theme_primary is null then null
                     else json_build_object('primary', s.theme_primary, 'pop', s.theme_pop, 'fresh', s.theme_fresh) end,
    'organization', case when u.theme_primary is null then null
                         else json_build_object('primary', u.theme_primary, 'pop', u.theme_pop, 'fresh', u.theme_fresh) end)
  from public.departments d
  join public.department_settings s on s.department_id = d.id
  join public.universities u on u.id = d.university_id
  where d.id = public.current_admin_department_id()
$$;

revoke all on function public.set_department_theme(text, text, text), public.department_theme_info() from public, anon;
grant execute on function public.set_department_theme(text, text, text), public.department_theme_info() to authenticated;

-- ---------------------------------------------------------------------------
-- Club sign-up: choose a university, then one of its participating colleges.
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
  v_dept   uuid;
  v_budget numeric;
begin
  if req_role = 'invited_admin' then
    null;  -- profile + admin row are created by the accept-admin-invite function

  elsif req_role = 'club' then
    begin
      v_uni    := (meta ->> 'university_id')::uuid;
      v_dept   := (meta ->> 'department_id')::uuid;
      v_budget := coalesce(nullif(meta ->> 'initial_budget', ''), '0')::numeric;
    exception when others then
      raise exception 'Invalid club sign-up data';
    end;

    if v_dept is null or not exists (
      select 1 from public.departments d
      where d.id = v_dept and d.university_id = v_uni and d.is_participating
    ) then
      raise exception 'Choose a participating college at your university';
    end if;
    if v_budget < 0 then
      raise exception 'Initial budget cannot be negative';
    end if;

    insert into public.profiles (user_id, role) values (new.id, 'club');
    insert into public.clubs (user_id, university_id, department_id, name, email, description, initial_budget)
    values (
      new.id,
      v_uni,
      v_dept,
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

-- ---------------------------------------------------------------------------
-- Views: add the college name (partners see "Club · College · University");
-- organization admins see their whole university read-only.
-- ---------------------------------------------------------------------------
create or replace view public.opportunity_cards as
select
  o.id, o.title, o.description, o.support_type, o.amount_sought, o.photo_path, o.status, o.created_at,
  o.club_id, c.name as club_name, c.logo_path as club_logo_path,
  c.university_id, u.name as university_name, u.city as university_city, u.state as university_state,
  o.event_id, e.name as event_name, e.starts_at as event_starts_at, e.time_zone as event_time_zone,
  o.approval_status, o.review_note,
  c.department_id, d.name as department_name
from public.opportunities o
join public.clubs c on c.id = o.club_id
join public.profiles pr on pr.user_id = c.user_id and pr.is_active
join public.universities u on u.id = c.university_id
join public.departments d on d.id = c.department_id
left join public.events e on e.id = o.event_id
where
  (o.status = 'open' and o.approval_status = 'approved' and public.current_partner_id() is not null)
  or exists (select 1 from public.proposals p where p.opportunity_id = o.id and p.partner_id = public.current_partner_id())
  or o.club_id = public.current_club_id()
  or public.is_admin_of_club(o.club_id)
  or public.org_oversees_club(o.club_id)
  or public.is_site_admin();

create or replace view public.proposal_details as
select
  p.*, pa.name as partner_name, pa.logo_path as partner_logo_path, pa.email as partner_email,
  pa.category as partner_category, c.name as club_name, c.university_id, u.name as university_name,
  o.title as opportunity_title, e.name as event_name, e.starts_at as event_starts_at,
  e.time_zone as event_time_zone, e.approval_status as event_approval_status,
  c.department_id, d.name as department_name
from public.proposals p
join public.partners pa on pa.id = p.partner_id
join public.clubs c on c.id = p.club_id
join public.universities u on u.id = c.university_id
join public.departments d on d.id = c.department_id
left join public.opportunities o on o.id = p.opportunity_id
left join public.events e on e.id = p.event_id
where (p.club_id = public.current_club_id() and p.club_visible)
   or p.partner_id = public.current_partner_id()
   or public.is_admin_of_club(p.club_id)
   or public.org_oversees_club(p.club_id)
   or public.is_site_admin();

create or replace view public.message_reviews as
select
  cv.id, cv.subject, cv.club_id, cv.partner_id, cv.event_id, cv.approval_status, cv.review_note,
  cv.submitted_at, cv.reviewed_at,
  c.name as club_name, pa.name as partner_name, pa.category as partner_category,
  pa.city as partner_city, pa.state as partner_state, e.name as event_name,
  (select m.body from public.messages m where m.conversation_id = cv.id order by m.created_at limit 1) as body,
  c.department_id, d.name as department_name
from public.conversations cv
join public.clubs c on c.id = cv.club_id
join public.departments d on d.id = c.department_id
join public.partners pa on pa.id = cv.partner_id
left join public.events e on e.id = cv.event_id
where cv.started_by = 'club'
  and (cv.approval_status <> 'approved' or cv.reviewed_at is not null)
  and (public.is_admin_of_club(cv.club_id) or public.org_oversees_club(cv.club_id) or public.is_site_admin());

create or replace view public.partner_events as
select
  e.id, e.name, e.starts_at, e.ends_at, e.time_zone, e.description, e.location, e.flyer_path,
  e.approval_status, e.partner_id,
  c.id as club_id, c.name as club_name, u.name as university_name,
  d.name as department_name
from public.events e
join public.clubs c on c.id = e.club_id
join public.universities u on u.id = c.university_id
join public.departments d on d.id = c.department_id
where e.partner_id = public.current_partner_id()
   or exists (select 1 from public.proposals p where p.event_id = e.id and p.partner_id = public.current_partner_id()
              and p.status in ('pending_review', 'pending_club', 'pending_admin', 'changes_requested', 'approved'));

create or replace view public.conversation_list as
select
  cv.id, cv.subject, cv.club_id, cv.partner_id, cv.event_id, cv.opportunity_id, cv.started_by,
  cv.created_at, cv.last_message_at,
  c.name as club_name, c.email as club_email, c.logo_path as club_logo_path, u.name as university_name,
  pa.name as partner_name, pa.email as partner_email, pa.logo_path as partner_logo_path,
  case
    when cv.club_id = public.current_club_id() then cv.last_message_at > coalesce(cv.club_last_read_at, '-infinity')
    when cv.partner_id = public.current_partner_id() then cv.last_message_at > coalesce(cv.partner_last_read_at, '-infinity')
    else false
  end as unread,
  (select m.body from public.messages m where m.conversation_id = cv.id order by m.created_at desc limit 1) as last_message,
  cv.approval_status, cv.review_note,
  d.name as department_name
from public.conversations cv
join public.clubs c on c.id = cv.club_id
join public.departments d on d.id = c.department_id
join public.universities u on u.id = c.university_id
join public.partners pa on pa.id = cv.partner_id
where cv.club_id = public.current_club_id()
   or (cv.partner_id = public.current_partner_id() and cv.approval_status = 'approved')
   or public.is_site_admin();

create or replace view public.partner_event_results as
select
  e.id as event_id, e.name as event_name, e.starts_at, e.time_zone,
  c.name as club_name, u.name as university_name,
  r.attendees, r.offers_redeemed, r.notes, r.submitted_at,
  d.name as department_name
from public.event_reports r
join public.events e on e.id = r.event_id
join public.clubs c on c.id = e.club_id
join public.universities u on u.id = c.university_id
join public.departments d on d.id = c.department_id
where e.partner_id = public.current_partner_id()
  and e.approval_status = 'approved';
