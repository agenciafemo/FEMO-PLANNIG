import { supabase } from "@/integrations/supabase/client";

// A carteira passou a ser a do Norteia. O nome e a data de entrada moram em
// `clients`; o que é dinheiro mora em `client_financeiro`, ligada 1:1.
//
// Este módulo existe para que essa junção aconteça num lugar só. As telas
// continuam consumindo um objeto achatado com `nome` e `data_entrada` — se cada
// uma tivesse que fazer o join e ler `row.clients.name`, seriam 46 pontos de
// exibição para mudar, e 46 chances de divergir.

export type StatusCliente = "Ativo" | "Churn";

/** A forma que as telas consomem. Achatada de propósito. */
export interface Cliente {
  id: string;
  nome: string;
  /** Vem de clients.agency_since. É dela que sai o tempo de casa na comissão. */
  data_entrada: string;
  status: StatusCliente;
  data_saida: string | null;
  /** Quando a situação mudou. O cálculo de churn do mês depende dela. */
  data_status_alterado: string | null;
  data_aniversario: string | null;
  valor_mensalidade: number;
  is_recorrente: boolean;
  dia_vencimento: number;
  pct_social_media: number;
  pct_trafego: number;
  socios: string[];
  id_cliente_asaas: string | null;
}

/**
 * Campos que a tela edita.
 *
 * `data_entrada` entra aqui porque a carteira vai ser cadastrada com clientes
 * que já são de casa há anos — sem poder informar desde quando, todo mundo
 * nasceria com zero meses e a tabela progressiva de LTV pagaria a faixa
 * errada. O nome continua de fora: esse é o cadastro do Norteia.
 */
export type ClienteFinanceiroInput = Omit<Cliente, "id" | "nome">;

const SELECT =
  "client_id, status, data_saida, data_status_alterado, data_aniversario, valor_mensalidade, is_recorrente, " +
  "dia_vencimento, pct_social_media, pct_trafego, socios, id_cliente_asaas, " +
  "clients!inner(name, agency_since)";

type LinhaJoin = {
  client_id: string;
  status: StatusCliente;
  data_saida: string | null;
  data_status_alterado: string | null;
  data_aniversario: string | null;
  valor_mensalidade: number;
  is_recorrente: boolean;
  dia_vencimento: number;
  pct_social_media: number;
  pct_trafego: number;
  socios: string[];
  id_cliente_asaas: string | null;
  clients: { name: string; agency_since: string | null } | null;
};

function achatar(linha: LinhaJoin): Cliente {
  return {
    id: linha.client_id,
    nome: linha.clients?.name ?? "",
    // Cliente sem data de entrada preenchida no Norteia: string vazia em vez de
    // null mantém a forma que as telas esperam, e o campo aparece vazio para
    // alguém completar — em vez de quebrar a página.
    data_entrada: linha.clients?.agency_since ?? "",
    status: linha.status,
    data_saida: linha.data_saida,
    data_status_alterado: linha.data_status_alterado,
    data_aniversario: linha.data_aniversario,
    valor_mensalidade: Number(linha.valor_mensalidade),
    is_recorrente: linha.is_recorrente,
    dia_vencimento: linha.dia_vencimento,
    pct_social_media: Number(linha.pct_social_media),
    pct_trafego: Number(linha.pct_trafego),
    socios: linha.socios ?? [],
    id_cliente_asaas: linha.id_cliente_asaas,
  };
}

export async function listarClientes(): Promise<Cliente[]> {
  const { data, error } = await supabase
    .from("client_financeiro")
    .select(SELECT)
    .order("name", { referencedTable: "clients" });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as LinhaJoin[]).map(achatar);
}

/** Um cliente da carteira do Norteia, com a parte financeira quando existir. */
export interface ClienteDaCarteira {
  id: string;
  nome: string;
  logo_url: string | null;
  accent_color: string | null;
  /** `null` = está no Norteia mas ainda não tem ficha financeira. */
  financeiro: Cliente | null;
}

/**
 * TODA a carteira do Norteia, tenha ficha financeira ou não.
 *
 * Existe separada de `listarClientes()` de propósito. Aquela lê de
 * `client_financeiro` e alimenta os CÁLCULOS — MRR, churn, comissão, fluxo de
 * caixa. Fazer ela devolver cliente sem ficha somaria zeros silenciosamente
 * nessas contas: o MRR continuaria certo, mas o churn e as médias por cliente
 * não.
 *
 * Esta aqui é para a TELA de clientes, que virou a lista da carteira quando o
 * /clients foi aposentado. Sem ela, cliente sem ficha ficava invisível no app
 * inteiro — só alcançável por link direto ou pelo Planejamento.
 */
