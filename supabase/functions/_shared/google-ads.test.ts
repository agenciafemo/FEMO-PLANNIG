import {
  fromMicros,
  parseCustomerClientRows,
  normalizeCustomerId,
  normalizeGoogleAdsInsights,
  parseAccountRow,
  unwrapSearchStream,
} from "./google-ads.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, received ${actualJson}`);
  }
}

// ---------------------------------------------------------------------------
// O searchStream responde um ARRAY de blocos. Ler `payload.results` direto
// devolve vazio SEM erro nenhum — foi assim que o Perfil da Empresa saiu todo
// zerado com a chamada "funcionando". Este teste existe para essa regressão.
// ---------------------------------------------------------------------------
Deno.test("desembrulha as linhas de todos os blocos do searchStream", () => {
  const rows = unwrapSearchStream([
    { results: [{ campaign: { name: "A" } }, { campaign: { name: "B" } }], fieldMask: "campaign.name" },
    { results: [{ campaign: { name: "C" } }], fieldMask: "campaign.name" },
  ]);
  assertEquals(rows.length, 3);
  assertEquals(rows.map((row) => (row.campaign as { name: string }).name), ["A", "B", "C"]);
});

Deno.test("searchStream sem resultados não quebra nem inventa linha", () => {
  assertEquals(unwrapSearchStream([{ fieldMask: "campaign.name" }]), []);
  assertEquals(unwrapSearchStream([]), []);
  assertEquals(unwrapSearchStream(null), []);
});

Deno.test("aceita também a resposta em objeto único, por segurança", () => {
  const rows = unwrapSearchStream({ results: [{ campaign: { name: "A" } }] });
  assertEquals(rows.length, 1);
});

// ---------------------------------------------------------------------------
// Custo vem em MICROS. Sem a divisão, um gasto de R$ 1,50 vira R$ 1.500.000.
// ---------------------------------------------------------------------------
Deno.test("converte micros para a unidade da moeda", () => {
  assertEquals(fromMicros("1500000"), 1.5);
  assertEquals(fromMicros(0), 0);
  assertEquals(fromMicros(null), 0);
  assertEquals(fromMicros(undefined), 0);
});

Deno.test("normaliza customer id com e sem hífen", () => {
  assertEquals(normalizeCustomerId("123-456-7890"), "1234567890");
  assertEquals(normalizeCustomerId("1234567890"), "1234567890");
  assertEquals(normalizeCustomerId("customers/1234567890"), "1234567890");
  assertEquals(normalizeCustomerId("12345"), null);
  assertEquals(normalizeCustomerId(null), null);
});

// ---------------------------------------------------------------------------
// O teste que importa: taxas calculadas sobre os TOTAIS, não pela média das
// taxas de cada linha. Os números abaixo foram escolhidos para separar as duas
// contas — a média daria 5,5% de CTR, o cálculo certo dá 1,82%.
// ---------------------------------------------------------------------------
Deno.test("soma métricas e calcula taxas a partir dos totais", () => {
  const resultado = normalizeGoogleAdsInsights(unwrapSearchStream([
    {
      results: [
        {
          campaign: { name: "Busca", status: "ENABLED", advertisingChannelType: "SEARCH" },
          segments: { date: "2026-09-01" },
          // int64 chega como STRING no REST; double chega como número.
          metrics: { costMicros: "10000000", impressions: "1000", clicks: "10", conversions: 1 },
        },
        {
          campaign: { name: "Busca", status: "ENABLED", advertisingChannelType: "SEARCH" },
          segments: { date: "2026-09-02" },
          metrics: { costMicros: "5000000", impressions: "100", clicks: "10", conversions: 0.5 },
        },
      ],
    },
  ]));

  assertEquals(resultado.totals, {
    cost: 15,
    impressions: 1100,
    clicks: 20,
    conversions: 1.5,
    ctr: 1.82,
    cpc: 0.75,
    cpm: 13.64,
    cost_per_conversion: 10,
  });

  // A campanha aparece UMA vez, somando os dois dias.
  assertEquals(resultado.campaigns, [{
    name: "Busca",
    status: "ENABLED",
    channel: "SEARCH",
    cost: 15,
    impressions: 1100,
    clicks: 20,
    conversions: 1.5,
  }]);

  assertEquals(resultado.daily, [
    { date: "2026-09-01", cost: 10, impressions: 1000, clicks: 10, conversions: 1 },
    { date: "2026-09-02", cost: 5, impressions: 100, clicks: 10, conversions: 0.5 },
  ]);
});

