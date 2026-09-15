# WhatsApp fora do horário — implantação

Mensagens que clientes mandam para o WhatsApp da agência fora do atendimento
(seg–sex, 8h30–17h30) viram **resumo + tarefas pela função** às 8h30 do dia útil
seguinte, com aviso no sininho. Toda a equipe vê em **WhatsApp** no menu. O texto
das mensagens é apagado em **30 dias** (contador na tela); resumos e tarefas
ficam.

Estudo e decisões: `docs/estudo-whatsapp-e-permissoes.md`.

## Etapa atual: validação com o número de teste da Meta

O número final da agência (**+55 48 3198-0572**) está no app WhatsApp Business
do celular. Ligá-lo à API mantendo o celular (coexistência) exige que o Norteia
seja **Tech Provider aprovado** pela Meta. Até lá, tudo é validado com o
**número de teste gratuito** que a Meta dá a cada app — o código é o mesmo.

---

## 1. Banco

No SQL Editor de produção, rode o arquivo inteiro:

```text
supabase/migrations/20260915120000_whatsapp_fora_do_horario.sql
```

A conferência final tem **14 linhas, todas com `ok = true`**.

## 2. Segredos

Gere dois textos aleatórios longos (ex.: um gerador de senha, 40+ caracteres):
um **verify token** e um **segredo interno**.

Edge Functions (CLI):

```bash
npx supabase@latest secrets set WHATSAPP_VERIFY_TOKEN=<verify-token> WHATSAPP_INTERNAL_SECRET=<segredo-interno> --project-ref cdalntmqromwpnurdnle
```

Vault (SQL Editor) — é o que o agendamento das 8h30 usa para chamar a função:

```sql
select vault.create_secret('https://cdalntmqromwpnurdnle.supabase.co/functions/v1/whatsapp-resumo', 'whatsapp_resumo_url');
select vault.create_secret('<o mesmo segredo interno>', 'whatsapp_internal_secret');
```

O `GEMINI_API_KEY` e o `META_APP_SECRET` já existem.

## 3. Edge Functions

```powershell
npx supabase@latest functions deploy whatsapp-webhook --project-ref cdalntmqromwpnurdnle --import-map supabase/functions/deno.json --use-api
npx supabase@latest functions deploy whatsapp-resumo --project-ref cdalntmqromwpnurdnle --import-map supabase/functions/deno.json --use-api
```

## 4. App da Meta (Norteia Publishing QA)

1. **Adicionar produto → WhatsApp** (se ainda não tiver).
2. **WhatsApp → Configuração da API**: anote o **Phone number ID** do número de
   teste e cadastre em "Para" o celular de quem vai testar (recebe um código).
3. **WhatsApp → Configuração → Webhook**:
   - URL de retorno: `https://cdalntmqromwpnurdnle.supabase.co/functions/v1/whatsapp-webhook`
   - Token de verificação: o **verify token** do passo 2
   - Clique em **Verificar e salvar**, depois **Gerenciar** e assine o campo
     **`messages`**.

## 5. Ligar o número à agência

No SQL Editor, com o Phone number ID do passo 4:

```sql
insert into public.whatsapp_connections (organization_id, phone_number_id, display_phone_number, is_test_number)
select o.id, '<PHONE_NUMBER_ID>', '<número de teste exibido>', true
from public.organizations o
where o.name ilike 'femo%'
returning id;
```

## 6. Testar

1. Do celular cadastrado, mande mensagens para o número de teste. Elas aparecem
   em **WhatsApp → Mensagens** em até 1 minuto.
2. Durante o expediente elas não ficam "fora do horário". Para testar agora,
   feche o horário por alguns minutos:

   ```sql
   insert into public.whatsapp_business_hours (organization_id, opens_at, closes_at)
   select organization_id, '08:30', '08:31' from public.whatsapp_connections
   on conflict (organization_id) do update set opens_at = excluded.opens_at, closes_at = excluded.closes_at;
   ```

   Mande novas mensagens (as antigas já foram gravadas como dentro do horário),
   depois clique em **Gerar resumo agora**. Confira o resumo, as tarefas em
   **Tarefas** (tag `whatsapp`) e o aviso no sininho de quem recebeu.
3. Volte o horário:

   ```sql
   update public.whatsapp_business_hours set opens_at = '08:30', closes_at = '17:30';
   ```

4. Em **Contatos**, ligue o número a um cliente: as próximas tarefas nascem no
   quadro dele.

## Como a tarefa escolhe o responsável

A IA escolhe, entre as **funções da equipe** (Administrativo → Equipe), a de
quem executa. Entre as pessoas com essa função, vai para quem tem **menos tarefas
abertas**. Sem função que sirva, vai para o dono (ou ADM) da agência, que
redistribui.

## Limites conhecidos

- Feriados não são considerados (dia útil = seg–sex).
- Áudio, figurinha e mídia sem legenda entram como `[audio]`, `[sticker]`… — a
  IA não ouve áudio nesta fase.
- Grupos do WhatsApp não entram (limitação da Meta).
- O resumo roda às 8h30 fixo (UTC-3), mesmo que o horário da agência mude.

## Depois: número da agência

Quando o Norteia for **Tech Provider** aprovado (verificação da empresa + App
Review de `whatsapp_business_messaging` e `whatsapp_business_management`), o
número +55 48 3198-0572 entra pelo **Embedded Signup com coexistência**: troca
o `phone_number_id` em `whatsapp_connections` e marca `is_test_number = false`.
Aí também é preciso assinar o campo **`smb_message_echoes`** no webhook (as
respostas que a equipe manda pelo celular), que o código já entende.
