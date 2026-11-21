-- Reopening an approval. Until an event starts, its admin can take back an
-- approval (e.g. approved by mistake) by sending it back with a note, exactly
-- like "send back" on a pending request: it becomes "changes requested" and
-- the requester edits and resubmits.
--
--   reopen_event     an approved event → back to the club. Partnerships already
--                    approved on it stay approved (reopen them separately).
--   reopen_proposal  an approved partnership → back to the partner (who revises
--                    and resubmits; the club then accepts again). The partner
--                    comes off the event and the opportunity reopens, as with a
--                    send-back before approval.
-- Only someone who acts as the club's admin can do this (the college admins,
-- or the organization admin for a college without one).

create or replace function public.reopen_event(p_event_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  e public.events%rowtype;
  pr public.proposals%rowtype;
  v_note text := public.check_decision('send_back', p_note);
begin
  select * into e from public.events where id = p_event_id for update;
  if e.id is null or not public.is_admin_of_club(e.club_id) then raise exception 'Event not found'; end if;
  if e.approval_status <> 'approved' then raise exception 'Only approved events can be reopened'; end if;
  if e.starts_at <= now() then raise exception 'This event has already started, so its approval can no longer be changed'; end if;

  update public.events set
    approval_status = 'changes_requested', denial_reason = v_note,
    reviewed_at = now(), reviewed_by = auth.uid()
  where id = e.id;

  for pr in select * from public.proposals where event_id = e.id and status = 'approved' and conversation_id is not null loop
    insert into public.messages (conversation_id, sender_user_id, sender_role, body)
    values (pr.conversation_id, auth.uid(), 'system',
            'The university asked the club to update this event. Your partnership is still approved.');
  end loop;
end;
$$;

create or replace function public.reopen_proposal(p_proposal_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.proposals%rowtype;
  v_note text := public.check_decision('send_back', p_note);
  v_starts timestamptz;
begin
  select * into p from public.proposals where id = p_proposal_id for update;
  if p.id is null or not public.is_admin_of_club(p.club_id) then raise exception 'Partnership not found'; end if;
  if p.status <> 'approved' then raise exception 'Only approved partnerships can be reopened'; end if;
  select starts_at into v_starts from public.events where id = p.event_id;
  if v_starts is not null and v_starts <= now() then
    raise exception 'This event has already started, so its partnership can no longer be changed';
  end if;

  update public.proposals set
    status = 'changes_requested', denial_reason = v_note,
    reviewed_at = now(), reviewed_by = auth.uid()
  where id = p.id;
  update public.events set partner_id = null where id = p.event_id and partner_id = p.partner_id;
  update public.opportunities set status = 'open' where id = p.opportunity_id and status = 'filled';
  if p.conversation_id is not null then
    insert into public.messages (conversation_id, sender_user_id, sender_role, body)
    values (p.conversation_id, auth.uid(), 'system',
            'The university reopened this partnership and sent it back to the partner for changes: ' || v_note);
  end if;
end;
$$;

revoke all on function public.reopen_event(uuid, text), public.reopen_proposal(uuid, text) from public, anon;
grant execute on function public.reopen_event(uuid, text), public.reopen_proposal(uuid, text) to authenticated;
