-- University approval settings, and "send back for changes".
--
-- Each university admin chooses what needs their approval (university_admins):
--   require_message_approval      a club's first message to a partner     (default on)
--   require_opportunity_approval  a club's sponsorship opportunity posts  (default on)
--   require_proposal_approval     a partner's proposal, before the club
--                                 sees it                                 (default off)
--
-- Every review can now approve, deny, or send back to the requester with a
-- note ("changes_requested"); the requester edits and resubmits. This covers
-- events, partnerships, first messages, opportunities and proposal screening.
--
-- Turning a setting off only affects new submissions; anything already
-- waiting stays in the admin's queue.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
alter table public.university_admins
  add column require_message_approval     boolean not null default true,
  add column require_opportunity_approval boolean not null default true,
  add column require_proposal_approval    boolean not null default false;

grant update (require_message_approval, require_opportunity_approval, require_proposal_approval)
  on public.university_admins to authenticated;

-- Whether a club's university requires approval for p_kind
-- ('message' | 'opportunity' | 'proposal'). No admin = no approval step.
create or replace function public.approval_required(p_club_id uuid, p_kind text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select case p_kind
             when 'message' then ua.require_message_approval
             when 'opportunity' then ua.require_opportunity_approval
             when 'proposal' then ua.require_proposal_approval
           end
    from public.clubs c
    join public.university_admins ua on ua.university_id = c.university_id
    where c.id = p_club_id
  ), false)
$$;
revoke all on function public.approval_required(uuid, text) from public, anon, authenticated;

