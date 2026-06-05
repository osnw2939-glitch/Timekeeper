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

create or replace function issue_ticket(
  p_business_date date,
  p_estimated_return_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings daily_settings%rowtype;
  v_actual_number integer;
  v_card_number integer;
  v_offset integer;
  v_unavailable integer[];
  v_ticket tickets%rowtype;
begin
  insert into daily_settings (business_date)
  values (p_business_date)
  on conflict (business_date) do nothing;

  select *
    into v_settings
    from daily_settings
   where business_date = p_business_date
   for update;

  select coalesce(max(actual_number), 0) + 1
    into v_actual_number
    from tickets
   where business_date = p_business_date;

  select coalesce(array_agg(card_number), '{}')
    into v_unavailable
    from tickets
   where business_date = p_business_date
     and status <> 'canceled'
     and card_recovered_at is null;

  for v_offset in 0..(v_settings.card_count - 1) loop
    v_card_number := ((v_settings.next_card_number + v_offset - 1) % v_settings.card_count) + 1;
    if not (v_card_number = any(v_unavailable))
       and not (v_card_number = any(v_settings.skipped_card_numbers)) then
      exit;
    end if;
    v_card_number := null;
  end loop;

  if v_card_number is null then
    raise exception 'No reusable card is available';
  end if;

  insert into tickets (
    business_date,
    actual_number,
    card_number,
    status,
    estimated_return_at
  )
  values (
    p_business_date,
    v_actual_number,
    v_card_number,
    'waiting',
    p_estimated_return_at
  )
  returning * into v_ticket;

  update daily_settings
     set next_card_number = ((v_card_number) % v_settings.card_count) + 1
   where business_date = p_business_date
   returning * into v_settings;

  return jsonb_build_object(
    'ticket', to_jsonb(v_ticket),
    'settings', to_jsonb(v_settings)
  );
end;
$$;

revoke execute on function issue_ticket(date, timestamptz) from public;
grant execute on function issue_ticket(date, timestamptz) to service_role;
