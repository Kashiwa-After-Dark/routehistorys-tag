-- Supabase（PostgreSQL）用のテーブル例
-- 管理ページのCSVを Table Editor →「Import data from CSV」でそのまま取り込める列名にしてあります
create table if not exists public.observations (
  id             uuid primary key,
  "user"         text not null,
  datetime_local timestamptz not null,
  epoch_ms       bigint not null,
  age            text not null check (age in ('15-18','19-22','23-34','35-64','65+')),
  "group"        text not null check ("group" in ('CP','FM','GG','BG','XG','MX','G','B')),
  group_label    text,
  gender         text,
  count_min      smallint not null check (count_min between 1 and 30),
  count_max      smallint not null check (count_max between 1 and 30 and count_max >= count_min),
  note           text,
  who            text,
  place          text,
  action         text,
  feeling        text,
  device_lat     double precision,
  device_lng     double precision,
  device_acc_m   double precision,
  gpx_lat        double precision,
  gpx_lng        double precision,
  gpx_diff_sec   double precision,
  gpx_file       text,
  server_time    timestamptz
);

create index if not exists observations_time_idx  on public.observations (datetime_local);
create index if not exists observations_group_idx on public.observations ("group");
