-- ============================================================================
-- O "Financeiro" virou "Administrativo" na tela.
--
-- POR QUE SÓ OS RÓTULOS:
-- As CHAVES continuam `financeiro.ver` e `financeiro.editar`. Elas são
-- identificador interno e aparecem, hoje, dentro de 14 policies de RLS e em
-- `RequireFinanceiro`/`usePermission` no frontend. Renomear a chave obrigaria
-- a reescrever todas essas policies numa migration destrutiva (DROP + CREATE,
-- com o risco de privilégio perdido que já derrubou o OAuth da Meta esta
-- semana) para trocar um texto que ninguém vê.
--
-- O que a equipe LÊ na tela de permissões é `category`, `label` e
-- `description` — e é isso que muda aqui.
--
-- O módulo deixou de ser só dinheiro: absorveu a carteira de clientes e a
-- equipe na folha, e vai receber mais coisa administrativa. O nome antigo
-- descrevia uma parte do que ele já é.
--
-- Idempotente: só faz UPDATE de texto.
-- ============================================================================

BEGIN;

UPDATE public.permissions
   SET category    = 'Administrativo',
       label       = 'Ver o administrativo',
       description = 'Abrir a área administrativa: carteira de clientes, fluxo de caixa, mensalidades, folha de pagamento, comissões e os painéis. Inclui salário de colaborador.'
 WHERE key = 'financeiro.ver';

UPDATE public.permissions
   SET category    = 'Administrativo',
       label       = 'Editar o administrativo',
       description = 'Cadastrar cliente, lançar entradas e saídas, gerar mensalidades, fechar folha e alterar comissões e percentuais.'
 WHERE key = 'financeiro.editar';

-- Conferência: como as duas linhas ficaram.
SELECT key, category, label, default_roles
  FROM public.permissions
 WHERE key LIKE 'financeiro.%'
 ORDER BY position;

COMMIT;
