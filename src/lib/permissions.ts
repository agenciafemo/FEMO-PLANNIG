import { supabase } from "@/integrations/supabase/client";

// As tabelas de permissão são novas e o types.ts gerado ainda não as conhece —
// mesmo padrão de cast já usado em TeamCollaborators.tsx e teamCalendar.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

/** Papéis editáveis. `owner` fica de fora de propósito: ele sempre pode tudo,
 *  e permitir tirar acesso dele deixaria a organização sem dono efetivo. */
export const PAPEIS_EDITAVEIS = ["admin", "manager", "editor", "viewer"] as const;
export type PapelEditavel = (typeof PAPEIS_EDITAVEIS)[number];

/** Nome do papel como a equipe o conhece, não como o banco o chama. */
export const PAPEL_LABEL: Record<string, string> = {
  owner: "Proprietário",
  admin: "Gestor / Head",
  manager: "Coordenação",
  editor: "Membro",
  viewer: "Visualização",
};

export interface Permissao {
  key: string;
  category: string;
  label: string;
  description: string;
  default_roles: string[];
  position: number;
}

export interface DesvioDeCargo {
  role: string;
  permission_key: string;
  allowed: boolean;
}

export interface DesvioDePessoa {
  user_id: string;
  permission_key: string;
  allowed: boolean;
}

export interface MapaDePermissoes {
  catalogo: Permissao[];
  porCargo: DesvioDeCargo[];
  porPessoa: DesvioDePessoa[];
}

export async function carregarPermissoes(
  organizationId: string,
): Promise<MapaDePermissoes> {
  const db = supabase as AnyClient;
  const [cat, cargo, pessoa] = await Promise.all([
    db.from("permissions").select("*").order("category").order("position"),
    db.from("organization_role_permissions")
      .select("role, permission_key, allowed")
      .eq("organization_id", organizationId),
    db.from("organization_member_permissions")
      .select("user_id, permission_key, allowed")
      .eq("organization_id", organizationId),
  ]);
  if (cat.error) throw new Error(cat.error.message);
  if (cargo.error) throw new Error(cargo.error.message);
  if (pessoa.error) throw new Error(pessoa.error.message);
  return {
    catalogo: (cat.data ?? []) as Permissao[],
    porCargo: (cargo.data ?? []) as DesvioDeCargo[],
    porPessoa: (pessoa.data ?? []) as DesvioDePessoa[],
  };
}

/**
 * O que vale para um cargo: o desvio da organização, se existir, senão o
 * padrão do catálogo. Espelha a mesma ordem que `has_permission()` usa no
 * banco — se as duas divergirem, a tela mente sobre o acesso real.
 */
export function permitidoParaCargo(
  mapa: MapaDePermissoes,
  permissao: Permissao,
  role: string,
): boolean {
  if (role === "owner") return true;
  const desvio = mapa.porCargo.find(
    (d) => d.role === role && d.permission_key === permissao.key,
  );
  if (desvio) return desvio.allowed;
  return permissao.default_roles.includes(role);
}

/** O acesso REAL de uma pessoa: a exceção dela vence o padrão do cargo. */
export function permitidoParaPessoa(
  mapa: MapaDePermissoes,
  permissao: Permissao,
  userId: string,
  role: string,
): { permitido: boolean; origem: "dono" | "pessoa" | "cargo" } {
  if (role === "owner") return { permitido: true, origem: "dono" };
  const excecao = mapa.porPessoa.find(
    (d) => d.user_id === userId && d.permission_key === permissao.key,
  );
  if (excecao) return { permitido: excecao.allowed, origem: "pessoa" };
  return { permitido: permitidoParaCargo(mapa, permissao, role), origem: "cargo" };
}

/**
 * Grava o desvio de um cargo. Quando o valor volta a coincidir com o padrão do
 * catálogo, a linha é APAGADA em vez de gravada como `false` — assim a tabela
 * guarda só o que a organização de fato mudou, e um padrão novo do produto
 * chega a quem nunca mexeu naquele interruptor.
 */
export async function salvarDesvioDeCargo(input: {
  organizationId: string;
  permissao: Permissao;
  role: string;
  permitido: boolean;
  updatedBy: string;
}): Promise<void> {
  const db = supabase as AnyClient;
  const ehOPadrao = input.permissao.default_roles.includes(input.role) === input.permitido;

  if (ehOPadrao) {
    const { error } = await db.from("organization_role_permissions").delete()
      .eq("organization_id", input.organizationId)
      .eq("role", input.role)
      .eq("permission_key", input.permissao.key);
    if (error) throw new Error(error.message);
    return;
  }

  const { data, error } = await db.from("organization_role_permissions")
    .upsert({
      organization_id: input.organizationId,
      role: input.role,
      permission_key: input.permissao.key,
      allowed: input.permitido,
      updated_at: new Date().toISOString(),
      updated_by: input.updatedBy,
    }, { onConflict: "organization_id,role,permission_key" })
    .select("permission_key");
  if (error) throw new Error(error.message);
  // Zero linhas com sucesso = a RLS barrou. Sem isto, a tela daria "salvo"
  // sobre uma gravação que não aconteceu — já aconteceu neste projeto.
  if (!data || data.length === 0) {
    throw new Error("Você não tem permissão para alterar isto.");
  }
}

/** Exceção de uma pessoa. `null` remove a exceção e devolve ela ao cargo. */
export async function salvarExcecaoDePessoa(input: {
  organizationId: string;
  userId: string;
  permissionKey: string;
  permitido: boolean | null;
  updatedBy: string;
}): Promise<void> {
  const db = supabase as AnyClient;

  if (input.permitido === null) {
    const { error } = await db.from("organization_member_permissions").delete()
      .eq("organization_id", input.organizationId)
      .eq("user_id", input.userId)
      .eq("permission_key", input.permissionKey);
    if (error) throw new Error(error.message);
    return;
  }

  const { data, error } = await db.from("organization_member_permissions")
    .upsert({
      organization_id: input.organizationId,
      user_id: input.userId,
      permission_key: input.permissionKey,
      allowed: input.permitido,
      updated_at: new Date().toISOString(),
      updated_by: input.updatedBy,
    }, { onConflict: "organization_id,user_id,permission_key" })
    .select("permission_key");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error("Você não tem permissão para alterar isto.");
  }
}
