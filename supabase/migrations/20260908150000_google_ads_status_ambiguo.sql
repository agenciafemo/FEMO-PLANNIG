-- ============================================================================
-- GOOGLE ADS: status falhava com 42702 (referência ambígua).
--
-- Mesmo defeito que a 20260904160000 corrigiu no Perfil da Empresa — e chegou
-- aqui porque a fundação do Ads foi espelhada a partir da migration ORIGINAL
-- do Business (20260904145829), não da versão já corrigida.
--
-- `get_google_ads_connection_status` declara `RETURNS TABLE (...)`, e em
-- plpgsql cada coluna de saída vira uma VARIÁVEL no escopo da função. A
-- checagem de acesso comparava `organization_id = _organization_id` sem
-- qualificar a tabela — `organization_id` podia ser tanto a coluna de `clients`
-- quanto a variável de saída de mesmo nome. O Postgres recusa a ambiguidade em
-- tempo de EXECUÇÃO: a função é criada sem erro e só quebra quando a primeira
-- tela a chama. Por isso a conexão OAuth funcionou e a leitura de status não.
--
-- Idempotente: CREATE OR REPLACE. O GRANT vem junto porque recriar uma função
-- descarta os privilégios dela.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_google_ads_connection_status(
  _organization_id UUID,
  _client_id UUID
)
RETURNS TABLE (
  organization_id UUID,
  client_id UUID,
  can_manage BOOLEAN,
  connection_status TEXT,
  google_account_email TEXT,
  customer_id TEXT,
  descriptive_name TEXT,
  currency_code TEXT,
  time_zone TEXT,
  selected_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  last_error_code TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
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
    public.google_ads_can_manage(_organization_id, auth.uid()),
    COALESCE(connection.status, 'not_connected'),
    connection.google_account_email,
    account.customer_id,
    account.descriptive_name,
    account.currency_code,
    account.time_zone,
    account.selected_at,
    connection.last_verified_at,
    connection.last_error_code
  FROM (SELECT 1) AS singleton
  LEFT JOIN public.google_ads_connections AS connection
    ON connection.organization_id = _organization_id
  LEFT JOIN public.google_ads_client_accounts AS account
    ON account.organization_id = _organization_id
   AND account.client_id = _client_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_google_ads_connection_status(UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_google_ads_connection_status(UUID, UUID)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- Conferência: a função EXECUTA sem estourar.
--
-- Chamar a função planeja e roda o corpo inteiro, e o 42702 é erro de PLANO —
-- ele estoura mesmo com a condição curto-circuitando. Ou seja: se esta consulta
-- devolver linha, a ambiguidade acabou. É a diferença entre "a função existe"
-- (o que o CREATE já garantia) e "a função funciona".
--
-- `com_status_visivel` vem ZERO aqui, e isso é o esperado: no SQL Editor não
-- há sessão de usuário, `auth.uid()` é nulo e a função devolve vazio por
-- segurança. Quem prova o conteúdo é a tela, não este SELECT.
-- ---------------------------------------------------------------------------
SELECT
  count(*)                        AS clientes_testados,
  count(status.connection_status) AS com_status_visivel
FROM public.clients AS c
LEFT JOIN LATERAL public.get_google_ads_connection_status(c.organization_id, c.id)
  AS status ON TRUE;

COMMIT;
