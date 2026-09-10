# Fila: múltiplas agências e clareza de permissões

Status: solicitado em 09/09/2026; especificação de backlog, sem implementação ou alteração de permissões em produção.

Atualização: a entrada com busca/solicitação de acesso, aprovação da liderança e tratamento de falhas do contexto foi implementada localmente. Ver `login-agency-access.md` para escopo, testes e implantação pendente. Os demais itens abaixo continuam no backlog.

## Objetivo

Permitir que um mesmo login participe de duas ou mais agências e alterne entre seus painéis. Cada agência mantém clientes, equipe, planejamentos, produção, relatórios, integrações e dados administrativos independentes. Participar de uma agência não concede acesso a outra.

## Base encontrada no código local

- `OrganizationContext.tsx` já carrega múltiplos vínculos ativos e a agência selecionada.
- `CreateOrganization.tsx` e `SelectOrganization.tsx` já oferecem criação e seleção de equipe.
- A definição de `create_organization` encontrada nas migrations exige login, mas não exige perfil administrativo para criar outra agência. Validar a definição efetiva em produção antes da implementação.
- `switchOrganization` atualiza o estado antes de persistir e não trata o erro retornado pela atualização. Também não coordena limpeza de cache ou requisições em andamento.
- O contexto cai no modo legado com papel de proprietário diante de qualquer erro de carregamento. Isso não comprova acesso indevido no banco, mas não deve ser usado como recuperação de falhas no modo multiagência.
- A tela de equipe mapeia cargos a papéis técnicos. A apresentação precisa distinguir nível de acesso de função profissional.

Esses achados são de inspeção do repositório, não de teste completo do ambiente publicado.

## Escopo proposto

### 1. Criar e alternar agências

- Exibir a agência ativa no cabeçalho e oferecer um seletor com apenas vínculos ativos do usuário.
- Oferecer “Criar outra agência” a proprietários e administradores; validar autorização no servidor, além da interface.
- Manter o cadastro da primeira agência como fluxo separado de entrada, com regra explícita para não bloquear novos usuários legítimos.
- Criar agência e vínculo de proprietário de forma atômica. O criador não modifica a propriedade da agência anterior.
- Não copiar clientes, equipe, integrações ou arquivos automaticamente.
- Validar vínculo ativo ao trocar; tratar falhas de persistência, concorrência e respostas atrasadas. Alertar sobre formulários não salvos.
- Isolar chaves de cache por agência; cancelar requisições e assinaturas antigas, limpar estado sensível e navegar para uma tela válida no novo contexto.
- Em falha de autorização/carregamento, bloquear o acesso afetado com opção de tentar novamente, sem assumir proprietário legado.

### 2. Convites por agência

- Proprietários/administradores da agência de destino podem convidar um e-mail novo ou já cadastrado, inclusive de alguém que participa de outra agência.
- O aceite acrescenta um vínculo: não troca nem remove os vínculos anteriores e não copia permissões de outra agência.
- Não adicionar pessoas automaticamente nem expor diretórios de outras agências. Qualquer seleção de membros existentes deve respeitar acesso autorizado à origem.
- Exibir claramente agência, nível de acesso, validade e estado do convite. Diferenciar “link criado”, “e-mail enviado” e “convite aceito”. Hoje o fluxo gera um link; envio automático de e-mail não deve ser anunciado sem implementação e confirmação.
- Validar identidade/e-mail, expiração, revogação e uso concorrente no servidor. Evitar convites pendentes duplicados.
- Não permitir elevar alguém a proprietário por um convite comum. Tratar copropriedade em fluxo separado, autorizado e auditável.

### 3. Separar acesso de função

- **Nível de acesso:** define permissões dentro daquela agência; por exemplo Proprietário, Administrador, Gestor, Colaborador e Leitura, com matriz a validar contra os papéis existentes.
- **Função profissional:** Designer, Social mídia, Editor etc.; serve para distribuição de trabalho e filtros, sem conceder privilégios por si só.
- **Escopo de clientes:** explicitar se o membro acessa todos ou apenas os atribuídos, se esse recurso for implementado; não sugerir restrição só visual.
- O mesmo usuário pode ser administrador na agência A e colaborador na B.
- Mostrar uma descrição legível de cada nível antes de salvar. Aplicar a mesma regra no menu, nas ações e no backend/RLS.
- Validar separadamente financeiro, cofre, integrações, convites e gestão de permissões. Não substituir controles específicos do cofre por uma tag de cargo.
- Impedir autoelevação indevida e remoção/rebaixamento do último proprietário; registrar alterações administrativas sem segredos nos logs.

### 4. Preparação para planos

- Deixar preços, quantidades e planos comerciais pendentes de definição.
- Projetar limites de agências, membros e clientes com validação transacional no servidor, evitando contorno por criação concorrente.
- Definir posteriormente se a cobrança é por agência ou por conta contratante; não criar cobrança ou liberar planos ilimitados implicitamente.

## Critérios de aceite

- Um login acessa A e B; um usuário convidado somente para A não consegue consultar nem alterar dados de B por URL, API/RPC, Storage ou Realtime.
- Trocar rapidamente de agência não mostra dados atrasados da anterior nem grava um formulário na agência errada.
- Um colaborador não cria uma segunda agência pela API quando essa ação exige administração; o fluxo autorizado de primeira agência continua funcionando.
- Convite funciona para conta nova e existente, incluindo login tardio, outro e-mail, expirado, revogado, já usado e aceite concorrente.
- Revogar o vínculo remove acesso mesmo com sessão já aberta. Convites e mudanças de papel não concedem acesso cruzado.
- Funções profissionais não mudam permissões. A matriz de acesso é testada no servidor e na interface, inclusive para proprietário, administrador e colaborador.
- Clientes, dashboard, planejamento, produção, relatórios, financeiro, cofre e integrações mantêm isolamento entre duas agências de teste.

## Ordem de entrega

1. Concluir a validação do convite do Marco e corrigir o carregamento do aceite que depende do usuário autenticado. Não considerar convite pendente como acesso concedido.
2. Definir e testar a matriz de papéis, funções e escopo por agência.
3. Endurecer criação, troca e isolamento, com testes de duas agências antes de liberar a interface.
4. Liberar seletor/criação/convites com textos claros e testar ponta a ponta.
5. Adicionar limites comerciais quando planos e cobrança forem definidos.

O trabalho local de sincronização produção/dashboard permanece separado em `production-dashboard-sync-status.md`. Este documento não implica merge, deploy, criação de agência ou convite adicional.
