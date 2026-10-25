-- Fresh TEFListening project only. No learner data or actual credentials in this file.
create schema if not exists tef_private;
revoke all on schema tef_private from public,anon,authenticated;
create table tef_private.family_config(singleton boolean primary key default true check(singleton),code_hash text not null check(code_hash ~ '^[a-f0-9]{64}$'));
create table tef_private.family_state(singleton boolean primary key default true check(singleton),revision bigint not null default 0,body jsonb not null);
create table tef_private.rate_windows(bucket text primary key,started timestamptz not null,n integer not null);
alter table tef_private.family_config enable row level security;
alter table tef_private.family_state enable row level security;
alter table tef_private.rate_windows enable row level security;
revoke all on all tables in schema tef_private from public,anon,authenticated;

create or replace function public.tef_gate(p_hash text,p_peer text) returns jsonb language plpgsql security definer set search_path='' as $$
declare valid boolean; k text; count_now integer; limit_now integer; minute_now timestamptz:=date_trunc('minute',now());
begin
 select code_hash=p_hash into valid from tef_private.family_config where singleton;
 k:=case when valid then 'family' else 'invalid:'||p_peer end;
 limit_now:=case when valid then 600 else 20 end;
 insert into tef_private.rate_windows(bucket,started,n) values(k,minute_now,1)
 on conflict(bucket) do update set started=excluded.started,n=case when tef_private.rate_windows.started=excluded.started then tef_private.rate_windows.n+1 else 1 end returning n into count_now;
 delete from tef_private.rate_windows where started<now()-interval '1 hour';
 return jsonb_build_object('allowed',coalesce(valid,false) and count_now<=limit_now,'status',case when count_now>limit_now then 429 when coalesce(valid,false) then 200 else 401 end);
end $$;

create or replace function public.tef_read(p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from tef_private.family_config where singleton and code_hash=p_hash) then raise exception 'Unauthorized';end if;
 return (select jsonb_build_object('revision',revision,'body',body) from tef_private.family_state where singleton);
end $$;

create or replace function public.tef_cas(p_hash text,p_expected bigint,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare current_row tef_private.family_state%rowtype;old_answer jsonb;old_first record;old_reservation record;new_reservation jsonb;counter bigint:=0;ds numeric;tts numeric;
begin
 if not exists(select 1 from tef_private.family_config where singleton and code_hash=p_hash) then raise exception 'Unauthorized';end if;
 select * into current_row from tef_private.family_state where singleton for update;
 if current_row.revision<>p_expected then return jsonb_build_object('committed',false,'revision',current_row.revision);end if;
 if p_body->>'version' is distinct from '1' or jsonb_typeof(p_body->'answers') is distinct from 'array' or jsonb_typeof(p_body->'first') is distinct from 'object' or jsonb_typeof(p_body->'budget') is distinct from 'object' or jsonb_typeof(p_body->'budget'->'reservations') is distinct from 'object' then raise exception 'Invalid state';end if;
 if jsonb_array_length(p_body->'answers')<jsonb_array_length(current_row.body->'answers') then raise exception 'Answers are append-only';end if;
 for old_answer in select value from jsonb_array_elements(current_row.body->'answers') loop
  if old_answer is distinct from p_body->'answers'->counter::integer then raise exception 'Answers are immutable';end if;counter:=counter+1;
 end loop;
 for old_first in select key,value from jsonb_each(current_row.body->'first') loop
  if old_first.value is distinct from p_body->'first'->old_first.key then raise exception 'First answers are immutable';end if;
 end loop;
 if p_body->'budget'->'baselineAt' is distinct from current_row.body->'budget'->'baselineAt' then raise exception 'Budget baseline is immutable';end if;
 if p_body->'budget'->'deepseek' is distinct from current_row.body->'budget'->'deepseek' or p_body->'budget'->'tts' is distinct from current_row.body->'budget'->'tts' then raise exception 'Historical costs are immutable';end if;
 for old_reservation in select key,value from jsonb_each(current_row.body->'budget'->'reservations') loop
  new_reservation:=p_body->'budget'->'reservations'->old_reservation.key;
  if new_reservation is null or new_reservation->'provider' is distinct from old_reservation.value->'provider' or new_reservation->'cost' is distinct from old_reservation.value->'cost' or old_reservation.value->'settled'='true'::jsonb and new_reservation->'settled' is distinct from 'true'::jsonb then raise exception 'Reservations cannot be removed or reduced';end if;
 end loop;
 for new_reservation in select value from jsonb_each(p_body->'budget'->'reservations') loop
  if coalesce(new_reservation->>'provider','') not in ('deepseek','tts') or jsonb_typeof(new_reservation->'cost') is distinct from 'number' or (new_reservation->>'cost')::numeric<=0 then raise exception 'Invalid reservation';end if;
 end loop;
 select coalesce(sum((value->>'cost')::numeric) filter(where value->>'provider'='deepseek'),0),coalesce(sum((value->>'cost')::numeric) filter(where value->>'provider'='tts'),0) into ds,tts from jsonb_each(p_body->'budget'->'reservations');
 update tef_private.family_state set body=p_body,revision=revision+1 where singleton;
 return jsonb_build_object('committed',true,'revision',current_row.revision+1);
end $$;

revoke all on function public.tef_gate(text,text),public.tef_read(text),public.tef_cas(text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.tef_gate(text,text),public.tef_read(text),public.tef_cas(text,bigint,jsonb) to service_role;

insert into storage.buckets(id,name,public) values('tef-private','tef-private',false) on conflict(id) do nothing;
-- No anon/authenticated Storage policies: only the code-verified Edge backend serves private objects.