Deno.test("ordena campanhas pelo maior gasto", () => {
  const resultado = normalizeGoogleAdsInsights(unwrapSearchStream([
    {
      results: [
        {
          campaign: { name: "Barata" },
          segments: { date: "2026-09-01" },
          metrics: { costMicros: "1000000", impressions: "10", clicks: "1", conversions: 0 },
        },
        {
          campaign: { name: "Cara" },
          segments: { date: "2026-09-01" },
          metrics: { costMicros: "9000000", impressions: "90", clicks: "9", conversions: 0 },
        },
      ],
    },
  ]));
  assertEquals(resultado.campaigns.map((c) => c.name), ["Cara", "Barata"]);
  // O dia junta as duas campanhas numa linha só.
  assertEquals(resultado.daily, [
    { date: "2026-09-01", cost: 10, impressions: 100, clicks: 10, conversions: 0 },
  ]);
});

Deno.test("período sem gasto devolve zeros em vez de NaN", () => {
  const resultado = normalizeGoogleAdsInsights([]);
  assertEquals(resultado.totals, {
    cost: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    ctr: 0,
    cpc: 0,
    cpm: 0,
    cost_per_conversion: 0,
  });
  assertEquals(resultado.campaigns, []);
  assertEquals(resultado.daily, []);
});

Deno.test("data fora do formato ISO não entra na série diária", () => {
  const resultado = normalizeGoogleAdsInsights([
    {
      campaign: { name: "A" },
      segments: { date: "01/09/2026" },
      metrics: { costMicros: "1000000", impressions: "10", clicks: "1" },
    },
  ]);
  // O total continua contando — o que se perde é só o ponto do gráfico.
  assertEquals(resultado.totals.cost, 1);
  assertEquals(resultado.daily, []);
});

Deno.test("lê os dados da conta e cai no id quando falta o nome", () => {
  assertEquals(
    parseAccountRow([{
      customer: {
        id: "1234567890",
        descriptiveName: "Cliente X",
        currencyCode: "BRL",
        timeZone: "America/Sao_Paulo",
        manager: false,
        testAccount: false,
      },
    }]),
    {
      customerId: "1234567890",
      descriptiveName: "Cliente X",
      currencyCode: "BRL",
      timeZone: "America/Sao_Paulo",
      manager: false,
      testAccount: false,
    },
  );

  assertEquals(
    parseAccountRow([{ customer: { id: "1234567890" } }])?.descriptiveName,
    "1234567890",
  );
  assertEquals(parseAccountRow([]), null);
});

Deno.test("lista as contas filhas da MCC com a administradora por último", () => {
  const contas = parseCustomerClientRows(unwrapSearchStream([
    {
      results: [
        {
          customerClient: {
            id: "1111111111",
            descriptiveName: "FEMO Agência (MCC)",
            currencyCode: "BRL",
            timeZone: "America/Sao_Paulo",
            manager: true,
          },
        },
        {
          customerClient: {
            id: "3333333333",
            descriptiveName: "Zeta Odontologia",
            currencyCode: "BRL",
            manager: false,
          },
        },
        {
          customerClient: {
            id: "2222222222",
            descriptiveName: "Alfa Clínica",
            currencyCode: "BRL",
            manager: false,
          },
        },
        // A mesma conta pode voltar em blocos diferentes; não pode duplicar.
        { customerClient: { id: "2222222222", descriptiveName: "Alfa Clínica" } },
      ],
    },
  ]));

  assertEquals(contas.map((conta) => conta.descriptiveName), [
    "Alfa Clínica",
    "Zeta Odontologia",
    "FEMO Agência (MCC)",
  ]);
  assertEquals(contas[0].customerId, "2222222222");
  assertEquals(contas[2].manager, true);
  // Moeda fora do padrão ISO vira null em vez de sujar o relatório.
  assertEquals(contas[1].currencyCode, "BRL");
});

// ---------------------------------------------------------------------------
// CONTRATO com o relatório. O PDF, o prompt da IA e a mensagem pro cliente leem
// estes nomes de campo por string. Renomear um deles aqui não quebra
// compilação nenhuma — o campo só chega `undefined` do outro lado e vira zero
// no relatório. Foi assim que as métricas do Perfil da Empresa saíram zeradas.
// ---------------------------------------------------------------------------
Deno.test("mantém os nomes de campo que o relatório consome", () => {
  const resultado = normalizeGoogleAdsInsights([
    {
      campaign: { name: "X", status: "ENABLED", advertisingChannelType: "SEARCH" },
      segments: { date: "2026-09-01" },
      metrics: { costMicros: "1000000", impressions: "10", clicks: "1", conversions: 1 },
    },
  ]);

  assertEquals(Object.keys(resultado).sort(), ["campaigns", "daily", "totals"]);
  assertEquals(Object.keys(resultado.totals).sort(), [
    "clicks",
    "conversions",
    "cost",
    "cost_per_conversion",
    "cpc",
    "cpm",
    "ctr",
    "impressions",
  ]);
  assertEquals(Object.keys(resultado.campaigns[0]).sort(), [
    "channel",
    "clicks",
    "conversions",
    "cost",
    "impressions",
    "name",
    "status",
  ]);
  assertEquals(Object.keys(resultado.daily[0]).sort(), [
    "clicks",
    "conversions",
    "cost",
    "date",
    "impressions",
  ]);
});
