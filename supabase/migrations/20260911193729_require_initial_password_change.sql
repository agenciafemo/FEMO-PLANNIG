BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.password_changed_at IS
  'Momento em que a pessoa definiu a própria senha no Norteia. NULL exige a etapa de primeiro acesso.';

COMMIT;
