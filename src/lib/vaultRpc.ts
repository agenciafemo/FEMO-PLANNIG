// ============================================================================
// vaultRpc.ts — Wrapper das RPCs PÚBLICAS do Cofre de Acessos.
//
// Contrato de segurança desta camada:
//   - Só chama RPCs SECURITY DEFINER validadas (GRANT apenas a authenticated).
//   - NUNCA faz SELECT direto em organization_vaults / client_credentials.
//   - NUNCA acessa password_encrypted, two_factor_notes_encrypted,
//     vault.secrets, vault.decrypted_secrets nem get_org_vault_dek.
//   - NUNCA usa as views internas (organization_vault_status,
//     client_credentials_view) como API — elas são privadas no banco.
//   - A senha mestre trafega só no argumento da RPC; nunca é persistida.
//
// types.ts ainda NÃO conhece o schema do Cofre (a migration está aplicada
// apenas no staging). Usamos dispatch cast `(supabase.rpc as any)` — mesmo
// padrão já adotado em publicRpc.ts — e tipamos os retornos à mão a partir do
// contrato da migration 20260706170000_organization_vaults.sql.
// >>> Regenerar types.ts do staging antes de produção e remover os casts.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Tipos (espelham o RETURNS da migration)
// ---------------------------------------------------------------------------

/** get_organization_vault_status — sem hash/salt/dek_secret_id (contrato sanitizado). */
export interface VaultStatus {
  vault_id: string;
  organization_id: string;
  status: string; // 'active' | 'suspended'
  require_master_password: boolean;
  unlock_duration_minutes: number;
  locked_until: string | null;
  created_at: string;
  is_unlocked_for_me: boolean;
}

/**
 * list_client_credentials — credencial SANITIZADA.
 * O contrato da RPC não devolve password_encrypted nem
 * two_factor_notes_encrypted; por isso não existem neste tipo.
 */
export interface SanitizedCredential {
  id: string;
  organization_id: string;
  client_id: string;
  vault_id: string;
  platform: string;
  url: string | null;
  username: string | null;
  notes: string | null;
  responsible_user_id: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * reveal_client_credential — segredos em claro.
 *
 * Este é o ÚNICO ponto do frontend onde senha e notas de 2FA existem em claro.
 * O valor não pode ir para o cache do React Query, localStorage, URL, console
 * nem log: só para estado local de componente, descartado ao ocultar/desmontar.
 */
export interface RevealedSecret {
  password: string;
  two_factor_notes: string | null;
}

/**
 * unlock_organization_vault devolve JSONB e NÃO lança em senha incorreta
 * (para o lockout ser persistido). Só lança em erro de contrato: sem login,
 * cofre inexistente/suspenso, cofre sem senha mestre, sem acesso.
 */
export type UnlockResult =
  | { ok: true; expires_at: string }
  | { ok: false; error: "invalid_master_password"; failed_attempts: number; locked_until: string | null }
  | { ok: false; error: "vault_locked"; locked_until: string | null; failed_attempts: number };

// ---------------------------------------------------------------------------
// Helpers de chamada
// ---------------------------------------------------------------------------

async function callRead<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase.rpc as any)(fn, args);
  if (error) throw error;
  return data as T;
}

async function callWrite<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase.rpc as any)(fn, args);
  if (error) throw error;
  return data as T;
}

