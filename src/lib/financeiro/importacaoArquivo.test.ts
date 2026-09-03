import { describe, expect, it } from "vitest";
import {
  findHeader,
  formatoDoArquivo,
  normalizarLinhas,
  parseDateBR,
  parseValorBR,
} from "./importacaoArquivo";

describe("parseValorBR", () => {
  it("lê o formato brasileiro com milhar e centavos", () => {
    expect(parseValorBR("R$ 1.234,56")).toBe(1234.56);
  });

  it("trata parênteses como negativo, que é como a contabilidade escreve", () => {
    expect(parseValorBR("(80,00)")).toBe(-80);
  });

  it("aceita número puro — é assim que a planilha entrega", () => {
    expect(parseValorBR(-42.5)).toBe(-42.5);
  });

  it("devolve zero para texto que não é número, em vez de NaN", () => {
    // NaN se propagaria silenciosamente até virar um lançamento sem valor.
    expect(parseValorBR("saldo anterior")).toBe(0);
  });
});

describe("parseDateBR", () => {
  it("lê dd/mm/aaaa", () => {
    expect(parseDateBR("07/03/2026")).toBe("2026-03-07");
  });

  it("expande ano de dois dígitos", () => {
    expect(parseDateBR("07/03/26")).toBe("2026-03-07");
  });

  it("mantém ISO como está", () => {
    expect(parseDateBR("2026-03-07")).toBe("2026-03-07");
  });

  it("não joga a data para o dia anterior ao converter Date", () => {
    // A planilha entrega Date. Usar toISOString() empurraria a meia-noite de
    // Brasília para o dia 6 — o extrato é um documento de datas, não de
    // instantes.
    expect(parseDateBR(new Date(2026, 2, 7, 0, 0, 0))).toBe("2026-03-07");
  });

  it("devolve nulo para vazio", () => {
    expect(parseDateBR("")).toBeNull();
  });
});

describe("findHeader", () => {
  it("acha a coluna ignorando acento e caixa", () => {
    expect(findHeader(["Descrição", "Valor"], "descri")).toBe("Descrição");
  });

  it("devolve vazio quando a coluna não existe", () => {
    expect(findHeader(["Data"], "categoria")).toBe("");
  });
});

describe("normalizarLinhas", () => {
  const cabecalhos = ["Data", "Descrição", "Valor"];

  it("usa o sinal do valor quando não há coluna de tipo", () => {
    const { linhas } = normalizarLinhas(
      [
        { Data: "01/03/2026", "Descrição": "Mensalidade", Valor: "1.000,00" },
        { Data: "02/03/2026", "Descrição": "Aluguel", Valor: "-2.500,00" },
      ],
      cabecalhos,
    );
    expect(linhas.map((l) => l.tipo)).toEqual(["Entrada", "Saída"]);
    // O valor é sempre gravado positivo: o sinal vira o tipo.
    expect(linhas.map((l) => l.valor)).toEqual([1000, 2500]);
  });

  it("respeita a coluna de tipo acima do sinal do valor", () => {
    const { linhas } = normalizarLinhas(
      [{ Data: "01/03/2026", "Descrição": "Estorno", Valor: "50,00", Tipo: "Saída" }],
      [...cabecalhos, "Tipo"],
    );
    expect(linhas[0].tipo).toBe("Saída");
  });

  it("descarta linha sem data, sem valor ou com valor zero", () => {
    const { linhas, ignoradas } = normalizarLinhas(
      [
        { Data: "", "Descrição": "Cabeçalho repetido", Valor: "10,00" },
        { Data: "01/03/2026", "Descrição": "Sem valor", Valor: "" },
        { Data: "01/03/2026", "Descrição": "Saldo anterior", Valor: "0,00" },
        { Data: "01/03/2026", "Descrição": "Válida", Valor: "10,00" },
      ],
      cabecalhos,
    );
    expect(linhas).toHaveLength(1);
    expect(ignoradas).toBe(3);
  });

  it("aproveita a categoria do arquivo quando ela existe", () => {
    const { linhas } = normalizarLinhas(
      [{ Data: "01/03/2026", "Descrição": "Energia", Valor: "-300,00", Categoria: "Infraestrutura" }],
      [...cabecalhos, "Categoria"],
    );
    expect(linhas[0].categoria).toBe("Infraestrutura");
  });

  it("cai para 'Lançamento' quando a descrição vem vazia", () => {
    const { linhas } = normalizarLinhas(
      [{ Data: "01/03/2026", "Descrição": "", Valor: "10,00" }],
      cabecalhos,
    );
    expect(linhas[0].descricao).toBe("Lançamento");
  });
});

describe("formatoDoArquivo", () => {
  it("reconhece csv e xlsx", () => {
    expect(formatoDoArquivo("extrato.csv")).toBe("csv");
    expect(formatoDoArquivo("Extrato Março.XLSX")).toBe("xlsx");
  });

  it("recusa o que não sabe ler, em vez de tentar e falhar depois", () => {
    // .xls binário de 2003 e PDF caem aqui: melhor dizer na hora do que
    // devolver uma lista vazia sem explicação.
    expect(formatoDoArquivo("extrato.pdf")).toBeNull();
    expect(formatoDoArquivo("extrato.xls")).toBeNull();
  });
});
