BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN theme_preference TEXT NOT NULL DEFAULT 'system';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_theme_preference_valid
  CHECK (theme_preference IN ('light', 'dark', 'system'));

COMMIT;
