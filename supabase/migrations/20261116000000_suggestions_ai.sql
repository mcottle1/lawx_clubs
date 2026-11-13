-- =============================================================================
-- Migration 0007: suggestions (rules/templates) + optional AI usage log.
--
-- The partner finder and ask-amount formula run in the browser. They need two
-- cross-club numbers a club can't read directly; these SECURITY DEFINER
-- functions return only aggregates (counts / a median), never other clubs'
-- rows.
-- =============================================================================

-- How often each partner has sponsored at the caller's university / club.
create or replace function public.partner_match_stats()
returns table (partner_id uuid, at_university int, with_club int, last_sponsored_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  with me as (
    select public.current_club_id() as club_id, public.current_club_university_id() as university_id
  ),
  sponsorships as (
    -- approved events with a platform sponsor
    select e.partner_id, e.club_id, c.university_id, e.starts_at as at
      from public.events e join public.clubs c on c.id = e.club_id
      where e.partner_id is not null and e.approval_status = 'approved'
    union all
    -- approved partnerships not tied to an event
    select p.partner_id, p.club_id, c.university_id, p.reviewed_at
      from public.proposals p join public.clubs c on c.id = p.club_id
      where p.status = 'approved' and p.event_id is null
  )
  select s.partner_id,
         count(*) filter (where s.university_id = me.university_id)::int,
         count(*) filter (where s.club_id = me.club_id)::int,
         max(s.at)
  from sponsorships s, me
  where me.club_id is not null
  group by s.partner_id
$$;

-- Median approved sponsorship amount for a kind of support: at the caller's
-- university if there are any, otherwise across the whole site.
create or replace function public.proposal_amount_stats(p_support_type public.support_type)
returns table (median_amount numeric, sample_size int, scope text)
language sql stable security definer set search_path = ''
as $$
  with amounts as (
    select p.amount, c.university_id
    from public.proposals p
    join public.opportunities o on o.id = p.opportunity_id
    join public.clubs c on c.id = p.club_id
    where p.status = 'approved' and p.amount > 0 and o.support_type = p_support_type
  ),
  uni as (
    select percentile_cont(0.5) within group (order by amount) as m, count(*) as n
    from amounts where university_id = public.current_club_university_id()
  ),
  site as (
    select percentile_cont(0.5) within group (order by amount) as m, count(*) as n from amounts
  )
  select
    case when uni.n > 0 then uni.m else site.m end::numeric(12, 2),
    case when uni.n > 0 then uni.n else site.n end::int,
    case when uni.n > 0 then 'university' when site.n > 0 then 'site' else 'none' end
  from uni, site
  where public.current_club_id() is not null
$$;

revoke all on function public.partner_match_stats() from public, anon;
revoke all on function public.proposal_amount_stats(public.support_type) from public, anon;
grant execute on function public.partner_match_stats() to authenticated;
grant execute on function public.proposal_amount_stats(public.support_type) to authenticated;

-- ---------------------------------------------------------------------------
-- ai_usage: one row per optional-AI request (written by the `ai` Edge
-- Function with the service role). Used for per-club daily limits and so
-- you can see what AI costs.
-- ---------------------------------------------------------------------------
create table public.ai_usage (
  id             uuid primary key default gen_random_uuid(),
  club_id        uuid not null references public.clubs (id) on delete cascade,
  user_id        uuid references auth.users (id) on delete set null,
  action         text not null check (action in ('find_partners', 'draft_opportunity', 'social_posts')),
  model          text not null,
  input_tokens   int not null default 0,
  output_tokens  int not null default 0,
  web_searches   int not null default 0,
  est_cost_usd   numeric(10, 4) not null default 0,
  ok             boolean not null default true,
  error          text,
  created_at     timestamptz not null default now()
);

create index ai_usage_club_day_idx on public.ai_usage (club_id, action, created_at desc);

alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;

create policy "club reads own ai usage" on public.ai_usage for select to authenticated
  using (club_id = (select public.current_club_id()));
create policy "site admin reads ai usage" on public.ai_usage for select to authenticated
  using ((select public.is_site_admin()));
