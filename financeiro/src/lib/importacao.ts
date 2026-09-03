import { supabase } from "@/integrations/supabase/client";
import { comOrganizacao, organizacaoAtiva } from "@/lib/organizacao";

// Carga do extrato. O que este módulo protege é uma coisa só: importar o mesmo
// arquivo duas vezes não pode duplicar o histórico.

export interface LinhaImportada {
  descricao: string;
  valor: number;
  data: string;
  tipo: "Entrada" | "Saída";
  /** Categoria vinda do próprio arquivo, quando existir. */
  categoria?: string;
}

export interface ResultadoImportacao {
  loteId: string;
  gravados: number;
  repetidos: number;
}

/**
 * Identidade de uma linha do arquivo.
 *
 * `ocorrencia` é o que separa repetições legítimas de duplicação: dois almoços
 * de R$ 40 no mesmo dia são dois lançamentos de verdade, e ganham hashes #0 e
 * #1. Reimportar o arquivo produz exatamente os mesmos dois hashes, então
 * nenhum entra de novo — sem nunca descartar o segundo almoço.
 */
async function hashLinha(linha: LinhaImportada, ocorrencia: number): Promise<string> {
  const texto = [
    linha.data,
    linha.valor.toFixed(2),
    linha.tipo,
    linha.descricao.trim().toLowerCase(),
    ocorrencia,
  ].join("|");

  const bytes = new TextEncoder().encode(texto);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Garante as categorias que o arquivo menciona e devolve nome → id.
 *
 * Jogar anos de extrato numa categoria só ("Importado") deixa o analítico sem
 * nada para analisar. Quando o arquivo traz a categoria, ela é aproveitada.
 */
async function resolverCategorias(nomes: string[]): Promise<Map<string, string>> {
  const organizationId = await organizacaoAtiva();

  const { data: existentes, error } = await supabase
    .from("categorias")
    .select("id, nome")
    .eq("organization_id", organizationId);
  // Sem tratar o erro, uma leitura barrada por RLS viraria "nenhuma categoria
  // existe" e a carga inteira entraria sem classificação.
  if (error) throw new Error(error.message);

  const porNome = new Map<string, string>();
  for (const c of existentes ?? []) porNome.set(c.nome.trim().toLowerCase(), c.id);

  const faltando = nomes.filter((n) => !porNome.has(n.trim().toLowerCase()));
  if (faltando.length > 0) {
    const { data: criadas, error: erroCriar } = await supabase
      .from("categorias")
      .insert(await comOrganizacao(faltando.map((nome) => ({ nome, tipo: "Ambos" as const }))))
      .select("id, nome");
    if (erroCriar) throw new Error(erroCriar.message);
    for (const c of criadas ?? []) porNome.set(c.nome.trim().toLowerCase(), c.id);
  }

  return porNome;
}

/**
 * Grava a carga. Devolve quantas linhas entraram e quantas o banco recusou por
 * já existirem — esse número é a informação útil ao reimportar um arquivo
 * corrigido: diz o que era novidade.
 */
export async function importarLancamentos(
  linhas: LinhaImportada[],
): Promise<ResultadoImportacao> {
  const loteId = crypto.randomUUID();

  const nomesCategorias = [
    ...new Set(linhas.map((l) => l.categoria?.trim()).filter((n): n is string => !!n)),
  ];
  const categorias = await resolverCategorias(
    nomesCategorias.length > 0 ? nomesCategorias : ["Importado"],
  );
  const idPadrao = categorias.get("importado") ?? null;

  // Conta as repetições dentro do arquivo para numerar a ocorrência.
  const vistas = new Map<string, number>();
  const registros = [];
  for (const linha of linhas) {
    const chave = `${linha.data}|${linha.valor}|${linha.tipo}|${linha.descricao}`;
    const ocorrencia = vistas.get(chave) ?? 0;
    vistas.set(chave, ocorrencia + 1);

    registros.push({
      tipo: linha.tipo,
      categoria_id: linha.categoria
        ? (categorias.get(linha.categoria.trim().toLowerCase()) ?? idPadrao)
        : idPadrao,
      descricao: linha.descricao,
      data_lancamento: linha.data,
      valor: linha.valor,
      status_pagamento: "Pago" as const,
      import_hash: await hashLinha(linha, ocorrencia),
      import_lote_id: loteId,
    });
  }

  let gravados = 0;
  const TAMANHO_LOTE = 200;
  for (let i = 0; i < registros.length; i += TAMANHO_LOTE) {
    const { data, error } = await supabase
      .from("lancamentos_financeiros")
      // ignoreDuplicates transforma a repetição em silêncio no banco, em vez de
      // um erro no meio da carga que deixaria metade do extrato importado.
      .upsert(await comOrganizacao(registros.slice(i, i + TAMANHO_LOTE)), {
        onConflict: "organization_id,import_hash",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) throw new Error(error.message);
    gravados += data?.length ?? 0;
  }

  return { loteId, gravados, repetidos: registros.length - gravados };
}

/** Desfaz uma carga inteira. Existe para o caso do arquivo errado. */
export async function desfazerImportacao(loteId: string): Promise<number> {
  const { data, error } = await supabase
    .from("lancamentos_financeiros")
    .delete()
    .eq("import_lote_id", loteId)
    .select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}
