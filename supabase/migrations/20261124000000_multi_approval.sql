-- Multi-person approval. A request can need sign-offs on several parts, each
-- handled by whoever the college assigns:
--
--   event        an event's details (always)
--   flyer        an event's flyer (when it has one)
--   partnership  partnerships (final approval and screening), opportunity
--                posts and clubs' first messages to partners
--   receipts     receipts (their own queue)
--
-- Each college admin has a checkbox per part (all on by default, so one
-- person can still do everything). If no active admin of a college holds a
-- part, any of its admins can sign it, so nothing gets stuck. An organization
-- admin stepping in for a college without admins can sign every part.
--
-- An event is approved once every part it needs is signed: its details, its
-- flyer (if any) and each partnership waiting on it. Anyone who can sign any
-- part of a request can send it back or deny it; that clears all its
-- sign-offs. When a club edits an event only the affected part needs signing
-- again (details, or the flyer); a new sponsor needs the partnership signed.

-- ---------------------------------------------------------------------------
-- Who signs what
-- ---------------------------------------------------------------------------
alter table public.department_admins
  add column can_approve_events       boolean not null default true,
  add column can_approve_flyers       boolean not null default true,
  add column can_approve_partnerships boolean not null default true,
  add column can_review_receipts      boolean not null default true;

create or replace function public.admin_has_part(p_user_id uuid, p_part text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case p_part
             when 'event' then can_approve_events
             when 'flyer' then can_approve_flyers
             when 'partnership' then can_approve_partnerships
             when 'receipts' then can_review_receipts
           end
    from public.department_admins where user_id = p_user_id), false)
$$;

-- Does any active admin of the college hold this part?
create or replace function public.part_has_holder(p_department_id uuid, p_part text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.department_admins da
    join public.profiles p on p.user_id = da.user_id and p.is_active
    where da.department_id = p_department_id and public.admin_has_part(da.user_id, p_part))
$$;