-- Validates a reviewer's decision; returns the trimmed note.
create or replace function public.check_decision(p_decision text, p_note text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_decision not in ('approve', 'send_back', 'deny') then
    raise exception 'Unknown decision';
  end if;
  if p_decision = 'send_back' and v_note is null then
    raise exception 'Add a note saying what needs to change';
  end if;
  if p_decision = 'deny' and v_note is null then
    raise exception 'A reason is required to deny';
  end if;
  if length(v_note) > 2000 then raise exception 'Keep the note under 2,000 characters'; end if;
  return v_note;
end;
$$;
revoke all on function public.check_decision(text, text) from public, anon, authenticated;

-- Club member emails: whether the club's own copy went out.
alter table public.member_emails add column club_copy boolean not null default false;

-- ---------------------------------------------------------------------------
-- Conversations: a club's first message can need approval
-- ---------------------------------------------------------------------------
alter table public.conversations
  add column approval_status public.approval_status not null default 'approved',
  add column review_note     text check (length(review_note) <= 2000),
  add column submitted_at    timestamptz not null default now(),
  add column reviewed_at     timestamptz,
  add column reviewed_by     uuid references auth.users (id) on delete set null;

create index conversations_review_idx on public.conversations (approval_status) where approval_status <> 'approved';

-- The partner side only exists once the conversation is approved.
create or replace function public.conversation_role(p_conversation_id uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when c.club_id = public.current_club_id() then 'club'
    when c.partner_id = public.current_partner_id() and c.approval_status = 'approved' then 'partner'
  end
  from public.conversations c where c.id = p_conversation_id
$$;

create or replace function public.conversation_is_open(p_conversation_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select approval_status = 'approved' from public.conversations where id = p_conversation_id), false)
$$;
revoke all on function public.conversation_is_open(uuid) from public, anon;
grant execute on function public.conversation_is_open(uuid) to authenticated;

drop policy "participants read conversations" on public.conversations;
create policy "participants read conversations" on public.conversations for select to authenticated
  using (club_id = (select public.current_club_id())
         or (partner_id = (select public.current_partner_id()) and approval_status = 'approved'));

-- Nobody adds messages until the first one is approved.
drop policy "participants send messages" on public.messages;
create policy "participants send messages" on public.messages for insert to authenticated
  with check (
    sender_user_id = (select auth.uid())
    and sender_role in ('club', 'partner')
    and sender_role = public.conversation_role(conversation_id)
    and public.conversation_is_open(conversation_id)
  );

-- ---------------------------------------------------------------------------
-- Opportunities: posts can need approval before partners see them
-- ---------------------------------------------------------------------------
alter table public.opportunities
  add column approval_status public.approval_status not null default 'approved',
  add column review_note     text check (length(review_note) <= 2000),
  add column submitted_at    timestamptz not null default now(),
  add column reviewed_at     timestamptz,
  add column reviewed_by     uuid references auth.users (id) on delete set null;

-- Sets the approval state when a club posts or edits an opportunity.
-- Editing what partners see (not just open/closed) sends it back for approval.
create or replace function public.opportunities_approval()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_required boolean;
begin
  if public.current_user_role() is distinct from 'club' then
    return new;
  end if;
  v_required := public.approval_required(new.club_id, 'opportunity');
  if tg_op = 'INSERT' then
    new.approval_status := case when v_required then 'pending'::public.approval_status else 'approved' end;
    new.review_note := null;
    new.submitted_at := now();
    return new;
  end if;
  -- Only edits to what partners see count (closing/reopening doesn't).
  if (new.title, new.description, new.support_type, new.amount_sought, new.photo_path, new.event_id)
     is distinct from (old.title, old.description, old.support_type, old.amount_sought, old.photo_path, old.event_id) then
    if old.approval_status <> 'approved' or v_required then
      new.approval_status := case when v_required then 'pending'::public.approval_status else 'approved' end;
      new.submitted_at := now();
      if new.approval_status = 'pending' then
        new.reviewed_at := null;
        new.reviewed_by := null;
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.opportunities_approval() from public, anon, authenticated;

create trigger opportunities_approval
  before insert or update on public.opportunities
  for each row execute function public.opportunities_approval();

-- ---------------------------------------------------------------------------
-- Proposals: optional screening before the club sees them
-- ---------------------------------------------------------------------------
alter table public.proposals
  add column club_visible boolean not null default true,
  add column submitted_at timestamptz not null default now();

drop policy "club reads own proposals" on public.proposals;
create policy "club reads own proposals" on public.proposals for select to authenticated
  using (club_id = (select public.current_club_id()) and club_visible);

-- Posts a proposal to the club: creates the conversation if needed and adds
-- the summary message. Used when a proposal first reaches the club.
create or replace function public.post_proposal_to_club(p_proposal_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  p public.proposals%rowtype;
  v_conv uuid;
  v_title text;
  v_summary text;
begin
  select * into p from public.proposals where id = p_proposal_id;
  v_conv := p.conversation_id;
  if v_conv is null and p.opportunity_id is not null then
    select id into v_conv from public.conversations
      where club_id = p.club_id and partner_id = p.partner_id and opportunity_id = p.opportunity_id
        and approval_status = 'approved'
      order by created_at limit 1;
  end if;
  if v_conv is null then
    select coalesce(o.title, e.name, 'Sponsorship proposal') into v_title
      from (select 1) x
      left join public.opportunities o on o.id = p.opportunity_id
      left join public.events e on e.id = p.event_id;
    insert into public.conversations (club_id, partner_id, subject, event_id, opportunity_id, started_by)
    values (p.club_id, p.partner_id, v_title, p.event_id, p.opportunity_id, 'partner')
    returning id into v_conv;
  end if;
  update public.proposals set conversation_id = v_conv, club_visible = true where id = p.id;

  v_summary := 'Sent a sponsorship proposal'
    || coalesce(': ' || nullif(concat_ws(', ',
         case when p.headcount > 0 then p.headcount || ' lunches/people covered' end,
         case when p.amount > 0 then '$' || to_char(p.amount, 'FM999G999G990D00') end,
         p.in_kind,
         case when p.student_offer is not null then 'student offer: ' || p.student_offer end,
         case when p.pitch_minutes > 0 then p.pitch_minutes || ' min to present' end), ''), '')
    || coalesce(E'\n\n' || p.message, '');
  insert into public.messages (conversation_id, sender_user_id, sender_role, body)
  select v_conv, pa.user_id, 'partner', v_summary from public.partners pa where pa.id = p.partner_id;
end;
$$;
revoke all on function public.post_proposal_to_club(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: start a conversation (replaces the earlier version: approval step,
-- and partners can only ask about approved opportunities).
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
  v_status public.approval_status := 'approved';
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
    if public.approval_required(v_club, 'message') then
      v_status := 'pending';
    end if;
  elsif v_role = 'partner' then
    v_partner := public.current_partner_id();
    select * into v_opp from public.opportunities
      where id = p_opportunity_id and status = 'open' and approval_status = 'approved';
    if v_opp.id is null then raise exception 'Opportunity not found or no longer open'; end if;
    v_club := v_opp.club_id;
    p_event_id := v_opp.event_id;
    v_subject := coalesce(v_subject, v_opp.title);
  else
    raise exception 'Only clubs and partners can start conversations';
  end if;

  insert into public.conversations (club_id, partner_id, subject, event_id, opportunity_id, started_by, approval_status)
  values (v_club, v_partner, coalesce(v_subject, 'Partnership inquiry'), p_event_id, p_opportunity_id, v_role, v_status)
  returning id into v_id;

  insert into public.messages (conversation_id, sender_user_id, sender_role, body)
  values (v_id, auth.uid(), v_role::text, btrim(p_body));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: partner submits a proposal (replaces the earlier version).
-- With screening on, the proposal waits for the university and the club
-- doesn't see it (or its message) until it's approved.
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
  v_id uuid;
  v_screen boolean;
begin
  if v_partner is null then raise exception 'Only partners can submit proposals'; end if;

  if v_opp is not null then
    select club_id, event_id into v_club, v_event
      from public.opportunities where id = v_opp and status = 'open' and approval_status = 'approved';
    if v_club is null then raise exception 'Opportunity not found or no longer open'; end if;
  elsif v_conv is not null then
    select club_id, event_id, opportunity_id into v_club, v_event, v_opp
      from public.conversations where id = v_conv and partner_id = v_partner and approval_status = 'approved';
    if v_club is null then raise exception 'Conversation not found'; end if;
  else
    raise exception 'Choose an opportunity or conversation';
  end if;

  if exists (select 1 from public.proposals where partner_id = v_partner
             and status in ('pending_review', 'pending_club', 'pending_admin', 'changes_requested')
             and ((v_opp is not null and opportunity_id = v_opp) or (v_opp is null and conversation_id = v_conv))) then
    raise exception 'You already have an open proposal for this';
  end if;

  v_screen := public.approval_required(v_club, 'proposal');
  insert into public.proposals (club_id, partner_id, opportunity_id, event_id, conversation_id, headcount,
                                amount, in_kind, student_offer, pitch_minutes, message, status, club_visible)
  values (v_club, v_partner, v_opp, v_event, v_conv, p_headcount, p_amount,
          nullif(btrim(coalesce(p_in_kind, '')), ''), nullif(btrim(coalesce(p_student_offer, '')), ''),
          p_pitch_minutes, nullif(btrim(coalesce(p_message, '')), ''),
          case when v_screen then 'pending_review'::public.proposal_status else 'pending_club' end,
          not v_screen)
  returning id into v_id;

  if not v_screen then
    perform public.post_proposal_to_club(v_id);
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: partner edits and resubmits a proposal that was sent back.
-- ---------------------------------------------------------------------------
create or replace function public.resubmit_proposal(
  p_proposal_id uuid,
  p_headcount int default null,
  p_amount numeric default null,
  p_in_kind text default null,
  p_student_offer text default null,
  p_pitch_minutes int default null,
  p_message text default null
) returns public.proposal_status
language plpgsql security definer set search_path = ''
as $$
declare
  p public.proposals%rowtype;
  v_screen boolean;
  v_new public.proposal_status;
begin
  select * into p from public.proposals
    where id = p_proposal_id and partner_id = public.current_partner_id() for update;
  if p.id is null then raise exception 'Proposal not found'; end if;
  if p.status <> 'changes_requested' then raise exception 'Only proposals sent back for changes can be resubmitted'; end if;
  if p.opportunity_id is not null and not exists (
    select 1 from public.opportunities where id = p.opportunity_id and status = 'open' and approval_status = 'approved') then
    raise exception 'This opportunity is no longer open';
  end if;

  v_screen := public.approval_required(p.club_id, 'proposal');
  v_new := case when v_screen then 'pending_review'::public.proposal_status else 'pending_club' end;
  update public.proposals set
    headcount = p_headcount, amount = p_amount,
    in_kind = nullif(btrim(coalesce(p_in_kind, '')), ''),
    student_offer = nullif(btrim(coalesce(p_student_offer, '')), ''),
    pitch_minutes = p_pitch_minutes,
    message = nullif(btrim(coalesce(p_message, '')), ''),
    status = v_new, club_visible = case when v_screen then club_visible else true end,
    denial_reason = null, reviewed_at = null, reviewed_by = null, club_responded_at = null,
    submitted_at = now()
  where id = p.id;

  if not v_screen then
    perform public.post_proposal_to_club(p.id);
  end if;
  return v_new;
end;
$$;

-- Partners can also withdraw proposals that are being screened or were sent back.
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
  if p.status not in ('pending_review', 'pending_club', 'pending_admin', 'changes_requested') then
    raise exception 'This proposal can no longer be withdrawn';
  end if;
  update public.proposals set status = 'withdrawn' where id = p.id;
  if p.status = 'pending_admin' then
    update public.events set partner_id = null where id = p.event_id and partner_id = p.partner_id;
    update public.opportunities set status = 'open' where id = p.opportunity_id and status = 'filled';
  end if;
  if p.conversation_id is not null and p.club_visible then
    insert into public.messages (conversation_id, sender_user_id, sender_role, body)
    values (p.conversation_id, auth.uid(), 'system', 'The partner withdrew the proposal.');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reviewer RPCs: p_decision = 'approve' | 'send_back' | 'deny'.
-- send_back and deny need a note; the requester sees it.
-- ---------------------------------------------------------------------------

-- Events (and partnerships waiting on the event).
create or replace function public.decide_event(p_event_id uuid, p_decision text, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  e public.events%rowtype;
  pr public.proposals%rowtype;
  v_note text := public.check_decision(p_decision, p_note);
begin
  select * into e from public.events where id = p_event_id for update;
  if e.id is null or not public.is_admin_of_club(e.club_id) then raise exception 'Event not found'; end if;
  if e.approval_status <> 'pending' then raise exception 'This event has already been reviewed'; end if;

  update public.events set
    approval_status = case p_decision when 'approve' then 'approved'::public.approval_status
                                      when 'deny' then 'denied' else 'changes_requested' end,
    denial_reason = case when p_decision = 'approve' then null else v_note end,
    reviewed_at = now(), reviewed_by = auth.uid()
  where id = e.id;

  if p_decision = 'send_back' then
    -- Partnerships on the event keep waiting and are decided when the event is.
    for pr in select * from public.proposals where event_id = e.id and status = 'pending_admin' loop
      if pr.conversation_id is not null then
        insert into public.messages (conversation_id, sender_user_id, sender_role, body)
        values (pr.conversation_id, auth.uid(), 'system',
                'The university asked the club to update the event before approving it and this partnership.');
      end if;
    end loop;
    return;
  end if;

  for pr in
    update public.proposals set
      status = case when p_decision = 'approve' then 'approved'::public.proposal_status else 'denied' end,
      denial_reason = case when p_decision = 'approve' then null else v_note end,
      reviewed_at = now(), reviewed_by = auth.uid()
    where event_id = e.id and status = 'pending_admin'
    returning *
  loop
    if p_decision = 'deny' then
      update public.events set partner_id = null where id = e.id and partner_id = pr.partner_id;
      update public.opportunities set status = 'open' where id = pr.opportunity_id and status = 'filled';
    end if;
    if pr.conversation_id is not null then
      insert into public.messages (conversation_id, sender_user_id, sender_role, body)
      values (pr.conversation_id, auth.uid(), 'system',
              case when p_decision = 'approve' then 'The university administrator approved the event and this partnership.'
                   else 'The university administrator did not approve the event: ' || v_note end);
    end if;
  end loop;
end;
$$;

-- Club resubmits an event that was sent back, without changing it.
-- (Editing the event resubmits it automatically.)
create or replace function public.resubmit_event(p_event_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.events set approval_status = 'pending', reviewed_at = null, reviewed_by = null
  where id = p_event_id and club_id = public.current_club_id() and approval_status = 'changes_requested';
  if not found then raise exception 'Only events sent back for changes can be resubmitted'; end if;
end;
$$;

-- Partnerships: screening (pending_review) or final approval (pending_admin).
create or replace function public.decide_proposal(p_proposal_id uuid, p_decision text, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  p public.proposals%rowtype;
  v_note text := public.check_decision(p_decision, p_note);
begin
  select * into p from public.proposals where id = p_proposal_id for update;
  if p.id is null or not public.is_admin_of_club(p.club_id) then raise exception 'Proposal not found'; end if;
  if p.status not in ('pending_review', 'pending_admin') then raise exception 'This partnership has already been reviewed'; end if;

  if p.status = 'pending_review' then
    update public.proposals set
      status = case p_decision when 'approve' then 'pending_club'::public.proposal_status
                               when 'deny' then 'denied' else 'changes_requested' end,
      denial_reason = case when p_decision = 'approve' then null else v_note end,
      reviewed_at = now(), reviewed_by = auth.uid()
    where id = p.id;
    if p_decision = 'approve' then
      perform public.post_proposal_to_club(p.id);
    end if;
    return;
  end if;

  -- Final approval (the club already accepted).
  update public.proposals set
    status = case p_decision when 'approve' then 'approved'::public.proposal_status
                             when 'deny' then 'denied' else 'changes_requested' end,
    denial_reason = case when p_decision = 'approve' then null else v_note end,
    reviewed_at = now(), reviewed_by = auth.uid()
  where id = p.id;

  if p_decision <> 'approve' then
    -- Take the partner back off the event and reopen the opportunity. A
    -- revised proposal goes back to the club to accept again.
    update public.events set partner_id = null where id = p.event_id and partner_id = p.partner_id;
    update public.opportunities set status = 'open' where id = p.opportunity_id and status = 'filled';
  end if;
  if p.conversation_id is not null then
    insert into public.messages (conversation_id, sender_user_id, sender_role, body)
    values (p.conversation_id, auth.uid(), 'system',
            case p_decision
              when 'approve' then 'The university administrator approved this partnership.'
              when 'deny' then 'The university administrator did not approve this partnership: ' || v_note
              else 'The university administrator sent this partnership back to the partner for changes: ' || v_note
            end);
  end if;
end;
$$;

-- Opportunities.
create or replace function public.decide_opportunity(p_opportunity_id uuid, p_decision text, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  o public.opportunities%rowtype;
  v_note text := public.check_decision(p_decision, p_note);
begin
  select * into o from public.opportunities where id = p_opportunity_id for update;
  if o.id is null or not public.is_admin_of_club(o.club_id) then raise exception 'Opportunity not found'; end if;
  if o.approval_status <> 'pending' then raise exception 'This opportunity has already been reviewed'; end if;
  update public.opportunities set
    approval_status = case p_decision when 'approve' then 'approved'::public.approval_status
                                      when 'deny' then 'denied' else 'changes_requested' end,
    review_note = case when p_decision = 'approve' then null else v_note end,
    reviewed_at = now(), reviewed_by = auth.uid()
  where id = o.id;
end;
$$;

-- Club resubmits an opportunity that was sent back, without changing it.
create or replace function public.resubmit_opportunity(p_opportunity_id uuid)
returns public.approval_status
language plpgsql security definer set search_path = ''
as $$
declare
  o public.opportunities%rowtype;
  v_new public.approval_status;
begin
  select * into o from public.opportunities
    where id = p_opportunity_id and club_id = public.current_club_id() for update;
  if o.id is null or o.approval_status <> 'changes_requested' then
    raise exception 'Only opportunities sent back for changes can be resubmitted';
  end if;
  v_new := case when public.approval_required(o.club_id, 'opportunity') then 'pending'::public.approval_status else 'approved' end;
  update public.opportunities set approval_status = v_new, submitted_at = now(), reviewed_at = null, reviewed_by = null
  where id = o.id;
  return v_new;
end;
$$;

-- First messages.
create or replace function public.decide_conversation(p_conversation_id uuid, p_decision text, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  c public.conversations%rowtype;
  v_note text := public.check_decision(p_decision, p_note);
begin
  select * into c from public.conversations where id = p_conversation_id for update;
  if c.id is null or not public.is_admin_of_club(c.club_id) then raise exception 'Message not found'; end if;
  if c.approval_status <> 'pending' then raise exception 'This message has already been reviewed'; end if;
  update public.conversations set
    approval_status = case p_decision when 'approve' then 'approved'::public.approval_status
                                      when 'deny' then 'denied' else 'changes_requested' end,
    review_note = case when p_decision = 'approve' then null else v_note end,
    reviewed_at = now(), reviewed_by = auth.uid(),
    -- Delivered now: shows as new in the partner's inbox.
    last_message_at = case when p_decision = 'approve' then now() else last_message_at end
  where id = c.id;
end;
$$;

-- Club edits (subject and first message) and resubmits a first message.
-- Also works while it's still waiting, to fix a typo.
create or replace function public.resubmit_conversation(p_conversation_id uuid, p_subject text, p_body text)
returns public.approval_status
language plpgsql security definer set search_path = ''
as $$
declare
  c public.conversations%rowtype;
  v_new public.approval_status;
  v_subject text := nullif(btrim(coalesce(p_subject, '')), '');
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
begin
  select * into c from public.conversations
    where id = p_conversation_id and club_id = public.current_club_id() for update;
  if c.id is null or c.approval_status not in ('pending', 'changes_requested') then
    raise exception 'Only messages waiting for approval or sent back can be edited';
  end if;
  if v_body is null then raise exception 'Message cannot be empty'; end if;
  if length(v_body) > 5000 then raise exception 'Keep the message under 5,000 characters'; end if;
  if v_subject is null or length(v_subject) > 200 then raise exception 'Add a subject (up to 200 characters)'; end if;

  v_new := case when public.approval_required(c.club_id, 'message') then 'pending'::public.approval_status else 'approved' end;
  update public.messages set body = v_body
    where id = (select id from public.messages where conversation_id = c.id order by created_at limit 1);
  update public.conversations set
    subject = v_subject, approval_status = v_new, submitted_at = now(),
    reviewed_at = case when v_new = 'approved' then reviewed_at end,
    last_message_at = now()
  where id = c.id;
  return v_new;
end;
$$;

-- The earlier approve/deny functions stay available (used by older pages).
create or replace function public.review_event(p_event_id uuid, p_approve boolean, p_reason text default null)
returns void
language sql security definer set search_path = ''
as $$
  select public.decide_event(p_event_id, case when p_approve then 'approve' else 'deny' end, p_reason)
$$;

create or replace function public.review_proposal(p_proposal_id uuid, p_approve boolean, p_reason text default null)
returns void
language sql security definer set search_path = ''
as $$
  select public.decide_proposal(p_proposal_id, case when p_approve then 'approve' else 'deny' end, p_reason)
$$;

revoke all on function public.decide_event(uuid, text, text) from public, anon;
revoke all on function public.decide_proposal(uuid, text, text) from public, anon;
revoke all on function public.decide_opportunity(uuid, text, text) from public, anon;
revoke all on function public.decide_conversation(uuid, text, text) from public, anon;
revoke all on function public.resubmit_event(uuid) from public, anon;
revoke all on function public.resubmit_opportunity(uuid) from public, anon;
revoke all on function public.resubmit_conversation(uuid, text, text) from public, anon;
revoke all on function public.resubmit_proposal(uuid, int, numeric, text, text, int, text) from public, anon;
grant execute on function public.decide_event(uuid, text, text) to authenticated;
grant execute on function public.decide_proposal(uuid, text, text) to authenticated;
grant execute on function public.decide_opportunity(uuid, text, text) to authenticated;
grant execute on function public.decide_conversation(uuid, text, text) to authenticated;
grant execute on function public.resubmit_event(uuid) to authenticated;
grant execute on function public.resubmit_opportunity(uuid) to authenticated;
grant execute on function public.resubmit_conversation(uuid, text, text) to authenticated;
grant execute on function public.resubmit_proposal(uuid, int, numeric, text, text, int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

-- Partners only see approved opportunities.
create or replace view public.opportunity_cards as
select
  o.id, o.title, o.description, o.support_type, o.amount_sought, o.photo_path, o.status, o.created_at,
  o.club_id, c.name as club_name, c.logo_path as club_logo_path,
  c.university_id, u.name as university_name, u.city as university_city, u.state as university_state,
  o.event_id, e.name as event_name, e.starts_at as event_starts_at, e.time_zone as event_time_zone,
  o.approval_status, o.review_note
from public.opportunities o
join public.clubs c on c.id = o.club_id
join public.profiles pr on pr.user_id = c.user_id and pr.is_active
join public.universities u on u.id = c.university_id
left join public.events e on e.id = o.event_id
where
  (o.status = 'open' and o.approval_status = 'approved' and public.current_partner_id() is not null)
  or exists (select 1 from public.proposals p where p.opportunity_id = o.id and p.partner_id = public.current_partner_id())
  or o.club_id = public.current_club_id()
  or public.is_admin_of_club(o.club_id)
  or public.is_site_admin();

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
  where o.id = p_id and o.status = 'open' and o.approval_status = 'approved'
$$;

create or replace view public.partner_events as
select
  e.id, e.name, e.starts_at, e.ends_at, e.time_zone, e.description, e.location, e.flyer_path,
  e.approval_status, e.partner_id,
  c.id as club_id, c.name as club_name, u.name as university_name
from public.events e
join public.clubs c on c.id = e.club_id
join public.universities u on u.id = c.university_id
where e.partner_id = public.current_partner_id()
   or exists (select 1 from public.proposals p where p.event_id = e.id and p.partner_id = public.current_partner_id()
              and p.status in ('pending_review', 'pending_club', 'pending_admin', 'changes_requested', 'approved'));

-- Inbox: partners only see approved conversations; status columns added.
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
  cv.approval_status, cv.review_note
from public.conversations cv
join public.clubs c on c.id = cv.club_id
join public.universities u on u.id = c.university_id
join public.partners pa on pa.id = cv.partner_id
where cv.club_id = public.current_club_id()
   or (cv.partner_id = public.current_partner_id() and cv.approval_status = 'approved')
   or public.is_site_admin();

-- Proposal details: the club only sees proposals that reached it.
drop view public.proposal_details;
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
where (p.club_id = public.current_club_id() and p.club_visible)
   or p.partner_id = public.current_partner_id()
   or public.is_admin_of_club(p.club_id)
   or public.is_site_admin();
revoke all on public.proposal_details from anon, authenticated;
grant select on public.proposal_details to authenticated;

-- First messages for the university admin to review (and recently decided).
create view public.message_reviews as
select
  cv.id, cv.subject, cv.club_id, cv.partner_id, cv.event_id, cv.approval_status, cv.review_note,
  cv.submitted_at, cv.reviewed_at,
  c.name as club_name, pa.name as partner_name, pa.category as partner_category,
  pa.city as partner_city, pa.state as partner_state, e.name as event_name,
  (select m.body from public.messages m where m.conversation_id = cv.id order by m.created_at limit 1) as body
from public.conversations cv
join public.clubs c on c.id = cv.club_id
join public.partners pa on pa.id = cv.partner_id
left join public.events e on e.id = cv.event_id
where cv.started_by = 'club'
  and (cv.approval_status <> 'approved' or cv.reviewed_at is not null)
  and (public.is_admin_of_club(cv.club_id) or public.is_site_admin());
revoke all on public.message_reviews from anon, authenticated;
grant select on public.message_reviews to authenticated;
