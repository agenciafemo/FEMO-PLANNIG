// Quais canais entram no relatório, e como buscá-los de uma vez só.
//
// Antes, montar um relatório era clicar em quatro botões espalhados pela tela,
// na ordem certa, e torcer para não esquecer nenhum. O que faltava não era
// mais um botão — era alguém decidir ANTES o que o relatório cobre, e uma ação
// só que vá buscar exatamente isso.

import type { MetaInsights } from "@/lib/reportRpc";
import type { AdsInsights } from "@/lib/adsRpc";
import type { GoogleAdsInsights } from "@/lib/googleAds";
import type { GoogleBusinessInsights } from "@/lib/googleBusiness";

export type CanalId =
  | "instagram"
  | "facebook"
  | "meta_ads"
  | "google_ads"
  | "google_business";

export type CanalDef = {
  id: CanalId;
  label: string;
  descricao: string;
  /** Agrupa na tela: o que é alcance orgânico e o que é investimento. */
  grupo: "organico" | "pago";
};

export const CANAIS: CanalDef[] = [
  {
    id: "instagram",
    label: "Instagram",
    descricao: "Alcance, engajamento e seguidores",
    grupo: "organico",
  },
  {
    id: "facebook",
    label: "Facebook",
    descricao: "Página: seguidores e alcance",
    grupo: "organico",
  },
  {
    id: "google_business",
    label: "Google Meu Negócio",
    descricao: "Busca e Maps, sem mídia paga",
    grupo: "organico",
  },
  {
    id: "meta_ads",
    label: "Meta Ads",
    descricao: "Campanhas no Instagram e Facebook",
    grupo: "pago",
  },
  {
    id: "google_ads",
    label: "Google Ads",
    descricao: "Campanhas na Busca e no Display",
    grupo: "pago",
  },
];

export const TODOS_OS_CANAIS: CanalId[] = CANAIS.map((canal) => canal.id);

/**
 * Instagram e Facebook chegam na MESMA resposta da `meta-insights` — o
 * Facebook vem como uma seção dentro dela. Quem não souber disso escreve duas
 * buscas e paga duas vezes pela mesma chamada.
 */
export const CANAIS_DA_META: CanalId[] = ["instagram", "facebook"];

export type ResultadoCanal = {
  id: CanalId;
  status: "ok" | "vazio" | "erro";
  /** Frase curta para a tela quando não deu certo. */
  motivo?: string;
};

export type DadosDoRelatorio = {
  instagram: MetaInsights | null;
  /** O Facebook não tem dado próprio: é uma fatia do payload da Meta. */
  incluiFacebook: boolean;
  metaAds: AdsInsights | null;
  googleAds: GoogleAdsInsights | null;
  googleBusiness: GoogleBusinessInsights | null;
  resultados: ResultadoCanal[];
};

export type ColetoresDeCanal = {
  meta: () => Promise<MetaInsights>;
  metaAds: () => Promise<AdsInsights>;
  googleAds: () => Promise<GoogleAdsInsights>;
  googleBusiness: () => Promise<GoogleBusinessInsights>;
};

function motivoDe(erro: unknown): string {
  const bruto = erro instanceof Error ? erro.message : String(erro ?? "");
  return bruto.trim() || "falha desconhecida";
}

/**
 * Busca os canais escolhidos em paralelo e devolve o que veio.
 *
 * `allSettled`, não `all`: um cliente que não anuncia no Google não pode
 * impedir o relatório do Instagram de existir. Cada canal responde por si, e o
 * que falhou volta nomeado — "Google Ads: conta não vinculada" diz o que fazer,
 * enquanto um erro único no topo da tela só diz que algo deu errado.
 */
