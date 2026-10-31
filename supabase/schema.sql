-- =====================================================================
-- House Hunt — database setup
-- Run this once in the gym tracker's Supabase project:
--   Dashboard → SQL Editor → New query → paste all of this → Run
--
-- Everything is prefixed hh_ so it sits alongside the gym tables
-- without touching them. Access is limited to the people listed in
-- hh_members (step 7 at the bottom), not to every login in the project.
--
-- This copy has placeholder emails so it's safe in a public repo. Your real
-- emails only ever go into the copy you paste into the SQL Editor.
-- =====================================================================


-- 1. Members: the only accounts that can see or change house hunt data
create table if not exists public.hh_members (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  added_at     timestamptz not null default now()
);
alter table public.hh_members enable row level security;
-- No policies on purpose: the app never reads this table directly.

create or replace function public.hh_is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.hh_members where user_id = auth.uid());
$$;
revoke all on function public.hh_is_member() from public;
grant execute on function public.hh_is_member() to authenticated;


-- 2. Tables
create table if not exists public.hh_agents (
  id          uuid primary key default gen_random_uuid(),
  name        text,
  agency      text,
  phone       text,
  email       text,
  notes       text not null default '',
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint hh_agents_has_name check (
    coalesce(nullif(trim(name), ''), nullif(trim(agency), '')) is not null
  )
);

