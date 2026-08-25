---
name: project-transcritor-reunioes
description: Pesquisa/proposta de UX (25/08/2026) para módulo "Reuniões" (transcrição de Google Meet → ata/resumo/itens de ação) no Norteia — decisões de nomenclatura e recomendação contra sala de vídeo própria
metadata:
  type: project
---

Em 25/08/2026 o dono pediu pesquisa de UX (sem código) para avaliar um transcritor de reuniões no Norteia. Recomendação entregue: nomear o módulo **"Reuniões"** (não "Atas"), reaproveitar o Calendário de equipe (`team_events` já tem `meeting_link`) como ponto de entrada, e o sininho (`notifications`, tipo `team_event`) como canal de aviso. Recomendação forte: **NÃO construir sala de vídeo própria** — só transcrever o Meet via bot API (Recall.ai ~$0.50/h + $0.15/h transcrição) ou, no futuro, ler a transcrição nativa do Gemini.

**Why:** desde março/2026 o Google Meet marca bots de terceiros como "potential risk" e exige admissão manual — isso muda o desenho do onboarding (precisa avisar o usuário) e é o principal risco técnico da feature. Sala própria custaria SDK (Daily/LiveKit) + atrito de fazer o cliente da agência sair do Meet.

**How to apply:** se a conversa voltar a esse tema, partir daí em vez de repesquisar; validar antes se as restrições do Meet mudaram e se o módulo já existe em `src/pages`. Relaciona-se com [[project-norteia-padroes-ux]].