export async function coletarCanais(
  canais: CanalId[],
  coletores: ColetoresDeCanal,
): Promise<DadosDoRelatorio> {
  const escolhidos = new Set(canais);
  const resultados: ResultadoCanal[] = [];

  const precisaDaMeta = CANAIS_DA_META.some((canal) => escolhidos.has(canal));

  const [meta, metaAds, googleAds, googleBusiness] = await Promise.all([
    precisaDaMeta ? Promise.allSettled([coletores.meta()]) : null,
    escolhidos.has("meta_ads") ? Promise.allSettled([coletores.metaAds()]) : null,
    escolhidos.has("google_ads") ? Promise.allSettled([coletores.googleAds()]) : null,
    escolhidos.has("google_business")
      ? Promise.allSettled([coletores.googleBusiness()])
      : null,
  ]);

  const metaResultado = meta?.[0];
  const dadosMeta = metaResultado?.status === "fulfilled" ? metaResultado.value : null;

  if (escolhidos.has("instagram")) {
    resultados.push(
      dadosMeta
        ? { id: "instagram", status: "ok" }
        : {
          id: "instagram",
          status: "erro",
          motivo: metaResultado?.status === "rejected"
            ? motivoDe(metaResultado.reason)
            : "sem resposta",
        },
    );
  }

  if (escolhidos.has("facebook")) {
    // A `meta-insights` traz o Facebook como best-effort: se a página não
    // estiver conectada, o campo volta nulo SEM erro. Sem esta distinção, a
    // tela diria "ok" para um canal que não trouxe nada.
    const temFacebook = !!dadosMeta?.facebook;
    resultados.push(
      temFacebook
        ? { id: "facebook", status: "ok" }
        : {
          id: "facebook",
          status: dadosMeta ? "vazio" : "erro",
          motivo: dadosMeta
            ? "nenhuma página do Facebook conectada a este cliente"
            : metaResultado?.status === "rejected"
              ? motivoDe(metaResultado.reason)
              : "sem resposta",
        },
    );
  }

  const simples = [
    { id: "meta_ads" as const, res: metaAds?.[0] },
    { id: "google_ads" as const, res: googleAds?.[0] },
    { id: "google_business" as const, res: googleBusiness?.[0] },
  ];
  for (const { id, res } of simples) {
    if (!escolhidos.has(id)) continue;
    resultados.push(
      res?.status === "fulfilled"
        ? { id, status: "ok" }
        : {
          id,
          status: "erro",
          motivo: res?.status === "rejected" ? motivoDe(res.reason) : "sem resposta",
        },
    );
  }

  const valorDe = <T,>(
    lista: PromiseSettledResult<T>[] | null,
    incluido: boolean,
  ): T | null => {
    if (!incluido) return null;
    const primeiro = lista?.[0];
    return primeiro?.status === "fulfilled" ? primeiro.value : null;
  };

  return {
    // O payload da Meta só entra se o Instagram foi escolhido. Marcar Facebook
    // sozinho não deve arrastar o relatório inteiro do Instagram junto.
    instagram: escolhidos.has("instagram") ? dadosMeta : null,
    incluiFacebook: escolhidos.has("facebook") && !!dadosMeta?.facebook,
    metaAds: valorDe(metaAds, escolhidos.has("meta_ads")),
    googleAds: valorDe(googleAds, escolhidos.has("google_ads")),
    googleBusiness: valorDe(googleBusiness, escolhidos.has("google_business")),
    resultados: ordenarComoNaTela(resultados),
  };
}

function ordenarComoNaTela(resultados: ResultadoCanal[]): ResultadoCanal[] {
  const ordem = new Map(TODOS_OS_CANAIS.map((id, index) => [id, index]));
  return [...resultados].sort(
    (a, b) => (ordem.get(a.id) ?? 0) - (ordem.get(b.id) ?? 0),
  );
}

export function rotuloDoCanal(id: CanalId): string {
  return CANAIS.find((canal) => canal.id === id)?.label ?? id;
}

/** Resumo de uma linha para o toast depois de gerar. */
export function resumoDaColeta(resultados: ResultadoCanal[]): string {
  const ok = resultados.filter((r) => r.status === "ok");
  const problemas = resultados.filter((r) => r.status !== "ok");
  if (problemas.length === 0) {
    return `${ok.length} ${ok.length === 1 ? "canal" : "canais"} no relatório.`;
  }
  const nomes = problemas.map((r) => rotuloDoCanal(r.id)).join(", ");
  return ok.length > 0
    ? `${ok.length} de ${resultados.length} canais. Sem dados: ${nomes}.`
    : `Nenhum canal respondeu: ${nomes}.`;
}
