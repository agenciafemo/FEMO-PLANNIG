-- Actual member-limit trigger from the existing migration; synthetic unlimited plan for baseline tests.
CREATE TABLE public.organization_plans(code text PRIMARY KEY, max_members integer);
INSERT INTO public.organization_plans VALUES ('test', 1000);
ALTER TABLE public.organizations ADD COLUMN plan_code text DEFAULT 'test';
CREATE OR REPLACE FUNCTION public.enforce_organization_member_limit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_limit INTEGER; v_count INTEGER;
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('member_limit:' || NEW.organization_id::text));
  SELECT p.max_members INTO v_limit FROM public.organizations o JOIN public.organization_plans p ON p.code = o.plan_code WHERE o.id = NEW.organization_id;
  SELECT count(*) INTO v_count FROM public.organization_members WHERE organization_id = NEW.organization_id AND status = 'active';
  IF v_limit IS NOT NULL AND v_count >= v_limit THEN
    RAISE EXCEPTION 'member_limit_reached: o plano permite no máximo % membros ativos', v_limit USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_organization_member_limit ON public.organization_members;
CREATE TRIGGER enforce_organization_member_limit BEFORE INSERT OR UPDATE OF status ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_member_limit();
