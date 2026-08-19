-- ============================================================================
-- Fotos de perfil dos colaboradores (avatars)
-- ----------------------------------------------------------------------------
-- 1) Bucket público "avatars" para as fotos de perfil.
-- 2) Policies de storage: qualquer um lê (público); a pessoa só escreve/edita
--    dentro da própria pasta (primeiro segmento do caminho = seu user id).
-- 3) Garante que a pessoa consiga atualizar o PRÓPRIO profile (nome + avatar)
--    pela coluna id (em produção profiles é keyed por id = auth.uid()).
-- Idempotente: pode rodar mais de uma vez sem erro.
-- ============================================================================

-- 1) Bucket -------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- 2) Policies de storage ------------------------------------------------------
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars_owner_insert" on storage.objects;
create policy "avatars_owner_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- 3) Atualizar o próprio profile (por id) ------------------------------------
drop policy if exists "profiles_self_update_by_id" on public.profiles;
create policy "profiles_self_update_by_id" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
