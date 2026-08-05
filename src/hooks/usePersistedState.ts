import { useEffect, useState } from "react";

/**
 * Igual ao useState, mas o valor é salvo no localStorage — sobrevive a trocar
 * de página, recarregar e até fechar o navegador. Use para seletores/filtros
 * que a pessoa não quer que voltem ao padrão (ex.: cliente na Programação).
 *
 * A chave deve ser única por uso. Falhas de localStorage (modo privado, cota)
 * são silenciosas — cai no valor inicial, nunca quebra a tela.
 */
export function usePersistedState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw != null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignora — persistência é best-effort
    }
  }, [key, value]);

  return [value, setValue];
}
