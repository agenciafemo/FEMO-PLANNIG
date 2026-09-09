// Regras da senha, separadas da tela para poderem ser testadas — e para que a
// mensagem que a pessoa lê seja a MESMA regra que barra o salvamento.
//
// A senha em si nunca passa por aqui em repouso: quem a guarda é o Supabase
// Auth, com hash bcrypt no serviço de autenticação. Nem o Norteia nem o banco
// da agência veem a senha de ninguém. Este arquivo só decide se ela é forte o
// bastante ANTES de mandar.

/** Curto demais é o erro mais comum, e o mais fácil de quebrar por força bruta. */
export const MINIMO_DE_CARACTERES = 8;

export interface ResultadoDaSenha {
  ok: boolean;
  /** Vazio quando ok. Uma frase só: lista de regras vira ruído. */
  erro: string;
}

/**
 * Diz se a senha serve, e por quê quando não serve.
 *
 * Deliberadamente NÃO exige símbolo obrigatório nem maiúscula: essa regra
 * empurra para "Senha@123", que é previsível, e leva as pessoas a anotarem a
 * senha num papel. Comprimento e não ser óbvia protegem mais.
 */
export function avaliarSenha(
  senha: string,
  confirmacao: string,
  email?: string | null,
): ResultadoDaSenha {
  if (!senha) return { ok: false, erro: "Digite a nova senha." };

  if (senha.length < MINIMO_DE_CARACTERES) {
    return {
      ok: false,
      erro: `A senha precisa de pelo menos ${MINIMO_DE_CARACTERES} caracteres.`,
    };
  }

  // Espaço nas pontas quase sempre é engano de colar, e trancaria a pessoa
  // fora sem ela entender o motivo.
  if (senha !== senha.trim()) {
    return { ok: false, erro: "A senha não pode começar nem terminar com espaço." };
  }

  if (/^\d+$/.test(senha)) {
    return { ok: false, erro: "Só números é fácil de adivinhar. Misture letras." };
  }

  // Repetição de um caractere só ("aaaaaaaa") passa no comprimento e não
  // protege nada.
  if (new Set(senha).size < 4) {
    return { ok: false, erro: "A senha é repetitiva demais. Varie os caracteres." };
  }

  const usuarioDoEmail = (email ?? "").split("@")[0]?.trim().toLowerCase();
  if (usuarioDoEmail && usuarioDoEmail.length >= 3 &&
      senha.toLowerCase().includes(usuarioDoEmail)) {
    return { ok: false, erro: "A senha não pode conter seu e-mail." };
  }

  if (senha !== confirmacao) {
    // Confirmar existe justamente porque um erro de digitação aqui tranca a
    // pessoa para fora da própria conta.
    return { ok: false, erro: "As duas senhas não são iguais." };
  }

  return { ok: true, erro: "" };
}
