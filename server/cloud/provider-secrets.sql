create extension if not exists supabase_vault with schema vault;
create table if not exists tef_private.runtime_config(singleton boolean primary key default true check(singleton),enabled boolean not null default false,pricing_date text not null default '');
alter table tef_private.runtime_config enable row level security;
revoke all on tef_private.runtime_config from public,anon,authenticated;
insert into tef_private.runtime_config(singleton) values(true) on conflict do nothing;
create or replace function public.tef_configure_providers(p_hash text,p_values jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare current_state jsonb;
begin
 perform 1 from tef_private.family_config where singleton and code_hash=p_hash for update;
 if not found then raise exception 'Unauthorized';end if;
 if exists(select 1 from vault.secrets where name in ('DEEPSEEK_API_KEY','DASHSCOPE_API_KEY')) then return jsonb_build_object('configured',true,'alreadyConfigured',true);end if;
 if length(coalesce(p_values->>'deepseek','')) not between 16 and 300 or length(coalesce(p_values->>'dashscope','')) not between 16 and 300 or coalesce(p_values->>'pricingDate','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' or jsonb_typeof(p_values->'history') is distinct from 'object' then raise exception 'Provider configuration invalid';end if;
 select body into current_state from tef_private.family_state where singleton for update;
 if jsonb_array_length(current_state->'answers')<>0 or exists(select 1 from jsonb_object_keys(current_state->'pipelines')) then raise exception 'Cannot change historical baseline after cloud practice starts';end if;
 if coalesce((p_values->'history'->'deepseek'->>'reserved')::numeric,-1)<(current_state->'budget'->'deepseek'->>'reserved')::numeric or coalesce((p_values->'history'->'tts'->>'reserved')::numeric,-1)<(current_state->'budget'->'tts'->>'reserved')::numeric then raise exception 'Historical costs cannot decrease';end if;
 if coalesce((p_values->'history'->'deepseek'->>'calls')::integer,-1)<(current_state->'budget'->'deepseek'->>'calls')::integer or coalesce((p_values->'history'->'tts'->>'calls')::integer,-1)<(current_state->'budget'->'tts'->>'calls')::integer then raise exception 'Historical calls cannot decrease';end if;
 perform vault.create_secret(p_values->>'deepseek','DEEPSEEK_API_KEY','TEF backend provider key');
 perform vault.create_secret(p_values->>'dashscope','DASHSCOPE_API_KEY','TEF backend Beijing provider key');
 current_state:=jsonb_set(current_state,'{budget,deepseek}',p_values->'history'->'deepseek');current_state:=jsonb_set(current_state,'{budget,tts}',p_values->'history'->'tts');current_state:=jsonb_set(current_state,'{budget,baselineAt}',to_jsonb(p_values->'history'->>'at'));
 update tef_private.family_state set body=current_state,revision=revision+1 where singleton;
 update tef_private.runtime_config set enabled=true,pricing_date=p_values->>'pricingDate' where singleton;
 return jsonb_build_object('configured',true,'alreadyConfigured',false);
end $$;
create or replace function public.tef_provider_runtime(p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from tef_private.family_config where singleton and code_hash=p_hash) then raise exception 'Unauthorized';end if;
 return jsonb_build_object('enabled',(select enabled from tef_private.runtime_config where singleton),'pricingDate',(select pricing_date from tef_private.runtime_config where singleton),'deepseek',(select decrypted_secret from vault.decrypted_secrets where name='DEEPSEEK_API_KEY'),'dashscope',(select decrypted_secret from vault.decrypted_secrets where name='DASHSCOPE_API_KEY'));
end $$;
revoke all on function public.tef_configure_providers(text,jsonb),public.tef_provider_runtime(text) from public,anon,authenticated;
grant execute on function public.tef_configure_providers(text,jsonb),public.tef_provider_runtime(text) to service_role;
