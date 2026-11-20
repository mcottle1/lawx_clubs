-- University colors. A university administrator picks a primary color and
-- two accents; the site uses them for that university's clubs and its admin
-- (everyone else keeps the CampusBridge colors). Null = default colors.
alter table public.universities
  add column theme_primary text check (theme_primary ~ '^#[0-9a-fA-F]{6}$'),
  add column theme_pop     text check (theme_pop ~ '^#[0-9a-fA-F]{6}$'),
  add column theme_fresh   text check (theme_fresh ~ '^#[0-9a-fA-F]{6}$'),
  add constraint universities_theme_complete check (
    (theme_primary is null) = (theme_pop is null) and (theme_pop is null) = (theme_fresh is null)
  );

-- Admin sets (or, with nulls, resets) their own university's colors.
create or replace function public.set_university_theme(p_primary text, p_pop text, p_fresh text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uni uuid := public.current_admin_university_id();
begin
  if v_uni is null then raise exception 'Only university administrators can change colors' using errcode = '42501'; end if;
  update public.universities set
    theme_primary = lower(p_primary), theme_pop = lower(p_pop), theme_fresh = lower(p_fresh)
  where id = v_uni;
end;
$$;

-- The colors for the signed-in user's university (club or university admin);
-- null for everyone else or when the university uses the default colors.
create or replace function public.current_university_theme()
returns json
language sql stable security definer set search_path = ''
as $$
  select case when u.theme_primary is null then null
              else json_build_object('primary', u.theme_primary, 'pop', u.theme_pop, 'fresh', u.theme_fresh) end
  from public.universities u
  where u.id = coalesce(public.current_club_university_id(), public.current_admin_university_id())
$$;

revoke all on function public.set_university_theme(text, text, text) from public, anon;
revoke all on function public.current_university_theme() from public, anon;
grant execute on function public.set_university_theme(text, text, text) to authenticated;
grant execute on function public.current_university_theme() to authenticated;
