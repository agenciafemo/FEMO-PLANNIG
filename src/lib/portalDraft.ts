import { useEffect, useState } from "react";

/**
 * Rascunho do que o cliente escreve no portal público.
 *
 * O cliente digitava o comentário, voltava para a lista (ou a página
 * recarregava no celular) sem tocar em enviar, e o texto sumia — do ponto de
 * vista dele, "não salvou". Guardar no aparelho até o envio dar certo evita a
 * perda; apagar só depois da confirmação do servidor.
 */

type LeituraStorage = Pick<Storage, "getItem">;
type EscritaStorage = Pick<Storage, "setItem" | "removeItem">;

const PREFIXO = "norteia:portal:rascunho";

export type CampoRascunho = "comentario" | "correcao";

export function chaveRascunho(campo: CampoRascunho, postId: string): string {
  return `${PREFIXO}:${campo}:${postId}`;
}

function storagePadrao(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    // Modo privado ou site data bloqueado: o acesso ao localStorage lança.
    return null;
  }
}

export function lerRascunho(
  chave: string,
  storage: LeituraStorage | null = storagePadrao(),
): string {
  try {
    return storage?.getItem(chave) ?? "";
  } catch {
    return "";
  }
}

/** Texto em branco apaga a chave — não acumula entradas vazias no aparelho. */
export function gravarRascunho(
  chave: string,
  valor: string,
  storage: EscritaStorage | null = storagePadrao(),
): void {
  try {
    if (valor.trim()) storage?.setItem(chave, valor);
    else storage?.removeItem(chave);
  } catch {
    // best-effort: sem storage o campo segue funcionando, só não sobrevive.
  }
}

export function usePortalDraft(chave: string): [string, (valor: string) => void] {
  const [valor, setValor] = useState(() => lerRascunho(chave));
  const [chaveAtual, setChaveAtual] = useState(chave);

  // Trocou de post sem desmontar: carrega o rascunho do post novo.
  if (chaveAtual !== chave) {
    setChaveAtual(chave);
    setValor(lerRascunho(chave));
  }

  useEffect(() => {
    gravarRascunho(chaveAtual, valor);
  }, [chaveAtual, valor]);

  return [valor, setValor];
}
