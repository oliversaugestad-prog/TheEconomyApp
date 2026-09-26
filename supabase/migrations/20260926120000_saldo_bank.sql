-- Saldo: lagring av brukerdata og Enable Banking-tilkoblinger.
-- Tabeller uten policyer er bare tilgjengelige for service_role (Edge Functions).

-- Hvem som får bruke bankfunksjonene (fylles inn manuelt, ikke i koden).
create table public.allowed_users (
  email text primary key
);
alter table public.allowed_users enable row level security;

-- Ikke-hemmelige innstillinger for serveren (f.eks. Enable Banking-applikasjonens ID).
create table public.app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;

-- Brukerens Saldo-data (kontoer, transaksjoner, abonnementer, regler, innstillinger).
create table public.user_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.user_state enable row level security;
create policy "Egen data: lese" on public.user_state for select to authenticated using ((select auth.uid()) = user_id);
create policy "Egen data: opprette" on public.user_state for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Egen data: endre" on public.user_state for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Egen data: slette" on public.user_state for delete to authenticated using ((select auth.uid()) = user_id);

-- Midlertidig tilstand under innlogging hos banken (knytter tilbakekallet til riktig bruker).
create table public.eb_auth_states (
  state uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  aspsp_name text not null,
  aspsp_country text not null,
  created_at timestamptz not null default now()
);
alter table public.eb_auth_states enable row level security;

-- Samtykker (sesjoner) hos Enable Banking. Sesjons-ID-en forlater aldri serveren.
create table public.eb_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id text not null,
  aspsp_name text not null,
  aspsp_country text not null,
  valid_until timestamptz,
  status text not null default 'active', -- active | revoked | expired
  accounts jsonb not null default '[]'::jsonb,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index eb_sessions_user_idx on public.eb_sessions (user_id);
alter table public.eb_sessions enable row level security;

-- Privat nøkkel lagres kryptert i Supabase Vault. Kun service_role kan kalle disse.
create or replace function public.eb_set_key(p_pem text, p_app_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'eb_private_key';
  if v_id is null then
    perform vault.create_secret(p_pem, 'eb_private_key', 'Enable Banking privat nøkkel');
  else
    perform vault.update_secret(v_id, p_pem);
  end if;
  insert into public.app_config (key, value, updated_at) values ('eb_app_id', p_app_id, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;

create or replace function public.eb_get_key()
returns table (pem text, app_id text)
language sql
security definer
set search_path = ''
as $$
  select
    (select decrypted_secret from vault.decrypted_secrets where name = 'eb_private_key' limit 1),
    (select value from public.app_config where key = 'eb_app_id');
$$;

revoke all on function public.eb_set_key(text, text) from public, anon, authenticated;
revoke all on function public.eb_get_key() from public, anon, authenticated;
grant execute on function public.eb_set_key(text, text) to service_role;
grant execute on function public.eb_get_key() to service_role;
