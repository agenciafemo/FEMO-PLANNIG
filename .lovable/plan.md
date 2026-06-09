

# Formulário de Criar Planejamento: Adicionar Todos os Tipos + Remover Templates

## O que muda

O dialog "Novo Planejamento" atualmente tem sliders para Posts e Stories + seletor de Template. A mudança:

1. **Remover** toda a seção de Template (select, query de templates, estado `selectedTemplate`, lógica de `template_posts`)
2. **Adicionar sliders** para todos os tipos de conteúdo: Posts, Reels, Carrossel, Stories, Blog
3. A mutation `createPlanning` gera os posts com os tipos corretos baseado nas quantidades escolhidas

## Alterações em `src/pages/Plannings.tsx`

**Remover:**
- Query `templates` (linhas 56-64)
- Estado `selectedTemplate` (linha 66)
- Constante `showManualCounts` (linha 161)
- Seção do Select de Template no form (linhas 201-214)
- Lógica de `templatePosts` na mutation (linhas 78-93)
- Import `Layers` (não mais necessário isoladamente)

**Adicionar:**
- Estados: `reelsCount`, `carouselCount`, `blogCount` (todos iniciando em 0)
- 5 sliders sempre visíveis: Posts (0-20), Reels (0-20), Carrossel (0-20), Stories (0-30), Blog (0-10)
- Ícones apropriados: Image (posts), Film (reels), LayoutGrid (carrossel), Layers (stories), FileText (blog)
- Na mutation, gerar posts de cada tipo na quantidade definida, com positions sequenciais

