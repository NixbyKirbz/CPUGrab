alter table public.stalls add column is_demo boolean not null default false;
-- Demo rows remain explicitly labeled even when the project is connected.
