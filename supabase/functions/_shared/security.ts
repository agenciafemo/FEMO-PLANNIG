// Comparação de tempo constante para segredos (ex.: X-Internal-Secret).
// Uma comparação "===" normal sai assim que encontra o primeiro byte
// diferente, então o tempo de resposta varia com quantos bytes iniciais
// acertaram — em teoria, dá para reconstruir o segredo byte a byte medindo
// latência. Aqui sempre percorremos os dois arrays inteiros.
export function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}
