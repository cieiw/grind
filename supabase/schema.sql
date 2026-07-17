-- Execute este arquivo uma vez no SQL Editor do seu projeto Supabase.
-- Em Authentication > Providers, habilite "Anonymous Sign-Ins".

create table if not exists public.grind_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.grind_states enable row level security;

create policy "Usuários leem apenas seus próprios dados"
on public.grind_states for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Usuários criam apenas seus próprios dados"
on public.grind_states for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Usuários atualizam apenas seus próprios dados"
on public.grind_states for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
