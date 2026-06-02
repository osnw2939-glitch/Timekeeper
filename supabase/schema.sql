create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  actual_number integer not null,
  card_number integer not null,
  status text not null check (status in ('waiting', 'no_show', 'admitted', 'canceled')),
  issued_at timestamptz not null default now(),
  estimated_return_at timestamptz,
  admitted_at timestamptz,
  no_show_at timestamptz,
  canceled_at timestamptz,
  card_recovered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_date, actual_number)
);

create index if not exists tickets_business_date_status_idx
  on tickets (business_date, status, actual_number);

alter table tickets enable row level security;

create table if not exists daily_settings (
  business_date date primary key,
  card_count integer not null default 300,
  next_card_number integer not null default 1,
  skipped_card_numbers integer[] not null default '{}',
  open_time time not null default '09:00',
  opening_batch_size integer not null default 7,
  first_after_open_wait_minutes integer not null default 15,
  bootstrap_admitted_count integer not null default 30,
  bootstrap_interval_minutes numeric not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table daily_settings enable row level security;

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists tickets_set_updated_at on tickets;
create trigger tickets_set_updated_at
before update on tickets
for each row execute procedure set_updated_at();

drop trigger if exists daily_settings_set_updated_at on daily_settings;
create trigger daily_settings_set_updated_at
before update on daily_settings
for each row execute procedure set_updated_at();
