-- Husk hvilken adresse (savest.no eller github.io) banktilkoblingen ble startet fra.
alter table public.eb_auth_states add column if not exists return_url text;
