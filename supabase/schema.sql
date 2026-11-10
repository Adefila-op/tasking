create extension if not exists pgcrypto;

create type public.payment_status as enum ('pending', 'approved', 'rejected', 'duplicate');
create type public.subscription_status as enum ('active', 'expired', 'suspended', 'revoked');
create type public.device_status as enum ('active', 'blocked', 'transferred');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email_verified boolean not null default false,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12,2) not null,
  currency text not null default 'UGX',
  payment_reference text not null,
  payment_method text not null default 'bank_transfer',
  receipt_url text,
  status public.payment_status not null default 'pending',
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, payment_reference)
);

create table public.activation_codes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  payment_id uuid not null references public.payments(id) on delete cascade,
  code_hash text not null unique,
  issued_at timestamptz not null default now(),
  redeemed_at timestamptz,
  redeemed_by uuid references public.profiles(id),
  expires_at timestamptz not null default (now() + interval '365 days'),
  status text not null default 'unused' check (status in ('unused', 'redeemed', 'revoked')),
  created_by uuid references public.profiles(id)
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  installation_id text not null,
  device_name text,
  device_platform text,
  status public.device_status not null default 'active',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  unique (customer_id, installation_id)
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  payment_id uuid references public.payments(id),
  device_id uuid references public.devices(id),
  status public.subscription_status not null default 'active',
  activated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  renewal_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  object_type text,
  object_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid references public.devices(id),
  event_type text not null check (event_type in ('activation', 'usage', 'renewal', 'device_lock', 'login')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.system_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute procedure public.handle_updated_at();

create trigger trg_payments_updated_at
before update on public.payments
for each row execute procedure public.handle_updated_at();

create trigger trg_subscriptions_updated_at
before update on public.subscriptions
for each row execute procedure public.handle_updated_at();

create trigger trg_settings_updated_at
before update on public.system_settings
for each row execute procedure public.handle_updated_at();

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.hash_activation_code(code text)
returns text
language sql
stable
as $$
  select encode(digest(code, 'sha256'), 'hex');
$$;

create or replace function public.redeem_activation_code(p_customer_id uuid, p_code text, p_device_id uuid)
returns public.subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  code_record record;
  sub public.subscriptions%rowtype;
  current_expiry timestamptz;
  next_renewal_count integer;
begin
  select * into code_record
  from public.activation_codes
  where customer_id = p_customer_id
    and status = 'unused'
    and code_hash = public.hash_activation_code(p_code)
    and redeemed_at is null
  for update;

  if not found then
    raise exception 'Invalid or already redeemed activation code';
  end if;

  if p_device_id is null then
    raise exception 'Device is required for activation';
  end if;

  if not exists (select 1 from public.devices where id = p_device_id and customer_id = p_customer_id and status = 'active') then
    raise exception 'This device is not authorized for this customer';
  end if;

  select expires_at into current_expiry
  from public.subscriptions
  where customer_id = p_customer_id
  order by expires_at desc
  limit 1;

  if current_expiry is null or current_expiry <= now() then
    next_renewal_count := 1;
    insert into public.subscriptions (customer_id, payment_id, device_id, status, activated_at, expires_at, renewal_count)
    values (p_customer_id, code_record.payment_id, p_device_id, 'active', now(), now() + interval '14 days', next_renewal_count)
    returning * into sub;
  else
    next_renewal_count := coalesce((select max(renewal_count) from public.subscriptions where customer_id = p_customer_id), 0) + 1;
    insert into public.subscriptions (customer_id, payment_id, device_id, status, activated_at, expires_at, renewal_count)
    values (p_customer_id, code_record.payment_id, p_device_id, 'active', now(), current_expiry + interval '14 days', next_renewal_count)
    returning * into sub;
  end if;

  update public.activation_codes
  set redeemed_at = now(), redeemed_by = auth.uid(), status = 'redeemed'
  where id = code_record.id;

  insert into public.audit_logs(actor_id, action, object_type, object_id, metadata)
  values (p_customer_id, 'activation_redeemed', 'activation_code', code_record.id, jsonb_build_object('device_id', p_device_id, 'expires_at', sub.expires_at, 'renewal_count', next_renewal_count));

  return sub;
end;
$$;

alter table public.profiles enable row level security;
alter table public.payments enable row level security;
alter table public.activation_codes enable row level security;
alter table public.devices enable row level security;
alter table public.subscriptions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.system_settings enable row level security;

create policy "Profiles read own record" on public.profiles
for select using (auth.uid() = id or public.is_admin());

create policy "Profiles can update self" on public.profiles
for update using (auth.uid() = id);

create policy "Payments customer self service" on public.payments
for select using (auth.uid() = customer_id or public.is_admin());

create policy "Payments customer insert" on public.payments
for insert with check (auth.uid() = customer_id and status = 'pending');

create policy "Payments admin management" on public.payments
for update using (public.is_admin())
with check (public.is_admin());

create policy "Activation codes admin read" on public.activation_codes
for select using (public.is_admin());

create policy "Activation code redemption by customer" on public.activation_codes
for update using (customer_id = auth.uid())
with check (customer_id = auth.uid());

create policy "Devices self read" on public.devices
for select using (auth.uid() = customer_id or public.is_admin());

create policy "Devices self manage" on public.devices
for insert with check (auth.uid() = customer_id);

create policy "Devices admin control" on public.devices
for update using (public.is_admin())
with check (public.is_admin());

create policy "Subscriptions self read" on public.subscriptions
for select using (auth.uid() = customer_id or public.is_admin());

create policy "Subscriptions admin control" on public.subscriptions
for update using (public.is_admin())
with check (public.is_admin());

create policy "Audit logs admin read" on public.audit_logs
for select using (public.is_admin());

create policy "Usage events self read" on public.usage_events
for select using (auth.uid() = customer_id or public.is_admin());

create policy "Usage events self insert" on public.usage_events
for insert with check (auth.uid() = customer_id);

create policy "System settings admin read" on public.system_settings
for select using (public.is_admin());

create policy "System settings admin update" on public.system_settings
for update using (public.is_admin())
with check (public.is_admin());
