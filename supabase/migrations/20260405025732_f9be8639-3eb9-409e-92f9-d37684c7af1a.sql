
CREATE OR REPLACE FUNCTION public.link_team_member_on_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.team_members
  SET user_id = NEW.id
  WHERE email = LOWER(NEW.email)
  AND user_id IS NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_link_team
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.link_team_member_on_signup();
