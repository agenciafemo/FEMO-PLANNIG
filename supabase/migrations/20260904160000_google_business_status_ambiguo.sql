-- ============================================================================
-- GOOGLE BUSINESS: status falhava com 42702 (referência ambígua).
--
-- `get_google_business_connection_status` declara `RETURNS TABLE (...)`, e em
-- plpgsql cada coluna de saída vira uma VARIÁVEL no escopo da função. A
-- checagem de acesso comparava `organization_id = _organization_id` sem
-- qualificar a tabela — e aí `organization_id` podia ser tanto a coluna de
-- `clients` quanto a variável de saída de mesmo nome. O Postgres recusa a
-- ambiguidade em tempo de execução, então a função foi criada sem erro e só
-- quebrou quando a primeira tela a chamou.
--
-- A correção é qualificar a coluna com o alias da tabela. Todas as outras
-- referências da função já eram qualificadas (`connection.`, `location.`);
-- esta era a única solta.
--
-- Idempotente: CREATE OR REPLACE. O GRANT vem junto porque recriar uma função
-- descarta os privilégios dela — foi assim que o OAuth da Meta caiu antes.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_google_business_connection_status(
  _organization_id UUID,
  _client_id UUID
)
RETURNS TABLE (
  organization_id UUID,
  client_id UUID,
  can_manage BOOLEAN,
  connection_status TEXT,
  google_account_email TEXT,
  google_location_name TEXT,
  location_title TEXT,
  store_code TEXT,
  place_id TEXT,
  selected_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  last_error_code TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_org_member(_organization_id, auth.uid())
     OR NOT EXISTS (
       -- O alias é o que desfaz a ambiguidade com a coluna de saída.
       SELECT 1 FROM public.clients AS cliente
       WHERE cliente.id = _client_id
         AND cliente.organization_id = _organization_id
     ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    _organization_id,
    _client_id,
    public.google_business_can_manage(_organization_id, auth.uid()),
    COALESCE(connection.status, 'not_connected'),
    connection.google_account_email,
    location.google_location_name,
    location.location_title,
    location.store_code,
    location.place_id,
    location.selected_at,
    connection.last_verified_at,
    connection.last_error_code
  FROM (SELECT 1) AS singleton
  LEFT JOIN public.google_business_connections AS connection
    ON connection.organization_id = _organization_id
  LEFT JOIN public.google_business_client_locations AS location
    ON location.organization_id = _organization_id
   AND location.client_id = _client_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_google_business_connection_status(UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_google_business_connection_status(UUID, UUID)
  TO authenticated;

COMMIT;
