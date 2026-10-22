-- Kofix Photography Studio — run once in Supabase SQL Editor
create extension if not exists pgcrypto;

create table if not exists settings (
  id int primary key default 1 check (id = 1),
  confirm_rule text not null default 'deposit' check (confirm_rule in ('manual','deposit','full')),
  deposit_amount text not null default '',
  payment_instructions text not null default ''
);
insert into settings (id) values (1) on conflict do nothing;

create table if not exists packages (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  name text not null,
  shots int,
  includes text not null default '',
  regular_price numeric,
  promo_price numeric,
  description text not null default '',
  terms text not null default '',
  photo text not null default '',
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  package_id uuid not null references packages(id) on delete restrict,
  slot_no int check (slot_no between 1 and 6),
  status text not null default 'pending' check (status in ('pending','confirmed','cancelled','refunded')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','deposit_paid','paid','refunded')),
  name text not null, phone text not null, email text,
  pref_date date, location text, notes text,
  admin_seen boolean not null default false,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
-- A slot number can never be used twice inside the same package:
create unique index if not exists one_slot_per_package on bookings (package_id, slot_no) where slot_no is not null;
create index if not exists bookings_pkg_status on bookings (package_id, status);

-- Create a PENDING request (no slot used). Refuses full / inactive packages and duplicates.
create or replace function create_booking(p_package uuid, p_name text, p_phone text, p_email text,
  p_date date, p_location text, p_notes text) returns bookings
language plpgsql security definer set search_path = public as $$
declare pk packages; b bookings; n int;
begin
  select * into pk from packages where id = p_package for update;
  if not found or not pk.active then raise exception 'PACKAGE_UNAVAILABLE'; end if;
  select count(*) into n from bookings where package_id = p_package and status = 'confirmed';
  if n >= 6 then raise exception 'PROMO_FULL'; end if;
  if exists (select 1 from bookings where package_id = p_package and phone = p_phone and status in ('pending','confirmed'))
    then raise exception 'DUPLICATE'; end if;
  insert into bookings (ref, package_id, name, phone, email, pref_date, location, notes)
  values ('KPS-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6)),
          p_package, p_name, p_phone, p_email, p_date, p_location, p_notes)
  returning * into b;
  return b;
end $$;

-- Confirm: row-locks the package, enforces the payment rule, assigns the lowest free slot 1..6.
create or replace function confirm_booking(p_id uuid) returns bookings
language plpgsql security definer set search_path = public as $$
declare b bookings; s settings; slot int;
begin
  select * into b from bookings where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform 1 from packages where id = b.package_id for update;   -- serialises concurrent confirms
  select * into b from bookings where id = p_id for update;
  if b.status = 'confirmed' then return b; end if;
  if b.status in ('cancelled','refunded') then raise exception 'NOT_CONFIRMABLE'; end if;
  select * into s from settings where id = 1;
  if s.confirm_rule = 'full' and b.payment_status <> 'paid' then raise exception 'PAYMENT_REQUIRED'; end if;
  if s.confirm_rule = 'deposit' and b.payment_status not in ('deposit_paid','paid') then raise exception 'PAYMENT_REQUIRED'; end if;
  select min(g) into slot from generate_series(1,6) g
    where not exists (select 1 from bookings x where x.package_id = b.package_id and x.slot_no = g);
  if slot is null then raise exception 'PROMO_FULL'; end if;
  update bookings set status = 'confirmed', slot_no = slot, confirmed_at = now() where id = p_id returning * into b;
  return b;
end $$;

-- Lock everything down: only the server (service-role key) can touch data.
alter table settings enable row level security;
alter table packages enable row level security;
alter table bookings enable row level security;
revoke all on function create_booking(uuid,text,text,text,date,text,text) from public, anon, authenticated;
revoke all on function confirm_booking(uuid) from public, anon, authenticated;
