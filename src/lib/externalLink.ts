/**
 * Um link colado pela equipe só pode virar `href` se for http(s).
 *
 * O campo é texto livre: nada impede alguém de colar `javascript:...`, que num
 * `<a href>` executa no clique de quem abrir o post depois. Validar o protocolo
 * é o que separa "abrir o Drive" de "rodar código dentro do Norteia".
 *
 * Também barra `data:` e `blob:`, que abrem conteúdo arbitrário numa aba com o
 * endereço do próprio app na barra.
 */
const PROTOCOLOS_SEGUROS = new Set(["http:", "https:"]);

export function isSafeExternalUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value.trim());
    return PROTOCOLOS_SEGUROS.has(url.protocol);
  } catch {
    // Texto que não é URL (a pessoa ainda está digitando, ou colou uma
    // anotação): não é link, e portanto não vira botão de abrir.
    return false;
  }
}