async function callVoidWrite(fn: string, args: Record<string, unknown>): Promise<void> {
  const { error } = await (supabase.rpc as any)(fn, args);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// RPCs
// ---------------------------------------------------------------------------

/** RETURNS TABLE → 0 linhas significa "organização ainda não tem cofre" (ou sem acesso). */
export async function getOrganizationVaultStatus(organizationId: string): Promise<VaultStatus | null> {
  const rows = await callRead<VaultStatus[] | null>("get_organization_vault_status", {
    _organization_id: organizationId,
  });
  return rows && rows.length > 0 ? rows[0] : null;
}

/** Só owner/admin (a própria RPC valida). Senha mestre exige >= 12 caracteres. */
export async function createOrganizationVault(params: {
  organizationId: string;
  requireMasterPassword: boolean;
  masterPassword?: string | null;
}): Promise<string> {
  return callWrite<string>("create_organization_vault", {
    _organization_id: params.organizationId,
    _require_master_password: params.requireMasterPassword,
    _master_password: params.masterPassword ?? null,
  });
}

/** A senha só existe aqui como argumento; nunca é guardada. */
export async function unlockOrganizationVault(vaultId: string, masterPassword: string): Promise<UnlockResult> {
  return callWrite<UnlockResult>("unlock_organization_vault", {
    _vault_id: vaultId,
    _master_password: masterPassword,
  });
}

/** Encerra apenas a sessão de desbloqueio do próprio usuário. */
export async function lockOrganizationVault(vaultId: string): Promise<void> {
  return callVoidWrite("lock_organization_vault", { _vault_id: vaultId });
}

/**
 * Durações aceitas pelo banco. Espelha o CHECK
 * organization_vaults_unlock_duration_allowed e a validação dentro da RPC
 * (migration 20260716120000). Mudar esta lista sem migration quebra o save.
 */
export const UNLOCK_DURATION_OPTIONS = [
  { minutes: 15, label: "15 minutos" },
  { minutes: 60, label: "1 hora" },
  { minutes: 480, label: "8 horas" },
  { minutes: 10080, label: "1 semana" },
] as const;

export type UnlockDurationMinutes = (typeof UNLOCK_DURATION_OPTIONS)[number]["minutes"];

/** Rótulo humano; cai no cru se o banco tiver um valor fora da lista. */
export function unlockDurationLabel(minutes: number): string {
  return UNLOCK_DURATION_OPTIONS.find((o) => o.minutes === minutes)?.label ?? `${minutes} min`;
}

/** Exige 'manage_settings' — hoje só owner/admin, por herança de papel. */
export async function updateVaultUnlockDuration(vaultId: string, minutes: UnlockDurationMinutes): Promise<void> {
  return callVoidWrite("update_vault_unlock_duration", {
    _vault_id: vaultId,
    _unlock_duration_minutes: minutes,
  });
}

/**
 * Exige permissão 'manage' (não 'view') e o cofre desbloqueado.
 * A RPC deriva a organização a partir do cliente, cifra a senha e as notas de
 * 2FA com a DEK do cofre e registra o evento em credential_access_logs.
 * Aqui trafega texto puro no argumento; nada cifrado passa pelo frontend.
 */
export async function createClientCredential(params: {
  clientId: string;
  platform: string;
  password: string;
  url?: string | null;
  username?: string | null;
  notes?: string | null;
  twoFactorNotes?: string | null;
  responsibleUserId?: string | null;
}): Promise<string> {
  return callWrite<string>("create_client_credential", {
    _client_id: params.clientId,
    _platform: params.platform,
    _password: params.password,
    _url: params.url ?? null,
    _username: params.username ?? null,
    _notes: params.notes ?? null,
    _two_factor_notes: params.twoFactorNotes ?? null,
    _responsible_user_id: params.responsibleUserId ?? null,
  });
}

/**
 * Exige permissão 'reveal' (mais restrita que 'manage') e o cofre desbloqueado.
 * A própria RPC grava o evento 'revealed' em credential_access_logs — a
 * auditoria da revelação não depende do frontend.
 *
 * Quem chamar precisa manter o retorno apenas em estado local: ver RevealedSecret.
 */
export async function revealClientCredential(credentialId: string): Promise<RevealedSecret> {
  return callWrite<RevealedSecret>("reveal_client_credential", { _id: credentialId });
}

/** Só registra o evento 'copied'; não devolve segredo algum. Exige 'reveal'. */
export async function logClientCredentialCopy(credentialId: string): Promise<void> {
  return callVoidWrite("log_client_credential_copy", { _id: credentialId });
}

/** Exige permissão 'view' (e desbloqueio, se o cofre pedir senha mestre). */
export async function listClientCredentials(
  organizationId: string,
  clientId?: string | null,
): Promise<SanitizedCredential[]> {
  const rows = await callRead<SanitizedCredential[] | null>("list_client_credentials", {
    _organization_id: organizationId,
    _client_id: clientId ?? null,
  });
  return rows ?? [];
}