-- Can the caller sign this part for this club's requests?
create or replace function public.can_sign(p_club_id uuid, p_part text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin_of_club(p_club_id) and (
    public.current_admin_department_id() is null          -- organization admin stepping in
    or public.admin_has_part(auth.uid(), p_part)
    or not public.part_has_holder(public.club_department_id(p_club_id), p_part))
$$;

-- College admins (for their own college) and the organization admin assign parts.
create or replace function public.set_admin_parts(
  p_user_id uuid, p_events boolean, p_flyers boolean, p_partnerships boolean, p_receipts boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_dept uuid;
begin
  select department_id into v_dept from public.department_admins where user_id = p_user_id;
  if v_dept is null then raise exception 'Admin not found'; end if;
  if not (coalesce(v_dept = public.current_admin_department_id(), false)
          or public.is_org_admin_of_department(v_dept) or public.is_site_admin()) then
    raise exception 'Only this college''s admins or the organization admin can change this' using errcode = '42501';
  end if;
  update public.department_admins set
    can_approve_events = p_events, can_approve_flyers = p_flyers,
    can_approve_partnerships = p_partnerships, can_review_receipts = p_receipts
  where user_id = p_user_id;
end;
$$;

revoke all on function public.admin_has_part(uuid, text), public.part_has_holder(uuid, text) from public, anon;
revoke all on function public.can_sign(uuid, text), public.set_admin_parts(uuid, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.admin_has_part(uuid, text), public.part_has_holder(uuid, text),
  public.can_sign(uuid, text), public.set_admin_parts(uuid, boolean, boolean, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Sign-offs
-- ---------------------------------------------------------------------------
alter table public.events
  add column details_signed_by uuid references auth.users (id) on delete set null,
  add column details_signed_at timestamptz,
  add column flyer_signed_by   uuid references auth.users (id) on delete set null,
  add column flyer_signed_at   timestamptz;
alter table public.proposals
  add column signed_by uuid references auth.users (id) on delete set null,
  add column signed_at timestamptz;

-- Approved items count as signed by whoever approved them.
update public.events set details_signed_by = reviewed_by, details_signed_at = reviewed_at,
  flyer_signed_by = case when flyer_path is not null then reviewed_by end,
  flyer_signed_at = case when flyer_path is not null then reviewed_at end
where approval_status = 'approved';
update public.proposals set signed_by = reviewed_by, signed_at = reviewed_at where status = 'approved';

-- Club edits: only the affected part needs signing again.
create or replace function public.events_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  is_club boolean := public.current_user_role() = 'club';
  details_changed boolean;
  flyer_changed boolean;
  sponsor_changed boolean;
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
    details_changed := (new.name, new.starts_at, new.ends_at, new.description, new.location,
                        new.outside_sponsor_name, new.budget)
                       is distinct from (old.name, old.starts_at, old.ends_at, old.description, old.location,
                                         old.outside_sponsor_name, old.budget);
    flyer_changed := new.flyer_path is distinct from old.flyer_path;
    sponsor_changed := new.partner_id is distinct from old.partner_id;
    if details_changed then
      new.details_signed_by := null;
      new.details_signed_at := null;
    end if;
    if flyer_changed then
      new.flyer_signed_by := null;
      new.flyer_signed_at := null;
    end if;
    if old.approval_status <> 'pending' and (details_changed or flyer_changed or sponsor_changed) then
      new.approval_status := 'pending';
      new.denial_reason   := null;
      new.reviewed_at     := null;
      new.reviewed_by     := null;
    end if;
  end if;
  return new;
end;
$$;

-- Approves a pending event (and the partnerships waiting on it) once every
-- part it needs is signed. Returns whether it was approved.
create or replace function public.complete_event_if_ready(p_event_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  e public.events%rowtype;
  pr public.proposals%rowtype;
begin
  select * into e from public.events where id = p_event_id for update;
  if e.approval_status <> 'pending' or e.details_signed_at is null
     or (e.flyer_path is not null and e.flyer_signed_at is null)
     or exists (select 1 from public.proposals where event_id = e.id and status = 'pending_admin' and signed_at is null) then
    return false;
  end if;
  update public.events set approval_status = 'approved', denial_reason = null, reviewed_at = now(), reviewed_by = auth.uid()
  where id = e.id;
  for pr in
    update public.proposals set status = 'approved', denial_reason = null, reviewed_at = now(), reviewed_by = auth.uid()
    where event_id = e.id and status = 'pending_admin'
    returning *
  loop
    if pr.conversation_id is not null then
      insert into public.messages (conversation_id, sender_user_id, sender_role, body)
      values (pr.conversation_id, auth.uid(), 'system', 'The university administrator approved the event and this partnership.');
    end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.complete_event_if_ready(uuid) from public, anon, authenticated;

-- Parts of a pending event that still need signing.
create or replace function public.event_parts_waiting(p_event_id uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select array_remove(array[
    case when e.details_signed_at is null then 'event' end,
    case when e.flyer_path is not null and e.flyer_signed_at is null then 'flyer' end,
    case when exists (select 1 from public.proposals where event_id = e.id and status = 'pending_admin' and signed_at is null)
         then 'partnership' end
  ], null)
  from public.events e where e.id = p_event_id
$$;
revoke all on function public.event_parts_waiting(uuid) from public, anon;
grant execute on function public.event_parts_waiting(uuid) to authenticated;

-- Signs every part of a pending event the caller is responsible for; the
-- event is approved once nothing is left. Returns { approved, signed, waiting }.
create or replace function public.sign_event(p_event_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  e public.events%rowtype;
  v_signed text[] := '{}';
  v_approved boolean;
begin
  select * into e from public.events where id = p_event_id for update;
  if e.id is null or not public.is_admin_of_club(e.club_id) then raise exception 'Event not found'; end if;
  if e.approval_status <> 'pending' then raise exception 'This event has already been reviewed'; end if;

  if e.details_signed_at is null and public.can_sign(e.club_id, 'event') then
    update public.events set details_signed_by = auth.uid(), details_signed_at = now() where id = e.id;
    v_signed := array_append(v_signed, 'event');
  end if;
  if e.flyer_path is not null and e.flyer_signed_at is null and public.can_sign(e.club_id, 'flyer') then
    update public.events set flyer_signed_by = auth.uid(), flyer_signed_at = now() where id = e.id;
    v_signed := array_append(v_signed, 'flyer');
  end if;
  if public.can_sign(e.club_id, 'partnership') and exists (
    select 1 from public.proposals where event_id = e.id and status = 'pending_admin' and signed_at is null) then
    update public.proposals set signed_by = auth.uid(), signed_at = now()
      where event_id = e.id and status = 'pending_admin' and signed_at is null;
    v_signed := array_append(v_signed, 'partnership');
  end if;
  if cardinality(v_signed) = 0 then
    raise exception 'Nothing here is yours to approve; it is waiting for another approver';
  end if;

  v_approved := public.complete_event_if_ready(e.id);
  return json_build_object('approved', v_approved, 'signed', v_signed,
                           'waiting', coalesce(public.event_parts_waiting(e.id), '{}'));
end;
$$;
revoke all on function public.sign_event(uuid) from public, anon;
grant execute on function public.sign_event(uuid) to authenticated;

-- Can the caller sign any part of this event's request?
create or replace function public.can_sign_any_event_part(p_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_sign(e.club_id, 'event')
      or (e.flyer_path is not null and public.can_sign(e.club_id, 'flyer'))
      or (exists (select 1 from public.proposals where event_id = e.id and status in ('pending_admin', 'approved'))
          and public.can_sign(e.club_id, 'partnership'))
  from public.events e where e.id = p_event_id
$$;
revoke all on function public.can_sign_any_event_part(uuid) from public, anon, authenticated;

create or replace function public.clear_event_signoffs(p_event_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.events set details_signed_by = null, details_signed_at = null, flyer_signed_by = null, flyer_signed_at = null
  where id = p_event_id;
  update public.proposals set signed_by = null, signed_at = null where event_id = p_event_id and status <> 'approved';
$$;
revoke all on function public.clear_event_signoffs(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reviewer RPCs now check the part. The earlier versions become *_impl
-- (not callable directly) and the public names wrap them.
-- ---------------------------------------------------------------------------
alter function public.decide_event(uuid, text, text) rename to decide_event_impl;
alter function public.decide_proposal(uuid, text, text) rename to decide_proposal_impl;
alter function public.decide_opportunity(uuid, text, text) rename to decide_opportunity_impl;
alter function public.decide_conversation(uuid, text, text) rename to decide_conversation_impl;
alter function public.review_receipt(uuid, public.receipt_status, text) rename to review_receipt_impl;
alter function public.reopen_event(uuid, text) rename to reopen_event_impl;
alter function public.reopen_proposal(uuid, text) rename to reopen_proposal_impl;
revoke all on function public.decide_event_impl(uuid, text, text), public.decide_proposal_impl(uuid, text, text),
  public.decide_opportunity_impl(uuid, text, text), public.decide_conversation_impl(uuid, text, text),
  public.review_receipt_impl(uuid, public.receipt_status, text), public.reopen_event_impl(uuid, text),
  public.reopen_proposal_impl(uuid, text)
  from public, anon, authenticated;

create or replace function public.decide_event(p_event_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_decision = 'approve' then
    perform public.sign_event(p_event_id);
    return;
  end if;
  if not coalesce(public.can_sign_any_event_part(p_event_id), false) then raise exception 'Event not found'; end if;
  perform public.decide_event_impl(p_event_id, p_decision, p_note);
  perform public.clear_event_signoffs(p_event_id);
end;
$$;

create or replace function public.decide_proposal(p_proposal_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.proposals%rowtype;
  v_event_pending boolean;
begin
  select * into p from public.proposals where id = p_proposal_id;
  if p.id is null or not public.can_sign(p.club_id, 'partnership') then raise exception 'Proposal not found'; end if;
  select approval_status = 'pending' into v_event_pending from public.events where id = p.event_id;
  -- A partnership waiting on a pending event is a part of that event's approval.
  if p_decision = 'approve' and p.status = 'pending_admin' and coalesce(v_event_pending, false) then
    perform public.check_decision(p_decision, p_note);
    update public.proposals set signed_by = auth.uid(), signed_at = now() where id = p.id;
    perform public.complete_event_if_ready(p.event_id);
    return;
  end if;
  perform public.decide_proposal_impl(p_proposal_id, p_decision, p_note);
  if p_decision = 'approve' and p.status = 'pending_admin' then
    update public.proposals set signed_by = auth.uid(), signed_at = now() where id = p.id;
  elsif p_decision <> 'approve' then
    update public.proposals set signed_by = null, signed_at = null where id = p.id;
  end if;
end;
$$;

create or replace function public.decide_opportunity(p_opportunity_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce((select public.can_sign(club_id, 'partnership') from public.opportunities where id = p_opportunity_id), false) then
    raise exception 'Opportunity not found';
  end if;
  perform public.decide_opportunity_impl(p_opportunity_id, p_decision, p_note);
end;
$$;

create or replace function public.decide_conversation(p_conversation_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce((select public.can_sign(club_id, 'partnership') from public.conversations where id = p_conversation_id), false) then
    raise exception 'Message not found';
  end if;
  perform public.decide_conversation_impl(p_conversation_id, p_decision, p_note);
end;
$$;

create or replace function public.review_receipt(p_receipt_id uuid, p_status public.receipt_status, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce((select public.can_sign(club_id, 'receipts') from public.receipts where id = p_receipt_id), false) then
    raise exception 'Receipt not found';
  end if;
  perform public.review_receipt_impl(p_receipt_id, p_status, p_note);
end;
$$;

create or replace function public.reopen_event(p_event_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(public.can_sign_any_event_part(p_event_id), false) then raise exception 'Event not found'; end if;
  perform public.reopen_event_impl(p_event_id, p_note);
  perform public.clear_event_signoffs(p_event_id);
end;
$$;

create or replace function public.reopen_proposal(p_proposal_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce((select public.can_sign(club_id, 'partnership') from public.proposals where id = p_proposal_id), false) then
    raise exception 'Partnership not found';
  end if;
  perform public.reopen_proposal_impl(p_proposal_id, p_note);
  update public.proposals set signed_by = null, signed_at = null where id = p_proposal_id;
end;
$$;

revoke all on function public.decide_event(uuid, text, text), public.decide_proposal(uuid, text, text),
  public.decide_opportunity(uuid, text, text), public.decide_conversation(uuid, text, text),
  public.review_receipt(uuid, public.receipt_status, text), public.reopen_event(uuid, text),
  public.reopen_proposal(uuid, text) from public, anon;
grant execute on function public.decide_event(uuid, text, text), public.decide_proposal(uuid, text, text),
  public.decide_opportunity(uuid, text, text), public.decide_conversation(uuid, text, text),
  public.review_receipt(uuid, public.receipt_status, text), public.reopen_event(uuid, text),
  public.reopen_proposal(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- proposal_details: include the new sign-off columns (p.* is expanded when a
-- view is created, so it's recreated).
-- ---------------------------------------------------------------------------
drop view public.proposal_details;
create view public.proposal_details as
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
revoke all on public.proposal_details from anon, authenticated;
grant select on public.proposal_details to authenticated;
