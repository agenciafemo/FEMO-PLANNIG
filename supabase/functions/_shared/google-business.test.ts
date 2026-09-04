import { normalizeGoogleBusinessInsights } from "./google-business.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, received ${actualJson}`);
  }
}

Deno.test("normaliza e soma métricas diárias do Google Business Profile", () => {
  const result = normalizeGoogleBusinessInsights({
    multiDailyMetricTimeSeries: [
      {
        dailyMetricTimeSeries: [
          {
            dailyMetric: "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
            timeSeries: {
              datedValues: [
                { date: { year: 2026, month: 9, day: 1 }, value: "12" },
              ],
            },
          },
          {
            dailyMetric: "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
            timeSeries: {
              datedValues: [
                { date: { year: 2026, month: 9, day: 1 }, value: "28" },
                { date: { year: 2026, month: 9, day: 2 }, value: "10" },
              ],
            },
          },
          {
            dailyMetric: "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
            timeSeries: {
              datedValues: [
                { date: { year: 2026, month: 9, day: 1 }, value: "15" },
              ],
            },
          },
          {
            dailyMetric: "CALL_CLICKS",
            timeSeries: {
              datedValues: [
                { date: { year: 2026, month: 9, day: 1 }, value: "3" },
              ],
            },
          },
          {
            dailyMetric: "BUSINESS_DIRECTION_REQUESTS",
            timeSeries: {
              datedValues: [
                { date: { year: 2026, month: 9, day: 1 }, value: "4" },
              ],
            },
          },
          {
            dailyMetric: "WEBSITE_CLICKS",
            timeSeries: {
              datedValues: [
                { date: { year: 2026, month: 9, day: 1 }, value: "5" },
              ],
            },
          }
        ],
      },
    ],
  });

  assertEquals(result.totals, {
    search_impressions: 50,
    maps_impressions: 15,
    calls: 3,
    directions: 4,
    website_clicks: 5,
    total_impressions: 65,
    total_actions: 12,
  });
  assertEquals(result.daily, [
    {
      date: "2026-09-01",
      search_impressions: 40,
      maps_impressions: 15,
      calls: 3,
      directions: 4,
      website_clicks: 5,
    },
    {
      date: "2026-09-02",
      search_impressions: 10,
      maps_impressions: 0,
      calls: 0,
      directions: 0,
      website_clicks: 0,
    },
  ]);
});

Deno.test("ignora métricas desconhecidas e datas inválidas", () => {
  const result = normalizeGoogleBusinessInsights({
    multiDailyMetricTimeSeries: [
      {
        dailyMetricTimeSeries: [
          {
            dailyMetric: "UNKNOWN_METRIC",
            timeSeries: {
              datedValues: [
                { date: { year: 2026, month: 9, day: 1 }, value: "999" },
              ],
            },
          },
          {
            dailyMetric: "CALL_CLICKS",
            timeSeries: {
              datedValues: [
                { date: { year: 2026, month: 2, day: 31 }, value: "8" },
              ],
            },
          }
        ],
      },
    ],
  });

  assertEquals(result.daily, []);
  assertEquals(result.totals.total_impressions, 0);
  assertEquals(result.totals.total_actions, 0);
});

// Regressão: o parser lia dailyMetric um nível acima do que a API entrega, e
// o teste original repetia a mesma suposição — então passava, enquanto o
// relatório real saía inteiro zerado. Este teste falha se alguém "achatar" a
// estrutura de novo.
Deno.test("ignora o par de métricas se ele vier fora de dailyMetricTimeSeries", () => {
  const achatado = normalizeGoogleBusinessInsights({
    multiDailyMetricTimeSeries: [
      {
        dailyMetric: "CALL_CLICKS",
        timeSeries: {
          datedValues: [{ date: { year: 2026, month: 9, day: 1 }, value: "7" }],
        },
      },
    ],
  });
  assertEquals(achatado.totals.calls, 0);

  const aninhado = normalizeGoogleBusinessInsights({
    multiDailyMetricTimeSeries: [
      {
        dailyMetricTimeSeries: [
          {
            dailyMetric: "CALL_CLICKS",
            timeSeries: {
              datedValues: [{ date: { year: 2026, month: 9, day: 1 }, value: "7" }],
            },
          },
        ],
      },
    ],
  });
  assertEquals(aninhado.totals.calls, 7);
});
