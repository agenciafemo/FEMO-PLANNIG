import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import {
  createClientCredential,
  createOrganizationVault,
  getOrganizationVaultStatus,
  listClientCredentials,
  lockOrganizationVault,
  unlockOrganizationVault,
  type VaultStatus,
} from "@/lib/vaultRpc";

/** Cliente da organização, só o necessário para vincular uma credencial. */
export interface VaultClient {
  id: string;
  name: string;
}

// Camada de dados do Cofre para a UI. Só usa as RPCs públicas do vaultRpc.
// Nenhum segredo é lido ou persistido aqui: a senha mestre só é passada como
// argumento da RPC de desbloqueio e descartada em seguida.

export function useVault() {
  const { organizationId, role, isLegacy } = useOrganization();
  const queryClient = useQueryClient();

  // O Cofre é por organização: no modo legado não existe organization_id real.
  const available = !isLegacy && !!organizationId;

  const statusQuery = useQuery({
    queryKey: ["vault-status", organizationId],
    queryFn: () => getOrganizationVaultStatus(organizationId!),
    enabled: available,
  });

  const vault = statusQuery.data ?? null;

  // Criar cofre é restrito a owner/admin (a RPC também valida no banco).
  const canManageVault = role === "owner" || role === "admin";

  // Só há acesso à listagem com cofre ativo e destrancado para este usuário —
  // evita a chamada que a RPC recusaria com 400.
  const canListCredentials =
    !!vault && vault.status === "active" && (!vault.require_master_password || vault.is_unlocked_for_me);

  const credentialsQuery = useQuery({
    queryKey: ["vault-credentials", organizationId],
    queryFn: () => listClientCredentials(organizationId!),
    enabled: available && canListCredentials,
    // 400 por permissão ou cofre bloqueado não melhora repetindo.
    retry: false,
  });

  // Chave própria de propósito: a página de Clientes cacheia a linha inteira em
  // ["clients", organizationId]. Reusar a chave com um select mais estreito
  // serviria uma linha truncada para aquela tela.
  const clientsQuery = useQuery({
    queryKey: ["vault-clients", organizationId],
    queryFn: async () => {
      let query = supabase.from("clients").select("id, name") as any;
      if (!isLegacy) query = query.eq("organization_id", organizationId!);
      const { data, error } = await query.order("name");
      if (error) throw error;
      return (data ?? []) as VaultClient[];
    },
    enabled: available,
  });

  const invalidateStatus = () => queryClient.invalidateQueries({ queryKey: ["vault-status", organizationId] });

  const invalidateVault = () => {
    invalidateStatus();
    queryClient.invalidateQueries({ queryKey: ["vault-credentials", organizationId] });
  };

  /**
   * Descarta as credenciais do cache quando o cofre deixa de estar acessível.
   *
   * A ordem importa. Primeiro marcamos is_unlocked_for_me = false no cache do
   * status: isso desabilita a query de credenciais no mesmo render. Sem esse
   * passo, o observer continuaria habilitado até o status voltar do servidor e
   * o removeQueries dispararia um refetch novo contra um cofre já trancado —
   * exatamente o 400 que queremos eliminar.
   */
  const dropCredentials = () => {
    queryClient.setQueryData<VaultStatus | null>(["vault-status", organizationId], (old) =>
      old ? { ...old, is_unlocked_for_me: false } : old,
    );
    queryClient.removeQueries({ queryKey: ["vault-credentials", organizationId] });
  };

  const createVault = useMutation({
    mutationFn: (params: { requireMasterPassword: boolean; masterPassword?: string | null }) =>
      createOrganizationVault({ organizationId: organizationId!, ...params }),
    onSuccess: () => {
      invalidateVault();
      toast.success("Cofre criado!");
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível criar o cofre"),
  });

  const unlock = useMutation({
    mutationFn: (masterPassword: string) => unlockOrganizationVault(vault!.vault_id, masterPassword),
    onSuccess: (result) => {
      // A RPC devolve ok=false em senha incorreta (não lança), para o lockout
      // ser persistido — por isso o tratamento acontece aqui no onSuccess.
      if (result.ok) {
        invalidateVault();
        toast.success("Cofre desbloqueado.");
        return;
      }
      // Falha no desbloqueio: o cofre segue trancado, então o status basta —
      // revalidar credenciais aqui só produziria 400.
      if (result.error === "invalid_master_password") {
        invalidateStatus();
        toast.error("Senha mestre incorreta.");
        return;
      }
      invalidateStatus();
      toast.error("Cofre bloqueado temporariamente por tentativas incorretas. Tente novamente mais tarde.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível desbloquear o cofre"),
  });

  // Exige permissão 'manage' no cofre — mais restrita que a 'view' da listagem.
  // Quem decide é o banco; a UI só evita o caminho obviamente inválido.
  const createCredential = useMutation({
    mutationFn: (params: {
      clientId: string;
      platform: string;
      password: string;
      url?: string | null;
      username?: string | null;
      notes?: string | null;
      twoFactorNotes?: string | null;
    }) => createClientCredential(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vault-credentials", organizationId] });
      toast.success("Acesso cadastrado!");
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível cadastrar o acesso"),
  });

  const lock = useMutation({
    mutationFn: () => lockOrganizationVault(vault!.vault_id),
    onSuccess: () => {
      dropCredentials();
      invalidateStatus();
      toast.success("Cofre bloqueado.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível bloquear o cofre"),
  });

  return {
    available,
    isLegacy,
    vault,
    canManageVault,
    canListCredentials,
    statusQuery,
    credentialsQuery,
    clientsQuery,
    createVault,
    createCredential,
    unlock,
    lock,
  };
}
