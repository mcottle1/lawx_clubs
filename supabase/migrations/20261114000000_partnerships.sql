-- =============================================================================
-- Migration 0005: partnerships — opportunities, conversations/messages,
-- proposals, admin approvals.
--
-- Write paths with business rules go through SECURITY DEFINER functions
-- (start_conversation, submit_proposal, respond_to_proposal, ...), so the
-- tables themselves only grant SELECT (plus a few simple, policy-checked
-- writes). Partners never read the clubs/events tables directly; they use
-- limited-column views so club budgets stay private.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.opportunity_status as enum ('open', 'filled', 'closed');
create type public.support_type as enum ('food', 'funding', 'in_kind', 'speaker', 'other');
create type public.proposal_status as enum (
  'pending_club',   -- waiting for the club to accept/decline
  'declined',       -- club said no
  'pending_admin',  -- club accepted; waiting for the university admin
  'approved',
  'denied',         -- university admin said no
  'withdrawn'       -- partner withdrew
);

-- ---------------------------------------------------------------------------
-- opportunities (posted by clubs)
-- ---------------------------------------------------------------------------
create table public.opportunities (
  id             uuid primary key default gen_random_uuid(),
  club_id        uuid not null references public.clubs (id) on delete cascade,
  event_id       uuid references public.events (id) on delete set null,
  title          text not null check (length(btrim(title)) between 1 and 200),
  description    text not null default '' check (length(description) <= 5000),
  support_type   public.support_type not null default 'other',
  amount_sought  numeric(12, 2) check (amount_sought >= 0),
  photo_path     text,              -- in the public `flyers` bucket
  status         public.opportunity_status not null default 'open',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index opportunities_status_idx on public.opportunities (status, created_at desc);
create index opportunities_club_idx on public.opportunities (club_id);

create trigger opportunities_updated_at
  before update on public.opportunities
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- conversations + messages (club ↔ partner)
-- ---------------------------------------------------------------------------
create table public.conversations (
  id                    uuid primary key default gen_random_uuid(),
  club_id               uuid not null references public.clubs (id) on delete cascade,
  partner_id            uuid not null references public.partners (id) on delete cascade,
  subject               text not null check (length(btrim(subject)) between 1 and 200),
  event_id              uuid references public.events (id) on delete set null,
  opportunity_id        uuid references public.opportunities (id) on delete set null,
  started_by            public.user_role not null check (started_by in ('club', 'partner')),
  created_at            timestamptz not null default now(),
  last_message_at       timestamptz not null default now(),
  club_last_read_at     timestamptz,
  partner_last_read_at  timestamptz
);

create index conversations_club_idx on public.conversations (club_id, last_message_at desc);
create index conversations_partner_idx on public.conversations (partner_id, last_message_at desc);

create table public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  sender_user_id   uuid references auth.users (id) on delete set null,
  sender_role      text not null check (sender_role in ('club', 'partner', 'system')),
  body             text not null check (length(btrim(body)) between 1 and 5000),
  created_at       timestamptz not null default now()
);

create index messages_conversation_idx on public.messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- proposals (partner → club → university admin)
-- ---------------------------------------------------------------------------
create table public.proposals (
  id                 uuid primary key default gen_random_uuid(),
  club_id            uuid not null references public.clubs (id) on delete cascade,
  partner_id         uuid not null references public.partners (id) on delete cascade,
  opportunity_id     uuid references public.opportunities (id) on delete set null,
  event_id           uuid references public.events (id) on delete set null,
  conversation_id    uuid references public.conversations (id) on delete set null,
  headcount          int check (headcount between 0 and 100000),          -- lunches / people covered
  amount             numeric(12, 2) check (amount >= 0),                   -- dollars
  in_kind            text check (length(in_kind) <= 1000),
  student_offer      text check (length(student_offer) <= 1000),           -- e.g. discount code
  pitch_minutes      int check (pitch_minutes between 0 and 240),
  message            text check (length(message) <= 5000),
  status             public.proposal_status not null default 'pending_club',
  club_responded_at  timestamptz,
  reviewed_at        timestamptz,
  reviewed_by        uuid references auth.users (id) on delete set null,
  denial_reason      text,
  bundle_id          uuid,  -- reserved for future sponsorship bundles (not used yet)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint proposals_offers_something check (
    coalesce(headcount, 0) > 0 or coalesce(amount, 0) > 0
    or nullif(btrim(coalesce(in_kind, '')), '') is not null
    or nullif(btrim(coalesce(student_offer, '')), '') is not null
  )
);

