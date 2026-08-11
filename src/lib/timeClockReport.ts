// Geração do PDF de carga horária do ponto. Usa jspdf (já é dependência).
// Sem dados sensíveis além de nomes e horários — o mesmo que a tela mostra.
import { jsPDF } from "jspdf";

export type TimeClockPdfDay = {
  date: string;
  entrada: string;
  saidaAlmoco: string;
  voltaAlmoco: string;
  saida: string;
  total: string;
  saldo: string;
};

export type TimeClockPdfMember = {
  name: string;
  role: string;
  diasRegistrados: number;
  totalTrabalhado: string;
  extras: string;
  negativas: string;
  saldo: string;
  days: TimeClockPdfDay[];
};

export type TimeClockPdfInput = {
  periodLabel: string;
  generatedAt: string;
  detailed: boolean; // true = um colaborador com detalhe diário; false = resumo geral
  members: TimeClockPdfMember[];
};

const MARGIN = 40;
const LINE = 16;

export function generateTimeClockReportPdf(input: TimeClockPdfInput): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = MARGIN;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };

  // Cabeçalho do documento.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Norteia — Relatório de Carga Horária", MARGIN, y);
  y += LINE + 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text(`Período: ${input.periodLabel}`, MARGIN, y);
  y += LINE;
  doc.text(`Gerado em: ${input.generatedAt}`, MARGIN, y);
  doc.setTextColor(0);
  y += LINE + 8;

  if (!input.detailed) {
    // Resumo geral: uma linha por colaborador.
    drawSummaryTable(doc, input.members, MARGIN, y, pageWidth, ensureSpace, () => y, (nextY) => { y = nextY; });
    doc.save(`carga-horaria-${sanitize(input.periodLabel)}.pdf`);
    return;
  }

  // Detalhado: por colaborador, tabela diária + totais.
  input.members.forEach((member, index) => {
    if (index > 0) y += LINE;
    ensureSpace(LINE * 4);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(`${member.name}${member.role ? ` · ${member.role}` : ""}`, MARGIN, y);
    y += LINE + 2;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(90);
    doc.text(
      `Dias: ${member.diasRegistrados}   Total: ${member.totalTrabalhado}   Extras: ${member.extras}   Negativas: ${member.negativas}   Banco de horas: ${member.saldo}`,
      MARGIN,
      y,
    );
    doc.setTextColor(0);
    y += LINE + 4;

    // Cabeçalho da tabela diária.
    const cols = [
      { label: "Dia", x: MARGIN, w: 90 },
      { label: "Entrada", x: MARGIN + 90, w: 60 },
      { label: "S. almoço", x: MARGIN + 150, w: 65 },
      { label: "V. almoço", x: MARGIN + 215, w: 65 },
      { label: "Saída", x: MARGIN + 280, w: 60 },
      { label: "Total", x: MARGIN + 340, w: 70 },
      { label: "Saldo", x: MARGIN + 410, w: 70 },
    ];
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    cols.forEach((col) => doc.text(col.label, col.x, y));
    y += 4;
    doc.setDrawColor(210);
    doc.line(MARGIN, y, pageWidth - MARGIN, y);
    y += LINE - 2;

    doc.setFont("helvetica", "normal");
    member.days.forEach((day) => {
      ensureSpace(LINE);
      doc.text(day.date, cols[0].x, y);
      doc.text(day.entrada, cols[1].x, y);
      doc.text(day.saidaAlmoco, cols[2].x, y);
      doc.text(day.voltaAlmoco, cols[3].x, y);
      doc.text(day.saida, cols[4].x, y);
      doc.text(day.total, cols[5].x, y);
      doc.text(day.saldo, cols[6].x, y);
      y += LINE - 2;
    });
    y += 6;
    doc.setDrawColor(230);
    doc.line(MARGIN, y, pageWidth - MARGIN, y);
    y += 4;
  });

  doc.save(`carga-horaria-${sanitize(input.members[0]?.name ?? "equipe")}.pdf`);
}

function drawSummaryTable(
  doc: jsPDF,
  members: TimeClockPdfMember[],
  margin: number,
  startY: number,
  pageWidth: number,
  ensureSpace: (n: number) => void,
  getY: () => number,
  setY: (n: number) => void,
): void {
  setY(startY);
  const cols = [
    { label: "Colaborador", x: margin },
    { label: "Dias", x: margin + 200 },
    { label: "Total", x: margin + 250 },
    { label: "Extras", x: margin + 330 },
    { label: "Negativas", x: margin + 400 },
    { label: "Banco", x: margin + 470 },
  ];
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  cols.forEach((col) => doc.text(col.label, col.x, getY()));
  setY(getY() + 4);
  doc.setDrawColor(210);
  doc.line(margin, getY(), pageWidth - margin, getY());
  setY(getY() + LINE - 2);

  doc.setFont("helvetica", "normal");
  members.forEach((member) => {
    ensureSpace(LINE);
    doc.text(member.name, cols[0].x, getY());
    doc.text(String(member.diasRegistrados), cols[1].x, getY());
    doc.text(member.totalTrabalhado, cols[2].x, getY());
    doc.text(member.extras, cols[3].x, getY());
    doc.text(member.negativas, cols[4].x, getY());
    doc.text(member.saldo, cols[5].x, getY());
    setY(getY() + LINE - 2);
  });
}

function sanitize(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "relatorio";
}
