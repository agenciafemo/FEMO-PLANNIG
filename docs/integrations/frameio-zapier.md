# Frame.io V4 → Norteia via Zapier

Esta integração recebe comentários e mudanças do campo Status do Frame.io V4,
relacionando-os às peças do quadro de Produção pelo `file_id`.

## Segurança

- O Zapier nunca recebe a `service_role` do Supabase.
- A Edge Function deriva a organização do segredo enviado no header. Ela não
  aceita `organization_id` no body.
- Nenhum token ou payload bruto do Frame.io é salvo no banco.
- O `comment_id` forma uma chave idempotente, portanto repetir o mesmo evento
  não duplica comentários.

O secret `FRAMEIO_ZAPIER_CONNECTIONS` deve conter um JSON neste formato:

```json
[
  {
    "organization_id": "UUID_DA_ORGANIZACAO",
    "token": "SEGREDO_ALEATORIO_COM_PELO_MENOS_32_CARACTERES",
    "enabled": true
  }
]
```

O valor real nunca deve ser incluído no Git, em prints ou no frontend.

## Zap 1 — comentários

Gatilho:

- Aplicativo: `Frame.io V4`
- Evento: `Comment Created`
- Conta e Workspace: os da Agência Femo

Ação:

- Aplicativo: `Webhooks by Zapier`
- Evento: `POST`
- URL:
  `https://cdalntmqromwpnurdnle.supabase.co/functions/v1/frameio-zapier-webhook`
- Payload: JSON
- Header `x-norteia-webhook-secret`: o mesmo token configurado no secret da
  Edge Function

Campos do body:

| Campo enviado | Origem no Frame.io V4 |
| --- | --- |
| `event_type` | valor fixo `comment.created` |
| `comment_id` | ID do comentário |
| `file_id` | ID do arquivo |
| `comment_text` | Texto do comentário |
| `frame_timestamp_seconds` | Carimbo de data/hora do comentário no vídeo |
| `author_id` | ID do proprietário/autor, quando disponível |
| `author_name` | Nome do proprietário/autor, quando disponível |
| `completed_at` | Concluído em, quando disponível |
| `created_at` | Criado em |
| `updated_at` | Atualizado em |

Resposta esperada no teste:

```json
{
  "ok": true,
  "duplicate": false,
  "linked": false,
  "request_id": "..."
}
```

`linked: false` não é erro: significa que o comentário foi preservado, mas o
`file_id` ainda não foi vinculado a uma peça no editor do planejamento.

## Zap 2 — status de revisão

O Frame.io V4 disponibiliza no Zapier o gatilho `Metadata Value Updated`. Ele
prioriza mudanças do campo Status, incluindo valores como `Approved` e
`In Review`. Crie um segundo Zap; um Zap não aceita dois gatilhos.

Gatilho:

- Aplicativo: `Frame.io V4`
- Evento: `Metadata Value Updated`
- Conta e Workspace: os mesmos do Zap de comentários

Ação:

- Aplicativo: `Webhooks by Zapier`
- Evento: `POST`
- URL e header: exatamente os mesmos do Zap de comentários
- Payload: JSON

Campos do body:

| Campo enviado | Origem no Frame.io V4 |
| --- | --- |
| `event_type` | valor fixo `metadata.value.updated` |
| `file_id` | ID do arquivo afetado |
| `metadata_field_name` | valor fixo `Status` |
| `status` | novo valor do metadado (`Approved`, `In Review`, etc.) |
| `status_changed_at` | data/hora de atualização entregue pelo gatilho |

O receptor normaliza os estados conhecidos para `approved`, `in_review`,
`changes_requested` e `not_set`. Valores personalizados são preservados como
texto sanitizado. Eventos antigos não sobrescrevem um estado mais recente.

Se a mudança chegar antes de o arquivo ser vinculado, o snapshot fica em
`frameio_file_states` e é aplicado automaticamente no primeiro vínculo.

Resposta esperada:

```json
{
  "ok": true,
  "duplicate": false,
  "linked": true,
  "status": "approved",
  "request_id": "..."
}
```

Na interface, um link `next.frame.io/.../view/{file_id}` já informado como
vídeo é detectado e pré-preenche o vínculo. O selo é atualizado em até 15
segundos enquanto o editor estiver aberto.

## Ordem de entrada em produção

1. Aplicar a migration `20260827173712_frameio_zapier_integration.sql`.
2. Aplicar a migration `20260827195912_frameio_review_status.sql`.
3. Configurar `FRAMEIO_ZAPIER_CONNECTIONS` nos Secrets do projeto correto.
4. Publicar `frameio-zapier-webhook` com o import map do repositório.
5. Testar a Ação do Zap com um comentário de teste.
6. Vincular o `file_id` à peça no editor do planejamento.
7. Publicar o Zap de comentários somente após o teste retornar `ok: true`.
8. Criar e testar o Zap de status; confirme `status` na resposta.