create index proposals_club_idx on public.proposals (club_id, status);
create index proposals_partner_idx on public.proposals (partner_id, status);
create index proposals_event_idx on public.proposals (event_id) where event_id is not null;

create trigger proposals_updated_at
  before update on public.proposals
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.conversation_role(p_conversation_id uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when c.club_id = public.current_club_id() then 'club'
    when c.partner_id = public.current_partner_id() then 'partner'
  end
  from public.conversations c where c.id = p_conversation_id
$$;

-- Keeps conversation timestamps current when a message is added.
create or replace function public.messages_after_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.conversations set
    last_message_at = new.created_at,
    club_last_read_at = case when new.sender_role = 'club' then new.created_at else club_last_read_at end,
    partner_last_read_at = case when new.sender_role = 'partner' then new.created_at else partner_last_read_at end
  where id = new.conversation_id;
  return new;
end;
$$;

create trigger messages_after_insert
  after insert on public.messages
  for each row execute function public.messages_after_insert();

-- Opportunities may only be linked to the club's own events.
create or replace function public.opportunities_check_event()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.event_id is not null and not exists (
    select 1 from public.events where id = new.event_id and club_id = new.club_id
  ) then
    raise exception 'Opportunity event must belong to the same club';
  end if;
  return new;
end;
$$;

create trigger opportunities_check_event
  before insert or update of event_id, club_id on public.opportunities
  for each row execute function public.opportunities_check_event();

-- ---------------------------------------------------------------------------
-- RPC: start a conversation (club → partner outreach, or partner asking
-- about an open opportunity). Returns the conversation id.
-- ---------------------------------------------------------------------------
create or replace function public.start_conversation(
  p_body text,
  p_subject text default null,
  p_partner_id uuid default null,
  p_event_id uuid default null,
  p_opportunity_id uuid default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_club uuid;
  v_partner uuid;
  v_subject text := nullif(btrim(coalesce(p_subject, '')), '');
  v_id uuid;
  v_opp record;
begin
  if nullif(btrim(coalesce(p_body, '')), '') is null then
    raise exception 'Message cannot be empty';
  end if;

  if v_role = 'club' then
    v_club := public.current_club_id();
    select id into v_partner from public.partners pa
      join public.profiles pr on pr.user_id = pa.user_id and pr.is_active
      where pa.id = p_partner_id;
    if v_partner is null then raise exception 'Partner not found'; end if;
    if p_event_id is not null and not exists (
      select 1 from public.events where id = p_event_id and club_id = v_club) then
      raise exception 'Event not found';
    end if;
    if p_opportunity_id is not null and not exists (
      select 1 from public.opportunities where id = p_opportunity_id and club_id = v_club) then
      raise exception 'Opportunity not found';
    end if;
  elsif v_role = 'partner' then
    v_partner := public.current_partner_id();
    select * into v_opp from public.opportunities where id = p_opportunity_id and status = 'open';
    if v_opp.id is null then raise exception 'Opportunity not found or no longer open'; end if;
    v_club := v_opp.club_id;
    p_event_id := v_opp.event_id;
    v_subject := coalesce(v_subject, v_opp.title);
  else
    raise exception 'Only clubs and partners can start conversations';
  end if;

  insert into public.conversations (club_id, partner_id, subject, event_id, opportunity_id, started_by)
  values (v_club, v_partner, coalesce(v_subject, 'Partnership inquiry'), p_event_id, p_opportunity_id, v_role)
  returning id into v_id;

  insert into public.messages (conversation_id, sender_user_id, sender_role, body)
  values (v_id, auth.uid(), v_role::text, btrim(p_body));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: partner submits a proposal for an open opportunity or within a
-- conversation the club started. Returns the proposal id.
-- ---------------------------------------------------------------------------
create or replace function public.submit_proposal(
  p_opportunity_id uuid default null,
  p_conversation_id uuid default null,
  p_headcount int default null,
  p_amount numeric default null,
  p_in_kind text default null,
  p_student_offer text default null,
  p_pitch_minutes int default null,
  p_message text default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_partner uuid := public.current_partner_id();
  v_club uuid;
  v_event uuid;
  v_opp uuid := p_opportunity_id;
  v_conv uuid := p_conversation_id;
  v_title text;
  v_id uuid;
  v_summary text;
begin
  if v_partner is null then raise exception 'Only partners can submit proposals'; end if;

  if v_opp is not null then
    select club_id, event_id, title into v_club, v_event, v_title
      from public.opportunities where id = v_opp and status = 'open';
    if v_club is null then raise exception 'Opportunity not found or no longer open'; end if;
    if v_conv is null then
      select id into v_conv from public.conversations
        where club_id = v_club and partner_id = v_partner and opportunity_id = v_opp
        order by created_at limit 1;
    end if;
  elsif v_conv is not null then
    select club_id, event_id, opportunity_id, subject into v_club, v_event, v_opp, v_title
      from public.conversations where id = v_conv and partner_id = v_partner;
    if v_club is null then raise exception 'Conversation not found'; end if;
  else
    raise exception 'Choose an opportunity or conversation';
  end if;

  if exists (select 1 from public.proposals where partner_id = v_partner and status in ('pending_club', 'pending_admin')
             and ((v_opp is not null and opportunity_id = v_opp) or (v_opp is null and conversation_id = v_conv))) then
    raise exception 'You already have an open proposal for this';
  end if;

  if v_conv is null then
    insert into public.conversations (club_id, partner_id, subject, event_id, opportunity_id, started_by)
    values (v_club, v_partner, v_title, v_event, v_opp, 'partner')
    returning id into v_conv;
  end if;

  insert into public.proposals (club_id, partner_id, opportunity_id, event_id, conversation_id, headcount,
                                amount, in_kind, student_offer, pitch_minutes, message)
  values (v_club, v_partner, v_opp, v_event, v_conv, p_headcount, p_amount,
          nullif(btrim(coalesce(p_in_kind, '')), ''), nullif(btrim(coalesce(p_student_offer, '')), ''),
          p_pitch_minutes, nullif(btrim(coalesce(p_message, '')), ''))
  returning id into v_id;

  v_summary := 'Sent a sponsorship proposal'
    || coalesce(': ' || nullif(concat_ws(', ',
         case when p_headcount > 0 then p_headcount || ' lunches/people covered' end,
         case when p_amount > 0 then '$' || to_char(p_amount, 'FM999G999G990D00') end,
         nullif(btrim(coalesce(p_in_kind, '')), ''),
         case when nullif(btrim(coalesce(p_student_offer, '')), '') is not null then 'student offer: ' || btrim(p_student_offer) end,
         case when p_pitch_minutes > 0 then p_pitch_minutes || ' min to present' end), ''), '')
    || coalesce(E'\n\n' || nullif(btrim(coalesce(p_message, '')), ''), '');
  insert into public.messages (conversation_id, sender_user_id, sender_role, body)
  values (v_conv, auth.uid(), 'partner', v_summary);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: club accepts or declines a proposal.
-- Accepting puts the partner on the event (if any) and sends the
-- partnership to the university admin. Because the event's sponsor changes,
-- an already-approved event goes back to "pending" and is re-approved
-- together with the partnership.
-- ---------------------------------------------------------------------------
create or replace function public.respond_to_proposal(p_proposal_id uuid, p_accept boolean)
returns public.proposal_status
language plpgsql security definer set search_path = ''
as $$
declare
  v_club uuid := public.current_club_id();
  p public.proposals%rowtype;
  e public.events%rowtype;
  v_new public.proposal_status;
begin
  select * into p from public.proposals where id = p_proposal_id and club_id = v_club for update;
  if p.id is null then raise exception 'Proposal not found'; end if;
  if p.status <> 'pending_club' then raise exception 'This proposal has already been answered'; end if;

  if p_accept then
    if p.event_id is not null then
      select * into e from public.events where id = p.event_id for update;
      if e.starts_at <= now() then raise exception 'This event has already started'; end if;
      if (e.partner_id is not null and e.partner_id <> p.partner_id) or e.outside_sponsor_name is not null then
        raise exception 'This event already lists a sponsor. Edit the event to remove it, then accept.';
      end if;
      update public.events set partner_id = p.partner_id where id = e.id;  -- events_guard may reset to pending
    end if;
    v_new := 'pending_admin';
    if p.opportunity_id is not null then
      update public.opportunities set status = 'filled' where id = p.opportunity_id and status = 'open';
    end if;
  else
    v_new := 'declined';
  end if;

  update public.proposals set status = v_new, club_responded_at = now() where id = p.id;
  if p.conversation_id is not null then
    insert into public.messages (conversation_id, sender_user_id, sender_role, body)
    values (p.conversation_id, auth.uid(), 'system',
            case when p_accept then 'The club accepted the proposal. It now goes to the university administrator for approval.'
                 else 'The club declined the proposal.' end);
  end if;
  return v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: partner withdraws a proposal that isn't final yet.
-- ---------------------------------------------------------------------------
create or replace function public.withdraw_proposal(p_proposal_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  p public.proposals%rowtype;
begin
  select * into p from public.proposals
    where id = p_proposal_id and partner_id = public.current_partner_id() for update;
  if p.id is null then raise exception 'Proposal not found'; end if;
  if p.status not in ('pending_club', 'pending_admin') then raise exception 'This proposal can no longer be withdrawn'; end if;
  update public.proposals set status = 'withdrawn' where id = p.id;
  if p.status = 'pending_admin' then
    update public.events set partner_id = null where id = p.event_id and partner_id = p.partner_id;
    update public.opportunities set status = 'open' where id = p.opportunity_id and status = 'filled';
  end if;
  if p.conversation_id is not null then
    insert into public.messages (conversation_id, sender_user_id, sender_role, body)
    values (p.conversation_id, auth.uid(), 'system', 'The partner withdrew the proposal.');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs: university admin approves/denies. Deny requires a reason.
-- Reviewing an event also decides partnerships for that event that are
-- waiting on the admin ("approved along with it").
-- ---------------------------------------------------------------------------
create or replace function public.review_event(p_event_id uuid, p_approve boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  e public.events%rowtype;
  pr public.proposals%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into e from public.events where id = p_event_id for update;
  if e.id is null or not public.is_admin_of_club(e.club_id) then raise exception 'Event not found'; end if;
  if e.approval_status <> 'pending' then raise exception 'This event has already been reviewed'; end if;
  if not p_approve and v_reason is null then raise exception 'A reason is required to deny'; end if;

  update public.events set
    approval_status = case when p_approve then 'approved'::public.approval_status else 'denied' end,
    denial_reason = case when p_approve then null else v_reason end,
    reviewed_at = now(), reviewed_by = auth.uid()
  where id = e.id;

  -- Partnerships on this event that were waiting on the admin get the same decision.
  for pr in
    update public.proposals set
      status = case when p_approve then 'approved'::public.proposal_status else 'denied' end,
      denial_reason = case when p_approve then null else v_reason end,
      reviewed_at = now(), reviewed_by = auth.uid()
    where event_id = e.id and status = 'pending_admin'
    returning *
  loop
    if not p_approve then
      update public.events set partner_id = null where id = e.id and partner_id = pr.partner_id;
      update public.opportunities set status = 'open' where id = pr.opportunity_id and status = 'filled';
    end if;
    if pr.conversation_id is not null then
      insert into public.messages (conversation_id, sender_user_id, sender_role, body)
      values (pr.conversation_id, auth.uid(), 'system',
              case when p_approve then 'The university administrator approved the event and this partnership.'
                   else 'The university administrator did not approve the event: ' || v_reason end);
    end if;
  end loop;
end;
$$;

create or replace function public.review_proposal(p_proposal_id uuid, p_approve boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  p public.proposals%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into p from public.proposals where id = p_proposal_id for update;
  if p.id is null or not public.is_admin_of_club(p.club_id) then raise exception 'Proposal not found'; end if;
  if p.status <> 'pending_admin' then raise exception 'This partnership has already been reviewed'; end if;
  if not p_approve and v_reason is null then raise exception 'A reason is required to deny'; end if;

  update public.proposals set
    status = case when p_approve then 'approved'::public.proposal_status else 'denied' end,
    denial_reason = case when p_approve then null else v_reason end,
    reviewed_at = now(), reviewed_by = auth.uid()
  where id = p.id;

  if not p_approve then
    -- Take the partner back off the event and reopen the opportunity.
    update public.events set partner_id = null where id = p.event_id and partner_id = p.partner_id;
    update public.opportunities set status = 'open' where id = p.opportunity_id and status = 'filled';
  end if;
  if p.conversation_id is not null then
    insert into public.messages (conversation_id, sender_user_id, sender_role, body)
    values (p.conversation_id, auth.uid(), 'system',
            case when p_approve then 'The university administrator approved this partnership.'
                 else 'The university administrator did not approve this partnership: ' || v_reason end);
  end if;
end;
$$;

-- Marks a conversation as read for the caller's side.
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_side text := public.conversation_role(p_conversation_id);
begin
  if v_side = 'club' then
    update public.conversations set club_last_read_at = now() where id = p_conversation_id;
  elsif v_side = 'partner' then
    update public.conversations set partner_last_read_at = now() where id = p_conversation_id;
  end if;
end;
$$;

-- Public share page for an open opportunity (no login): limited fields only.
create or replace function public.get_public_opportunity(p_id uuid)
returns json
language sql stable security definer set search_path = ''
as $$
  select json_build_object(
    'id', o.id, 'title', o.title, 'description', o.description, 'support_type', o.support_type,
    'amount_sought', o.amount_sought, 'photo_path', o.photo_path,
    'club_name', c.name, 'club_logo_path', c.logo_path, 'university_name', u.name,
    'university_city', u.city, 'university_state', u.state,
    'event_name', e.name, 'event_starts_at', e.starts_at, 'event_time_zone', e.time_zone)
  from public.opportunities o
  join public.clubs c on c.id = o.club_id
  join public.profiles pr on pr.user_id = c.user_id and pr.is_active
  join public.universities u on u.id = c.university_id
  left join public.events e on e.id = o.event_id
  where o.id = p_id and o.status = 'open'
$$;

-- Lock down function execution: authenticated only (public page: anon too).
revoke all on function public.start_conversation(text, text, uuid, uuid, uuid) from public, anon;
revoke all on function public.submit_proposal(uuid, uuid, int, numeric, text, text, int, text) from public, anon;
revoke all on function public.respond_to_proposal(uuid, boolean) from public, anon;
revoke all on function public.withdraw_proposal(uuid) from public, anon;
revoke all on function public.review_event(uuid, boolean, text) from public, anon;
revoke all on function public.review_proposal(uuid, boolean, text) from public, anon;
revoke all on function public.mark_conversation_read(uuid) from public, anon;
revoke all on function public.messages_after_insert() from public, anon, authenticated;
revoke all on function public.opportunities_check_event() from public, anon, authenticated;
grant execute on function public.start_conversation(text, text, uuid, uuid, uuid) to authenticated;
grant execute on function public.submit_proposal(uuid, uuid, int, numeric, text, text, int, text) to authenticated;
grant execute on function public.respond_to_proposal(uuid, boolean) to authenticated;
grant execute on function public.withdraw_proposal(uuid) to authenticated;
grant execute on function public.review_event(uuid, boolean, text) to authenticated;
grant execute on function public.review_proposal(uuid, boolean, text) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.get_public_opportunity(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Views for partners (owner-privileged, filtered explicitly; no budgets).
-- ---------------------------------------------------------------------------

-- Opportunities a partner can browse: open ones at active clubs, plus any
-- they've proposed on. Clubs/admins/site admins see their usual scope.
create view public.opportunity_cards as
select
  o.id, o.title, o.description, o.support_type, o.amount_sought, o.photo_path, o.status, o.created_at,
  o.club_id, c.name as club_name, c.logo_path as club_logo_path,
  c.university_id, u.name as university_name, u.city as university_city, u.state as university_state,
  o.event_id, e.name as event_name, e.starts_at as event_starts_at, e.time_zone as event_time_zone
from public.opportunities o
join public.clubs c on c.id = o.club_id
join public.profiles pr on pr.user_id = c.user_id and pr.is_active
join public.universities u on u.id = c.university_id
left join public.events e on e.id = o.event_id
where
  (o.status = 'open' and public.current_partner_id() is not null)
  or exists (select 1 from public.proposals p where p.opportunity_id = o.id and p.partner_id = public.current_partner_id())
  or o.club_id = public.current_club_id()
  or public.is_admin_of_club(o.club_id)
  or public.is_site_admin();

-- Events a partner sponsors (or has a live proposal for): no budget columns.
create view public.partner_events as
select
  e.id, e.name, e.starts_at, e.ends_at, e.time_zone, e.description, e.location, e.flyer_path,
  e.approval_status, e.partner_id,
  c.id as club_id, c.name as club_name, u.name as university_name
from public.events e
join public.clubs c on c.id = e.club_id
join public.universities u on u.id = c.university_id
where e.partner_id = public.current_partner_id()
   or exists (select 1 from public.proposals p where p.event_id = e.id and p.partner_id = public.current_partner_id()
              and p.status in ('pending_club', 'pending_admin', 'approved'));

-- Conversation inbox for either side, with names and unread flag.
create view public.conversation_list as
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
  (select m.body from public.messages m where m.conversation_id = cv.id order by m.created_at desc limit 1) as last_message
from public.conversations cv
join public.clubs c on c.id = cv.club_id
join public.universities u on u.id = c.university_id
join public.partners pa on pa.id = cv.partner_id
where cv.club_id = public.current_club_id()
   or cv.partner_id = public.current_partner_id()
   or public.is_site_admin();

-- Proposals with display names, for every party.
create view public.proposal_details as
select
  p.*, pa.name as partner_name, pa.logo_path as partner_logo_path, pa.email as partner_email,
  pa.category as partner_category, c.name as club_name, c.university_id, u.name as university_name,
  o.title as opportunity_title, e.name as event_name, e.starts_at as event_starts_at,
  e.time_zone as event_time_zone, e.approval_status as event_approval_status
from public.proposals p
join public.partners pa on pa.id = p.partner_id
join public.clubs c on c.id = p.club_id
join public.universities u on u.id = c.university_id
left join public.opportunities o on o.id = p.opportunity_id
left join public.events e on e.id = p.event_id
where p.club_id = public.current_club_id()
   or p.partner_id = public.current_partner_id()
   or public.is_admin_of_club(p.club_id)
   or public.is_site_admin();

-- ---------------------------------------------------------------------------
-- Row Level Security on the base tables
-- ---------------------------------------------------------------------------
alter table public.opportunities enable row level security;
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;
alter table public.proposals     enable row level security;

revoke all on public.opportunities, public.conversations, public.messages, public.proposals,
              public.opportunity_cards, public.partner_events, public.conversation_list,
              public.proposal_details
  from anon, authenticated;

grant select on public.opportunity_cards, public.partner_events, public.conversation_list,
                public.proposal_details to authenticated;

-- ---- opportunities: clubs manage their own --------------------------------
grant select, delete on public.opportunities to authenticated;
grant insert (club_id, event_id, title, description, support_type, amount_sought, photo_path, status)
  on public.opportunities to authenticated;
grant update (event_id, title, description, support_type, amount_sought, photo_path, status)
  on public.opportunities to authenticated;

create policy "club manages own opportunities" on public.opportunities for all to authenticated
  using (club_id = (select public.current_club_id()))
  with check (club_id = (select public.current_club_id()));
create policy "admin reads university opportunities" on public.opportunities for select to authenticated
  using ((select public.is_admin_of_club(club_id)));
create policy "site admin reads opportunities" on public.opportunities for select to authenticated
  using ((select public.is_site_admin()));

-- ---- conversations: participants read; created via start_conversation ----
grant select on public.conversations to authenticated;
create policy "participants read conversations" on public.conversations for select to authenticated
  using (club_id = (select public.current_club_id()) or partner_id = (select public.current_partner_id()));
create policy "site admin reads conversations" on public.conversations for select to authenticated
  using ((select public.is_site_admin()));

-- ---- messages: participants read and post as themselves -------------------
grant select on public.messages to authenticated;
grant insert (conversation_id, sender_user_id, sender_role, body) on public.messages to authenticated;
create policy "participants read messages" on public.messages for select to authenticated
  using ((select public.conversation_role(conversation_id)) is not null);
create policy "participants send messages" on public.messages for insert to authenticated
  with check (
    sender_user_id = (select auth.uid())
    and sender_role in ('club', 'partner')
    and sender_role = public.conversation_role(conversation_id)
  );

-- ---- proposals: read-only for everyone involved; writes via RPCs ----------
grant select on public.proposals to authenticated;
create policy "club reads own proposals" on public.proposals for select to authenticated
  using (club_id = (select public.current_club_id()));
create policy "partner reads own proposals" on public.proposals for select to authenticated
  using (partner_id = (select public.current_partner_id()));
create policy "admin reads university proposals" on public.proposals for select to authenticated
  using ((select public.is_admin_of_club(club_id)));
create policy "site admin reads proposals" on public.proposals for select to authenticated
  using ((select public.is_site_admin()));

-- Opportunity photos live in the public flyers bucket (club folder rules apply).
