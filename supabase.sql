-- 在 Supabase Dashboard -> SQL Editor 中完整运行一次。

create extension if not exists pgcrypto;

create table if not exists public.zine_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  record_key text not null check (char_length(record_key) between 1 and 1024),
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  unique (user_id, record_key)
);

alter table public.zine_records enable row level security;

grant select, insert, update, delete on public.zine_records to authenticated;

drop policy if exists "Users can read their own zine records" on public.zine_records;
create policy "Users can read their own zine records"
on public.zine_records for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own zine records" on public.zine_records;
create policy "Users can insert their own zine records"
on public.zine_records for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own zine records" on public.zine_records;
create policy "Users can update their own zine records"
on public.zine_records for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own zine records" on public.zine_records;
create policy "Users can delete their own zine records"
on public.zine_records for delete
to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.set_zine_record_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_zine_record_updated_at on public.zine_records;
create trigger set_zine_record_updated_at
before update on public.zine_records
for each row execute function public.set_zine_record_updated_at();

insert into storage.buckets (id, name, public, file_size_limit)
values ('zine-media', 'zine-media', false, 52428800)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

drop policy if exists "Zine users can read their own media" on storage.objects;
create policy "Zine users can read their own media"
on storage.objects for select
to authenticated
using (
  bucket_id = 'zine-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Zine users can upload their own media" on storage.objects;
create policy "Zine users can upload their own media"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'zine-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Zine users can update their own media" on storage.objects;
create policy "Zine users can update their own media"
on storage.objects for update
to authenticated
using (
  bucket_id = 'zine-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'zine-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Zine users can delete their own media" on storage.objects;
create policy "Zine users can delete their own media"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'zine-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