export async function listarCarteira(): Promise<ClienteDaCarteira[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("clients")
    .select(
      "id, name, logo_url, accent_color, agency_since, " +
      "client_financeiro(status, data_saida, data_status_alterado, data_aniversario, " +
      "valor_mensalidade, is_recorrente, dia_vencimento, pct_social_media, pct_trafego, " +
      "socios, id_cliente_asaas)",
    )
    .order("name");
  if (error) throw new Error(error.message);

  type LinhaCliente = {
    id: string;
    name: string;
    logo_url: string | null;
    accent_color: string | null;
    agency_since: string | null;
    // O embed vem como array quando o PostgREST não sabe que é 1:1.
    client_financeiro: Omit<LinhaJoin, "client_id" | "clients">[] | Omit<LinhaJoin, "client_id" | "clients"> | null;
  };

  return ((data ?? []) as LinhaCliente[]).map((linha) => {
    const ficha = Array.isArray(linha.client_financeiro)
      ? linha.client_financeiro[0]
      : linha.client_financeiro;
    return {
      id: linha.id,
      nome: linha.name,
      logo_url: linha.logo_url,
      accent_color: linha.accent_color,
      financeiro: ficha
        ? achatar({
            ...ficha,
            client_id: linha.id,
            clients: { name: linha.name, agency_since: linha.agency_since },
          } as LinhaJoin)
        : null,
    };
  });
}

export async function buscarCliente(clientId: string): Promise<Cliente | null> {
  const { data, error } = await supabase
    .from("client_financeiro")
    .select(SELECT)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? achatar(data as unknown as LinhaJoin) : null;
}

/**
 * Cria ou atualiza a ficha financeira de um cliente que JÁ existe no Norteia.
 *
 * Não cria cliente: quem nasce aqui nasceria fora da carteira, e a duplicação
 * que a gente acabou de eliminar voltaria pela porta dos fundos. Cliente novo
 * se cadastra no Norteia; aqui se diz quanto ele paga.
 *
 * O `.select()` não é enfeite: um upsert barrado por RLS volta com zero linhas
 * e erro nulo, e a tela mostraria sucesso sem ter gravado nada.
 */
export async function salvarFichaFinanceira(
  clientId: string,
  dados: ClienteFinanceiroInput,
): Promise<void> {
  const { data_entrada, ...financeiro } = dados;

  const { data, error } = await supabase
    .from("client_financeiro")
    .upsert({ client_id: clientId, ...financeiro }, { onConflict: "client_id" })
    .select("client_id");
  if (error) throw new Error(error.message);
  if (!data?.length) {
    throw new Error("Sem permissão para salvar os dados financeiros deste cliente.");
  }

  await salvarDataEntrada(clientId, data_entrada);
}

/**
 * Grava desde quando o cliente é da agência.
 *
 * Mora em `clients.agency_since`, a mesma coluna que o Norteia usa — o tempo
 * de casa é um só, editável de dois lugares. Guardar uma cópia aqui daria duas
 * respostas para a mesma pergunta, e a comissão sairia da que estivesse mais
 * desatualizada.
 */
export async function salvarDataEntrada(
  clientId: string,
  dataEntrada: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("clients")
    .update({ agency_since: dataEntrada || null })
    .eq("id", clientId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) {
    throw new Error(
      "Os dados financeiros foram salvos, mas você não tem permissão para alterar a data de entrada no cadastro do cliente.",
    );
  }
}

/** Remove a ficha financeira. O cliente continua existindo no Norteia. */
export async function removerFichaFinanceira(clientId: string): Promise<void> {
  const { data, error } = await supabase
    .from("client_financeiro")
    .delete()
    .eq("client_id", clientId)
    .select("client_id");
  if (error) throw new Error(error.message);
  if (!data?.length) {
    throw new Error("Sem permissão para remover os dados financeiros deste cliente.");
  }
}

/** Clientes do Norteia que ainda não têm ficha financeira — o que o seletor
 *  do formulário oferece. Traz `agency_since` para o formulário já abrir com a
 *  data que o Norteia conhece, em vez de apagá-la ao salvar em branco. */
export async function clientesSemFicha(): Promise<
  Array<{ id: string; name: string; agency_since: string | null }>
> {
  const [todos, comFicha] = await Promise.all([
    supabase.from("clients").select("id, name, agency_since").order("name"),
    supabase.from("client_financeiro").select("client_id"),
  ]);
  if (todos.error) throw new Error(todos.error.message);
  if (comFicha.error) throw new Error(comFicha.error.message);
  const jaTem = new Set((comFicha.data ?? []).map((linha) => linha.client_id));
  return (todos.data ?? []).filter((cliente) => !jaTem.has(cliente.id));
}

/** Grava o id do cliente no Asaas depois de criá-lo lá. */
export async function salvarIdAsaas(clientId: string, idAsaas: string): Promise<void> {
  const { error } = await supabase
    .from("client_financeiro")
    .update({ id_cliente_asaas: idAsaas })
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);
}
