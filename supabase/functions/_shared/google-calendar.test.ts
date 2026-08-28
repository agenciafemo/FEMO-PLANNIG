import {
  googleEventId,
  type NorteiaCalendarEvent,
  toGoogleEventResource,
} from "./google-calendar.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`Expected ${right}, received ${left}`);
}

function event(
  overrides: Partial<NorteiaCalendarEvent> = {},
): NorteiaCalendarEvent {
  return {
    id: "123e4567-e89b-42d3-a456-426614174000",
    organization_id: "223e4567-e89b-42d3-a456-426614174000",
    client_id: "323e4567-e89b-42d3-a456-426614174000",
    title: "Campanha de lançamento",
    event_date: "2026-09-10",
    event_type: "campanha",
    note: "Revisar as peças finais.",
    all_day: true,
    start_time: null,
    end_time: null,
    ...overrides,
  };
}

Deno.test("gera ID estável e aceito pelo Google a partir do UUID", () => {
  assertEquals(
    googleEventId("123e4567-e89b-42d3-a456-426614174000"),
    "norteia123e4567e89b42d3a456426614174000",
  );
});

Deno.test("evento de dia inteiro usa fim exclusivo no dia seguinte", () => {
  const resource = toGoogleEventResource(event(), "Cliente Exemplo", true);
  assertEquals(resource.start, { date: "2026-09-10" });
  assertEquals(resource.end, { date: "2026-09-11" });
  assertEquals(resource.summary, "Cliente Exemplo · Campanha de lançamento");
  assertEquals(resource.id, "norteia123e4567e89b42d3a456426614174000");
});

Deno.test("evento com hora recebe duração padrão de uma hora", () => {
  const resource = toGoogleEventResource(
    event({
      all_day: false,
      start_time: "16:30:00",
      end_time: null,
    }),
    "Cliente Exemplo",
    false,
  );
  assertEquals(resource.start, {
    dateTime: "2026-09-10T16:30:00-03:00",
    timeZone: "America/Sao_Paulo",
  });
  assertEquals(resource.end, {
    dateTime: "2026-09-10T17:30:00-03:00",
    timeZone: "America/Sao_Paulo",
  });
  assertEquals(resource.id, undefined);
});

Deno.test("fim anterior ao início é interpretado como dia seguinte", () => {
  const resource = toGoogleEventResource(
    event({
      all_day: false,
      start_time: "23:30:00",
      end_time: "00:30:00",
    }),
    "",
    false,
  );
  assertEquals(resource.end, {
    dateTime: "2026-09-11T00:30:00-03:00",
    timeZone: "America/Sao_Paulo",
  });
});
