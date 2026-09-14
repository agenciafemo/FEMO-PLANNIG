// Texto do erro na volta da conexão Meta (Instagram / Facebook) na ficha do
// cliente.
//
// `reason_code` diz a ETAPA que falhou; `meta_code` diz o que a Meta respondeu
// (meta_<status>_<code>_<subcode>). Sozinhos, nenhum dos dois diz o que fazer.
//
// O caso que motivou isto (14/09/2026): enquanto as permissões do app estão em
// acesso PADRÃO, só contas com papel no app conectam. A Clínica Rizzatti voltava
// "long_lived_token_exchange_failed (meta_400_100)" e conectou assim que virou
// testadora. No Instagram Login a Meta não usa o código clássico de permissão
// (10 / 200) nessa etapa — responde 100 sem subcódigo.

export type MetaConnectErrorInput = {
  reasonCode: string | null;
  metaCode: string | null;
  provider: string | null;
};

const TOKEN_STEPS = new Set([
  "token_exchange_failed",
  "long_lived_token_exchange_failed",
]);

/** A conta que autorizou não tem papel no app (acesso padrão). */
export function isAppRoleMissing({
  reasonCode,
  metaCode,
  provider,
}: MetaConnectErrorInput): boolean {
  if (!reasonCode || !metaCode || !TOKEN_STEPS.has(reasonCode)) return false;
  // Códigos clássicos de permissão, nas duas portas.
  if (/^meta_\d{3}_(10|200)(_\d+)?$/.test(metaCode)) return true;
  if (/^meta_\d{3}_100_33$/.test(metaCode)) return true;
  // 100 sem subcódigo só é "sem papel no app" na porta do Instagram, onde foi
  // confirmado. No Facebook o mesmo 100 costuma ser outra coisa (parâmetro,
  // URI de retorno) — mandar cadastrar testador ali seria mandar para o lugar
  // errado.
  return provider === "instagram" && metaCode === "meta_400_100" &&
    reasonCode === "long_lived_token_exchange_failed";
}

export function metaConnectErrorMessage(input: MetaConnectErrorInput): string {
  const codigo = input.metaCode ? ` (código da Meta: ${input.metaCode})` : "";

  if (isAppRoleMissing(input)) {
    return input.provider === "instagram"
      ? "Esta conta do Instagram ainda não tem acesso ao app da Meta. Até a Meta aprovar o acesso avançado, adicione a conta como testadora (app da Meta → Funções do app → Testadores do Instagram), peça para o cliente aceitar o convite no Instagram, em Configurações → Apps e sites, e conecte de novo." +
        codigo
      : "Esta conta do Facebook ainda não tem acesso ao app da Meta. Até a Meta aprovar o acesso avançado, adicione a pessoa como testadora (app da Meta → Funções do app → Testadores) e peça para ela aceitar o convite — ou conecte com o login da agência, se ele administra a Página do cliente." +
        codigo;
  }

  if (input.reasonCode === "oauth_denied_by_user") {
    return "A conexão foi cancelada na tela da Meta.";
  }

  return `Não foi possível conectar: ${input.reasonCode ?? "erro"}` +
    (input.metaCode ? ` (Meta respondeu: ${input.metaCode})` : "");
}
