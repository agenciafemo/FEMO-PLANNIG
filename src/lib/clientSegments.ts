// Segmentos de cliente. Cada cliente recebe UM segmento; o calendário mostra
// automaticamente as datas comemorativas daquele segmento (+ as comerciais
// universais, que valem para todos). As datas ficam ligadas ao segmento no
// banco (commemorative_dates.segment) e o cliente ao segmento (clients.segment).
export type ClientSegment = {
  key: string;
  label: string;
};

export const CLIENT_SEGMENTS: ClientSegment[] = [
  { key: "medicos", label: "Médicos / Saúde" },
  { key: "mecanica", label: "Auto Center / Mecânica" },
  { key: "industria", label: "Indústria / Siderúrgica" },
  { key: "dentista", label: "Dentista / Odontologia" },
  { key: "alimentos", label: "Alimentos / Balas" },
  { key: "farmacia", label: "Farmácia de Manipulação" },
  { key: "moda", label: "Moda / Vestuário" },
  { key: "uniformes", label: "Uniformes / Corporativo" },
];

export function segmentLabel(key: string | null | undefined): string {
  if (!key) return "";
  return CLIENT_SEGMENTS.find((s) => s.key === key)?.label ?? key;
}
