import type { LinhaImportada } from "@/lib/financeiro/importacao";

// Leitura do arquivo de extrato. O que decide o que é data, o que é valor e o
// que é entrada ou saída mora AQUI, e não na tela: o mesmo extrato tem que ser
// lido igual venha ele em CSV ou em planilha. Enquanto isso vivia dentro do
// componente, suportar um segundo formato significaria uma segunda cópia
// dessas regras — e duas cópias divergem.

export type FormatoSuportado = "csv" | "xlsx";

export interface ResultadoLeitura {
  linhas: LinhaImportada[];
  /** Linhas descartadas por não terem data ou valor utilizáveis. */
  ignoradas: number;
}

export function normalizeHeader(h: string): string {
  return (h ?? "").replace(/^\uFEFF/, "").trim();
}

const semAcento = (v: string) =>
  v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function findHeader(headers: string[], ...needles: string[]): string {
  return headers.find((h) => needles.some((n) => semAcento(h).includes(n))) ?? "";
}

/**
 * Data do arquivo → ISO.
 *
 * Aceita Date porque a planilha já entrega células de data convertidas, ao
 * contrário do CSV, que sempre chega como texto.
 */
export function parseDateBR(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === "") return null;

  if (valor instanceof Date) {
    if (isNaN(valor.getTime())) return null;
    // Fatia a data local em vez de usar toISOString: o extrato é um documento
    // de datas, não de instantes, e converter para UTC joga a meia-noite de
    // Brasília para o dia anterior.
    const mes = String(valor.getMonth() + 1).padStart(2, "0");
    const dia = String(valor.getDate()).padStart(2, "0");
    return `${valor.getFullYear()}-${mes}-${dia}`;
  }

  const bruto = String(valor).trim().replace(/^\uFEFF/, "");
  const v = bruto.split(/[ T]/)[0];
  if (!v) return null;

  const m = v.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    const ano = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${ano}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;

  const d = new Date(bruto);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** "R$ 1.234,56", "(80,00)" e -80 chegam todos ao mesmo número. */
export function parseValorBR(valor: unknown): number {
  if (valor === null || valor === undefined || valor === "") return 0;
  if (typeof valor === "number") return valor;

  let str = String(valor).trim().replace(/^\uFEFF/, "");
  // Contabilidade escreve negativo entre parênteses.
  const negativo = /^\(.*\)$/.test(str) || /^-/.test(str);
  str = str.replace(/[R$\s()]/gi, "").replace(/^-/, "");
  if (str.includes(",")) str = str.replace(/\./g, "").replace(",", ".");

  const n = Number(str);
  if (isNaN(n)) return 0;
  return negativo ? -n : n;
}

/**
 * Converte as linhas cruas do arquivo no que a importação grava.
 *
 * Recebe objetos já indexados por cabeçalho — é o formato em que tanto o CSV
 * quanto a planilha conseguem entregar, e é o que permite as duas rotas
 * dividirem exatamente estas regras.
 */
export function normalizarLinhas(
  linhas: Array<Record<string, unknown>>,
  cabecalhos: string[],
): ResultadoLeitura {
  const hs = cabecalhos.map(normalizeHeader).filter(Boolean);
  const colData = findHeader(hs, "data", "vencimento", "pagamento", "competencia", "dt");
  const colDesc = findHeader(hs, "descri", "histor", "cliente", "memo", "obs", "titulo", "nome", "estabelec");
  const colValor = findHeader(hs, "valor", "montante", "amount", "preco", "total");
  const colTipo = findHeader(hs, "tipo", "natureza", "operacao");
  // Anos de extrato numa categoria só deixam o analítico sem nada para
  // analisar; quando o arquivo classifica, a classificação é aproveitada.
  const colCategoria = findHeader(hs, "categoria", "classific", "grupo", "conta");

  const resultado: LinhaImportada[] = [];
  let ignoradas = 0;

  for (const bruta of linhas) {
    const r: Record<string, unknown> = {};
    for (const chave of Object.keys(bruta ?? {})) r[normalizeHeader(chave)] = bruta[chave];

    const data = parseDateBR(r[colData]);
    const valorCru = r[colValor];
    const temValor = valorCru !== null && valorCru !== undefined && String(valorCru).trim() !== "";
    if (!data || !temValor) { ignoradas++; continue; }

    const valor = parseValorBR(valorCru);
    // Zero não é lançamento: é linha de saldo, subtotal ou cabeçalho repetido.
    if (!valor) { ignoradas++; continue; }

    const descricao = String(r[colDesc] ?? "").trim() || "Lançamento";
    const tipoCru = String(r[colTipo] ?? "");
    const tipo: "Entrada" | "Saída" = tipoCru
      ? (/entrada|receita|credito|crédito|recebimento|positiv/i.test(tipoCru) ? "Entrada" : "Saída")
      // Sem coluna de tipo, o sinal do valor é a única informação disponível.
      : (valor >= 0 ? "Entrada" : "Saída");
    const categoria = String(r[colCategoria] ?? "").trim();

    resultado.push({
      descricao,
      valor: Math.abs(valor),
      data,
      tipo,
      categoria: categoria || undefined,
    });
  }

  return { linhas: resultado, ignoradas };
}

