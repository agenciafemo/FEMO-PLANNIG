---
name: project-norteia-padroes-ux
description: Padrões de UX/produto do Norteia que qualquer proposta de novo módulo deve seguir (grid de clientes → detalhe, IA sob demanda, sininho best-effort, kanban de Tarefas)
metadata:
  type: project
---

Convenções de produto observadas no Norteia que novas features devem respeitar:
- Módulos com IA (Relatórios) seguem o padrão **grid de clientes → seleção → geração sob demanda** (`enabled: false` no React Query, o usuário clica para gerar). IA nunca roda sozinha ao abrir a tela.
- O sininho de notificações é **best-effort**: falhas são silenciosas, nunca quebram a tela. Notificação sempre tem destinatário (`user_id`) ou é broadcast.
- Tarefas é kanban (todo/doing/done) com `priority`, `due_date`, cliente, responsável e subtarefas.
- Sidebar tem ~8 itens; adicionar item novo exige justificar o custo de navegação.

**Why:** o dono valoriza consistência visual/fluxo entre módulos; propostas que inventam um padrão novo geram retrabalho.

**How to apply:** ao propor um módulo novo, espelhar essas convenções em vez de desenhar do zero. Ver [[project-transcritor-reunioes]] como exemplo de proposta feita nesse molde.
