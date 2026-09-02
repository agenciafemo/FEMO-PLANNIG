export type PrintSection = {
  title: string;
  subtitle?: string;
  columns: { label: string; align?: "left" | "right" | "center" }[];
  rows: (string | number)[][];
  footer?: (string | number)[];
  empty?: string;
};

const escape = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

export function printReport(opts: { title: string; subtitle?: string; sections: PrintSection[] }) {
  const now = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date());

  const sectionsHtml = opts.sections
    .map((s) => {
      const head = s.columns.map((c) => `<th style="text-align:${c.align ?? "left"}">${escape(c.label)}</th>`).join("");
      const body = s.rows.length
        ? s.rows
            .map(
              (r) =>
                `<tr>${r
                  .map((cell, i) => `<td style="text-align:${s.columns[i]?.align ?? "left"}">${escape(cell)}</td>`)
                  .join("")}</tr>`,
            )
            .join("")
        : `<tr><td colspan="${s.columns.length}" class="empty">${escape(s.empty ?? "Sem registros.")}</td></tr>`;
      const footer = s.footer
        ? `<tfoot><tr>${s.footer
            .map((cell, i) => `<td style="text-align:${s.columns[i]?.align ?? "left"}">${escape(cell)}</td>`)
            .join("")}</tr></tfoot>`
        : "";
      return `<section>
        <h2>${escape(s.title)}</h2>
        ${s.subtitle ? `<p class="sub">${escape(s.subtitle)}</p>` : ""}
        <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${footer}</table>
      </section>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" />
<title>${escape(opts.title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, sans-serif; color: #0f172a; margin: 32px; }
  header { border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 20px; }
  h1 { font-size: 18px; margin: 0 0 4px; letter-spacing: -0.01em; }
  header .meta { font-size: 11px; color: #64748b; }
  section { margin-bottom: 22px; page-break-inside: avoid; }
  h2 { font-size: 13px; margin: 0 0 6px; }
  p.sub { font-size: 11px; color: #64748b; margin: 0 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { text-transform: uppercase; letter-spacing: .04em; font-size: 9px; color: #64748b; border-bottom: 1px solid #cbd5e1; padding: 6px 8px; }
  td { border-bottom: 1px solid #e2e8f0; padding: 6px 8px; }
  tfoot td { font-weight: 700; border-top: 1px solid #0f172a; border-bottom: none; background: #f8fafc; }
  td.empty { text-align: center; color: #94a3b8; padding: 14px; }
  footer { margin-top: 24px; font-size: 10px; color: #94a3b8; }
  @page { margin: 14mm; }
</style></head>
<body>
  <header>
    <h1>${escape(opts.title)}</h1>
    ${opts.subtitle ? `<div class="meta">${escape(opts.subtitle)}</div>` : ""}
    <div class="meta">FEMO FINANÇAS — emitido em ${escape(now)}</div>
  </header>
  ${sectionsHtml}
  <footer>Documento gerado automaticamente pelo sistema FEMO FINANÇAS.</footer>
  <script>window.onload = function () { window.focus(); window.print(); };</script>
</body></html>`;

  const win = window.open("", "_blank", "width=980,height=760");
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}