export function formatoDoArquivo(nome: string): FormatoSuportado | null {
  const ext = nome.toLowerCase().split(".").pop() ?? "";
  if (ext === "csv" || ext === "txt") return "csv";
  if (ext === "xlsx") return "xlsx";
  return null;
}

async function lerCsv(file: File, encoding: string): Promise<ResultadoLeitura> {
  const Papa = (await import("papaparse")).default;
  const buffer = await file.arrayBuffer();
  const texto = new TextDecoder(encoding, { fatal: false }).decode(buffer);

  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(texto, {
      header: true,
      skipEmptyLines: "greedy",
      delimitersToGuess: [",", ";", "\t", "|"],
      transformHeader: normalizeHeader,
      complete: (res) => {
        const cabecalhos = (res.meta.fields ?? []).map(normalizeHeader).filter(Boolean);
        resolve(normalizarLinhas(res.data ?? [], cabecalhos));
      },
      error: (erro: Error) => reject(erro),
    });
  });
}

async function lerXlsx(file: File): Promise<ResultadoLeitura> {
  // Subpath explícito: o pacote não expõe raiz, e a build "browser" é a que
  // lê um File do input sem passar por API de Node.
  const readXlsxFile = (await import("read-excel-file/browser")).default;
  // A lib tipa a célula como um union fechado (string | number | Date | bool).
  // Aqui tratamos tudo como desconhecido de propósito: quem decide o que cada
  // célula significa é normalizarLinhas, que precisa receber o valor cru para
  // distinguir uma data de verdade de um texto que parece data.
  const grade = (await readXlsxFile(file)) as unknown as unknown[][];
  if (grade.length === 0) return { linhas: [], ignoradas: 0 };

  // A primeira linha preenchida é o cabeçalho. Exportações de banco costumam
  // começar com linhas de título/logo em branco antes da tabela de verdade.
  const inicio = grade.findIndex(
    (linha) => linha.filter((c) => c !== null && String(c).trim() !== "").length >= 2,
  );
  if (inicio < 0) return { linhas: [], ignoradas: 0 };

  const cabecalhos = grade[inicio].map((c) => normalizeHeader(String(c ?? "")));
  const objetos = grade.slice(inicio + 1).map((linha) => {
    const obj: Record<string, unknown> = {};
    cabecalhos.forEach((chave, i) => { if (chave) obj[chave] = linha[i]; });
    return obj;
  });

  return normalizarLinhas(objetos, cabecalhos);
}

/** Lê o arquivo no formato que ele for. `encoding` só afeta CSV. */
export async function lerArquivoDeLancamentos(
  file: File,
  encoding: string,
): Promise<ResultadoLeitura> {
  const formato = formatoDoArquivo(file.name);
  if (!formato) {
    throw new Error(
      "Formato não suportado. Envie um CSV ou uma planilha .xlsx — no Excel ou no Google Planilhas, use “Salvar como”.",
    );
  }
  return formato === "xlsx" ? lerXlsx(file) : lerCsv(file, encoding);
}
