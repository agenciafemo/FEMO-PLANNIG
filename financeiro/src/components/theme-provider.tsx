// A identidade visual passou a ser a do Norteia.
//
// Antes este componente lia cor_primaria / cor_secundaria / cor_fundo da tabela
// `configuracoes` e injetava CSS em tempo de execução. Essas colunas deixaram
// de existir de propósito: com os dois produtos no mesmo banco, ter um segundo
// lugar para trocar a mesma cor garante que uma hora as duas telas ficam
// diferentes e ninguém sabe qual está certa.
//
// O componente continua existindo, e não faz nada, para não obrigar a mexer no
// __root.tsx agora. Quando o financeiro passar a herdar o tema do Norteia de
// verdade, é aqui que a ponte entra.
export function ThemeProvider() {
  return null;
}