create table if not exists public.hh_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.hh_properties (
  id              uuid primary key default gen_random_uuid(),
  address         text not null,
  postcode        text,
  price           integer,
  beds            smallint,
  baths           smallint,
  size_sqft       integer,
  tenure          text,
  lease_years     integer,
  service_charge  integer,          -- £ per year
  ground_rent     integer,          -- £ per year
  council_tax     text,             -- band letter
  key_features    text[] not null default '{}',
  rightmove_url   text,
  agent_id        uuid references public.hh_agents(id) on delete set null,
  status          text not null default 'shortlisted'
                  check (status in ('shortlisted','viewing_booked','viewed',
                                    'offer_made','offer_accepted','not_for_us')),
  viewing_at      timestamptz,
  lat             double precision,
  lng             double precision,
  photo_path      text,             -- path inside the hh-photos bucket
  checklist       jsonb not null default '{}'::jsonb,  -- { "<item id>": true|false }
  notes           text not null default '',
  listing_status  text,             -- as Rightmove shows it: Available, Under offer, Sold STC, Reserved
  price_history   jsonb not null default '[]'::jsonb,  -- [{ "price": 199950, "at": "2026-10-25T…" }]
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists hh_properties_agent_idx on public.hh_properties(agent_id);
-- (for anyone who ran an earlier version of this file)
alter table public.hh_properties add column if not exists listing_status text;
alter table public.hh_properties add column if not exists price_history jsonb not null default '[]'::jsonb;
-- Each of your ratings, 1 to 5 stars: { "<user id>": 4 }
alter table public.hh_properties add column if not exists ratings jsonb not null default '{}'::jsonb;

create table if not exists public.hh_offers (
  id              uuid primary key default gen_random_uuid(),
  property_id     uuid not null references public.hh_properties(id) on delete cascade,
  amount          integer not null,
  made_at         timestamptz not null default now(),
  outcome         text not null default 'waiting'
                  check (outcome in ('waiting','rejected','countered','accepted','withdrawn')),
  counter_amount  integer,          -- if the seller came back with a figure
  notes           text not null default '',
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);
create index if not exists hh_offers_property_idx on public.hh_offers(property_id);

-- Settings you both share (council tax amounts, short-lease warning, calendar link key)
create table if not exists public.hh_settings (
  key    text primary key,
  value  jsonb not null
);

-- Agent branch details (found online or pasted from an email signature)
alter table public.hh_agents add column if not exists website text;
alter table public.hh_agents add column if not exists address text;

-- Calls to agents about a flat (booking viewings), by either of you
create table if not exists public.hh_calls (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.hh_properties(id) on delete cascade,
  agent_id     uuid references public.hh_agents(id) on delete set null,
  called_at    timestamptz not null default now(),
  outcome      text not null check (outcome in ('booked','voicemail','no_answer','spoke')),
  note         text not null default '',
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists hh_calls_property_idx on public.hh_calls(property_id);
create index if not exists hh_calls_agent_idx on public.hh_calls(agent_id);

-- Listings shared from Safari, waiting to be checked and saved
create table if not exists public.hh_inbox (
  id            uuid primary key default gen_random_uuid(),
  url           text not null,
  status        text not null default 'processing'
                check (status in ('processing','ready','failed','done')),
  error         text,
  listing       jsonb,
  location      jsonb,
  agent_lookup  jsonb,
  photo_path    text,             -- inbox/… inside the hh-photos bucket
  payload       jsonb,            -- the shared page text and data, kept for "Try again"
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);


-- 3. Keep updated_at current
create or replace function public.hh_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists hh_properties_touch on public.hh_properties;
create trigger hh_properties_touch before update on public.hh_properties
  for each row execute function public.hh_touch_updated_at();

drop trigger if exists hh_agents_touch on public.hh_agents;
create trigger hh_agents_touch before update on public.hh_agents
  for each row execute function public.hh_touch_updated_at();

drop trigger if exists hh_inbox_touch on public.hh_inbox;
create trigger hh_inbox_touch before update on public.hh_inbox
  for each row execute function public.hh_touch_updated_at();


-- 4. Access rules: members only, on every table
alter table public.hh_agents          enable row level security;
alter table public.hh_checklist_items enable row level security;
alter table public.hh_properties      enable row level security;

drop policy if exists "hh members only" on public.hh_agents;
create policy "hh members only" on public.hh_agents
  for all to authenticated
  using (public.hh_is_member()) with check (public.hh_is_member());

drop policy if exists "hh members only" on public.hh_checklist_items;
create policy "hh members only" on public.hh_checklist_items
  for all to authenticated
  using (public.hh_is_member()) with check (public.hh_is_member());

drop policy if exists "hh members only" on public.hh_properties;
create policy "hh members only" on public.hh_properties
  for all to authenticated
  using (public.hh_is_member()) with check (public.hh_is_member());

alter table public.hh_offers   enable row level security;
alter table public.hh_settings enable row level security;

drop policy if exists "hh members only" on public.hh_offers;
create policy "hh members only" on public.hh_offers
  for all to authenticated
  using (public.hh_is_member()) with check (public.hh_is_member());

drop policy if exists "hh members only" on public.hh_settings;
create policy "hh members only" on public.hh_settings
  for all to authenticated
  using (public.hh_is_member()) with check (public.hh_is_member());

alter table public.hh_inbox enable row level security;
alter table public.hh_calls enable row level security;

drop policy if exists "hh members only" on public.hh_calls;
create policy "hh members only" on public.hh_calls
  for all to authenticated
  using (public.hh_is_member()) with check (public.hh_is_member());

drop policy if exists "hh members only" on public.hh_inbox;
create policy "hh members only" on public.hh_inbox
  for all to authenticated
  using (public.hh_is_member()) with check (public.hh_is_member());

grant select, insert, update, delete
  on public.hh_agents, public.hh_checklist_items, public.hh_properties,
     public.hh_offers, public.hh_settings, public.hh_inbox, public.hh_calls
  to authenticated;

-- Live updates between the two phones
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['hh_properties','hh_agents','hh_checklist_items','hh_offers','hh_settings','hh_inbox','hh_calls'] loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then null;  -- already added
      end;
    end loop;
  end if;
end $$;

-- Tick one checklist item without overwriting the other person's ticks
create or replace function public.hh_set_check(p_property uuid, p_item uuid, p_value boolean)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  update public.hh_properties
     set checklist = jsonb_set(checklist, array[p_item::text], to_jsonb(p_value), true)
   where id = p_property
  returning checklist;
$$;
grant execute on function public.hh_set_check(uuid, uuid, boolean) to authenticated;

-- Set your own star rating (0.5–5 in halves, or 0 to clear) without touching the other person's
drop function if exists public.hh_set_rating(uuid, integer);
create or replace function public.hh_set_rating(p_property uuid, p_value numeric)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  update public.hh_properties
     set ratings = case when p_value between 0.5 and 5 and p_value * 2 = trunc(p_value * 2)
                        then jsonb_set(ratings, array[auth.uid()::text], to_jsonb(p_value), true)
                        else ratings - auth.uid()::text end
   where id = p_property
  returning ratings;
$$;
grant execute on function public.hh_set_rating(uuid, numeric) to authenticated;

-- Your two names, so the app can label each rating (members only)
create or replace function public.hh_member_names()
returns table (user_id uuid, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, m.display_name from public.hh_members m
   where public.hh_is_member()
   order by m.display_name;
$$;
revoke all on function public.hh_member_names() from public;
grant execute on function public.hh_member_names() to authenticated;


-- 5. Photo storage (private bucket, members only)
insert into storage.buckets (id, name, public)
values ('hh-photos', 'hh-photos', false)
on conflict (id) do nothing;

drop policy if exists "hh photos read"   on storage.objects;
drop policy if exists "hh photos add"    on storage.objects;
drop policy if exists "hh photos change" on storage.objects;
drop policy if exists "hh photos remove" on storage.objects;

create policy "hh photos read" on storage.objects
  for select to authenticated
  using (bucket_id = 'hh-photos' and public.hh_is_member());

create policy "hh photos add" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'hh-photos' and public.hh_is_member());

create policy "hh photos change" on storage.objects
  for update to authenticated
  using (bucket_id = 'hh-photos' and public.hh_is_member())
  with check (bucket_id = 'hh-photos' and public.hh_is_member());

create policy "hh photos remove" on storage.objects
  for delete to authenticated
  using (bucket_id = 'hh-photos' and public.hh_is_member());


-- 6. Starter checklist (editable in the app later)
insert into public.hh_checklist_items (label, position)
select v.label, v.position
from (values
  ('Garden / outdoor space', 1),
  ('Second bedroom big enough', 2),
  ('Good natural light', 3),
  ('Enough storage', 4),
  ('Kitchen and bathroom in good condition', 5),
  ('No damp, mould or cracks', 6),
  ('Quiet (neighbours, road)', 7),
  ('Parking', 8),
  ('Heating, boiler and windows OK', 9),
  ('Communal areas well kept', 10)
) as v(label, position)
where not exists (select 1 from public.hh_checklist_items);


-- Shared settings: short-lease warning at 85 years, council tax amounts
-- (fill these in from the app's Settings), and private keys for the calendar
-- and for the Safari share button
insert into public.hh_settings (key, value) values
  ('lease_warning_years', '85'::jsonb),
  ('council_tax', '{}'::jsonb),
  ('calendar_key', to_jsonb(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))),
  ('import_key', to_jsonb(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')))
on conflict (key) do nothing;



-- iCloud calendar: when a viewing is booked, moved or cancelled (or the home's
-- address, price, agent or status changes), tell the hh-calendar function so it
-- updates the shared iCloud calendar. Uses pg_net, Supabase's built-in web requests.
create extension if not exists pg_net;

create or replace function public.hh_calendar_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  k text;
begin
  select value #>> '{}' into k from public.hh_settings where key = 'calendar_key';
  if k is not null then
    perform net.http_post(
      url     := 'https://wvedhcuebfdfkhfvphlb.supabase.co/functions/v1/hh-calendar',
      body    := jsonb_build_object('id', case when tg_op = 'DELETE' then old.id else new.id end),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-calendar-key', k)
    );
  end if;
  return null;
end;
$$;
revoke all on function public.hh_calendar_push() from public;

drop trigger if exists hh_properties_calendar_insert on public.hh_properties;
create trigger hh_properties_calendar_insert after insert on public.hh_properties
  for each row when (new.viewing_at is not null)
  execute function public.hh_calendar_push();

drop trigger if exists hh_properties_calendar_update on public.hh_properties;
create trigger hh_properties_calendar_update after update on public.hh_properties
  for each row when (
    old.viewing_at is distinct from new.viewing_at
    or (new.viewing_at is not null and (
      old.status is distinct from new.status
      or old.address is distinct from new.address
      or old.postcode is distinct from new.postcode
      or old.price is distinct from new.price
      or old.agent_id is distinct from new.agent_id
      or old.rightmove_url is distinct from new.rightmove_url
      or old.lat is distinct from new.lat
      or old.lng is distinct from new.lng))
  )
  execute function public.hh_calendar_push();

drop trigger if exists hh_properties_calendar_delete on public.hh_properties;
create trigger hh_properties_calendar_delete after delete on public.hh_properties
  for each row when (old.viewing_at is not null)
  execute function public.hh_calendar_push();

-- 7. Add the two of you as members.
--    Replace the emails with the ones you both sign in to the gym tracker with.
insert into public.hh_members (user_id, display_name)
select id, 'Jack' from auth.users where email = 'YOUR-EMAIL@example.com'
on conflict (user_id) do nothing;

insert into public.hh_members (user_id, display_name)
select id, 'Jakey' from auth.users where email = 'HIS-EMAIL@example.com'
on conflict (user_id) do nothing;

-- Check: this should list both of you
select m.display_name, u.email from public.hh_members m join auth.users u on u.id = m.user_id;
