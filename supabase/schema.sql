-- =========================================================
-- 가계부 데이터베이스 설정
-- Supabase 대시보드 → SQL Editor → New query 에 전체를 붙여넣고 Run
-- (여러 번 실행해도 안전하도록 작성되어 있습니다)
-- =========================================================

-- 1) 카테고리
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 30),
  type       text not null check (type in ('expense', 'income')),
  color      text not null default '#8a8a8a' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now()
);

-- 2) 기록 (카테고리에 기록이 남아 있으면 카테고리 삭제 불가)
create table if not exists public.entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date        date not null,
  type        text not null check (type in ('expense', 'income')),
  category_id uuid not null references public.categories(id) on delete restrict,
  amount      bigint not null check (amount > 0 and amount <= 1000000000000),
  memo        text not null default '' check (char_length(memo) <= 200),
  created_at  timestamptz not null default now()
);
create index if not exists entries_user_date_idx on public.entries (user_id, date);

-- 3) 배경 사진 (key = 'YYYY-MM' 월별 사진 또는 'default' 기본 사진)
create table if not exists public.backgrounds (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key     text not null check (key ~ '^(\d{4}-\d{2}|default)$'),
  path    text not null,
  primary key (user_id, key)
);

-- 4) 행 단위 보안: 본인 데이터만 보고/쓸 수 있음
alter table public.categories  enable row level security;
alter table public.entries     enable row level security;
alter table public.backgrounds enable row level security;

drop policy if exists "own categories"  on public.categories;
drop policy if exists "own entries"     on public.entries;
drop policy if exists "own backgrounds" on public.backgrounds;

create policy "own categories" on public.categories
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own entries" on public.entries
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.categories c
                where c.id = category_id and c.user_id = (select auth.uid()) and c.type = entries.type)
  );

create policy "own backgrounds" on public.backgrounds
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 5) 회원가입 시 기본 카테고리 자동 생성
create or replace function public.create_default_categories()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.categories (user_id, name, type, color) values
    (new.id, '식비',      'expense', '#e8835a'),
    (new.id, '카페/간식', 'expense', '#c49a6c'),
    (new.id, '교통',      'expense', '#5a8de8'),
    (new.id, '쇼핑',      'expense', '#d16ba5'),
    (new.id, '생활/주거', 'expense', '#7bb37a'),
    (new.id, '문화/여가', 'expense', '#9b7be8'),
    (new.id, '기타',      'expense', '#8a8a8a'),
    (new.id, '월급',      'income',  '#2e9e6b'),
    (new.id, '부수입',    'income',  '#4fb3a9');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_categories on auth.users;
create trigger on_auth_user_created_categories
  after insert on auth.users
  for each row execute function public.create_default_categories();

-- 6) 배경 사진 저장소 (비공개, 15MB 제한, 이미지만)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('backgrounds', 'backgrounds', false, 15728640,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- 각 사용자는 자기 폴더(<user id>/...)의 파일만 다룰 수 있음
drop policy if exists "bg read own"   on storage.objects;
drop policy if exists "bg insert own" on storage.objects;
drop policy if exists "bg update own" on storage.objects;
drop policy if exists "bg delete own" on storage.objects;

create policy "bg read own" on storage.objects for select to authenticated
  using (bucket_id = 'backgrounds' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "bg insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'backgrounds' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "bg update own" on storage.objects for update to authenticated
  using (bucket_id = 'backgrounds' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "bg delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'backgrounds' and (storage.foldername(name))[1] = (select auth.uid())::text);
