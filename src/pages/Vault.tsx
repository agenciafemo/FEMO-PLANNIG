import { useMemo, useState } from "react";
import { KeyRound, Lock, LockOpen, Plus, Settings, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, EmptyState, StatusBadge } from "@/components/common";
import { AddCredentialDialog } from "@/components/vault/AddCredentialDialog";
import { ClientVaultGroup } from "@/components/vault/ClientVaultGroup";
import { VaultSettingsDialog } from "@/components/vault/VaultSettingsDialog";
import { useVault } from "@/hooks/useVault";
import { unlockDurationLabel, type SanitizedCredential } from "@/lib/vaultRpc";

// Cofre: status, configuração, criar, desbloquear, bloquear, cadastrar acesso,
// listagem SANITIZADA agrupada por cliente e revelar/copiar com auditoria.

const MIN_MASTER_PASSWORD = 12;
const VAULT_BREADCRUMB = [{ label: "Administrativo" }, { label: "Cofre" }];

export default function Vault() {
  const {
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
    updateUnlockDuration,
    unlock,
    lock,
  } = useVault();

  // Senha mestre vive apenas em memória, durante o submit. Nunca em storage.
  const [requireMasterPassword, setRequireMasterPassword] = useState(true);
  const [newMasterPassword, setNewMasterPassword] = useState("");
  const [unlockPassword, setUnlockPassword] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleClient = (clientId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(clientId) ? next.delete(clientId) : next.add(clientId);
      return next;
    });

  // Escolher um cliente abre só ele; voltar para "todos" fecha tudo. Fechar
  // desmonta os cards e descarta senhas reveladas.
  const handleFilterChange = (value: string) => {
    setClientFilter(value);
    setExpanded(value === "all" ? new Set() : new Set([value]));
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createVault.mutate(
      {
        requireMasterPassword,
        masterPassword: requireMasterPassword ? newMasterPassword : null,
      },
      { onSuccess: () => setNewMasterPassword("") },
    );
  };

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    unlock.mutate(unlockPassword, { onSettled: () => setUnlockPassword("") });
  };

  const credentials = credentialsQuery.data ?? [];
  const clients = clientsQuery.data ?? [];

  // Estes memos ficam acima dos early returns de propósito: a contagem de hooks
  // precisa ser estável entre o render sem cofre e o render com cofre.
  const clientNameById = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);

  const visibleCredentials = useMemo(
    () => (clientFilter === "all" ? credentials : credentials.filter((c) => c.client_id === clientFilter)),
    [credentials, clientFilter],
  );

  // Agrupa por cliente; a RPC só traz client_id, o nome vem do mapa.
  // Clientes sem credencial não geram grupo: a lista nasce das credenciais.
  const groups = useMemo(() => {
    const nome = (id: string) => clientNameById.get(id) ?? "Cliente removido";
    const byClient = new Map<string, SanitizedCredential[]>();
    for (const cred of visibleCredentials) {
      const list = byClient.get(cred.client_id) ?? [];
      list.push(cred);
      byClient.set(cred.client_id, list);
    }
    for (const list of byClient.values()) {
      list.sort((a, b) => a.platform.localeCompare(b.platform, "pt-BR"));
    }
    return [...byClient.entries()].sort((a, b) => nome(a[0]).localeCompare(nome(b[0]), "pt-BR"));
  }, [visibleCredentials, clientNameById]);

  // ---- Estados de borda -----------------------------------------------------

  if (isLegacy || !available) {
    return (
      <div className="space-y-6">
        <PageHeader title="Cofre" subtitle="Acessos e senhas dos clientes" breadcrumb={VAULT_BREADCRUMB} />
        <EmptyState
          icon={ShieldAlert}
          title="Cofre indisponível"
          description="O Cofre é organizado por equipe. Ative o modo multi-organização para usar esta área."
        />
      </div>
    );
  }

  if (statusQuery.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Cofre" subtitle="Acessos e senhas dos clientes" breadcrumb={VAULT_BREADCRUMB} />
        <Card className="animate-pulse"><CardContent className="h-32" /></Card>
      </div>
    );
  }

  if (statusQuery.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Cofre" subtitle="Acessos e senhas dos clientes" breadcrumb={VAULT_BREADCRUMB} />
        <EmptyState
          icon={ShieldAlert}
          title="Não foi possível carregar o cofre"
          description={(statusQuery.error as any)?.message ?? "Tente novamente em instantes."}
          action={<Button variant="outline" size="sm" onClick={() => statusQuery.refetch()}>Tentar de novo</Button>}
        />
      </div>
    );
  }

  // ---- Sem cofre ------------------------------------------------------------

  if (!vault) {
    return (
      <div className="space-y-6">
        <PageHeader title="Cofre" subtitle="Acessos e senhas dos clientes" breadcrumb={VAULT_BREADCRUMB} />
        {canManageVault ? (
          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                  <KeyRound className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-h3 text-foreground">Criar o cofre da equipe</h2>
                  <p className="mt-1 text-small text-muted-foreground">
                    As senhas dos clientes ficam cifradas. Você pode exigir uma senha mestre para
                    liberar o acesso a cada sessão.
                  </p>
                </div>
              </div>

              <form onSubmit={handleCreate} className="space-y-4">
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <Label htmlFor="require-mp">Exigir senha mestre</Label>
                    <p className="text-caption text-muted-foreground">
                      Recomendado. Cada pessoa autorizada desbloqueia na própria sessão.
                    </p>
                  </div>
                  <Switch id="require-mp" checked={requireMasterPassword} onCheckedChange={setRequireMasterPassword} />
                </div>

                {requireMasterPassword && (
                  <div className="space-y-2">
                    <Label htmlFor="new-mp">Senha mestre</Label>
                    <Input
                      id="new-mp"
                      type="password"
                      autoComplete="new-password"
                      value={newMasterPassword}
                      onChange={(e) => setNewMasterPassword(e.target.value)}
                      placeholder={`Mínimo de ${MIN_MASTER_PASSWORD} caracteres`}
                    />
                    <p className="text-caption text-muted-foreground">
                      Não é possível recuperá-la depois — guarde em local seguro.
                    </p>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={
                    createVault.isPending ||
                    (requireMasterPassword && newMasterPassword.length < MIN_MASTER_PASSWORD)
                  }
                >
                  {createVault.isPending ? "Criando..." : "Criar cofre"}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          // get_organization_vault_status devolve 0 linhas tanto quando o cofre
          // não existe quanto quando o usuário não tem acesso a ele. Sem poder
          // distinguir os dois casos pela RPC, quem não pode criar cofre recebe
          // a leitura mais provável — e a que não mente sobre a equipe.
          <EmptyState
            icon={ShieldAlert}
            title="Cofre indisponível"
            description="Você ainda não tem acesso ao Cofre desta organização. Peça a um owner ou admin para liberar."
          />
        )}
      </div>
    );
  }

  // ---- Cofre existente ------------------------------------------------------

  const unlocked = !vault.require_master_password || vault.is_unlocked_for_me;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cofre"
        subtitle="Acessos e senhas dos clientes"
        breadcrumb={VAULT_BREADCRUMB}
        actions={
          unlocked ? (
            <>
              {/* A RPC de configuração exige 'manage_settings' (hoje só
                  owner/admin) e o cofre destrancado — por isso o botão vive
                  aqui dentro. Esconder é UX; quem decide é o banco. */}
              {canManageVault && (
                <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
                  <Settings className="mr-2 h-4 w-4" />
                  Configurações
                </Button>
              )}
              {vault.require_master_password && (
                <Button variant="outline" size="sm" onClick={() => lock.mutate()} disabled={lock.isPending}>
                  <Lock className="mr-2 h-4 w-4" />
                  {lock.isPending ? "Bloqueando..." : "Bloquear"}
                </Button>
              )}
              {canManageVault && (
                <Button size="sm" onClick={() => setAddOpen(true)} disabled={clients.length === 0}>
                  <Plus className="mr-2 h-4 w-4" />
                  Adicionar acesso
                </Button>
              )}
            </>
          ) : undefined
        }
      />

      {/* Status */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <span
              className={
                unlocked
                  ? "flex h-10 w-10 items-center justify-center rounded-xl bg-success-soft text-success"
                  : "flex h-10 w-10 items-center justify-center rounded-xl bg-warning-soft text-warning"
              }
            >
              {unlocked ? <LockOpen className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
            </span>
            <div>
              <p className="text-sm font-semibold text-foreground">
                {unlocked ? "Cofre desbloqueado" : "Cofre bloqueado"}
              </p>
              <p className="text-caption text-muted-foreground">
                {vault.require_master_password
                  ? `Exige senha mestre · sessão de ${unlockDurationLabel(vault.unlock_duration_minutes)}`
                  : "Sem senha mestre · acesso pelo login e permissão"}
              </p>
            </div>
          </div>
          <StatusBadge
            variant={vault.status === "active" ? (unlocked ? "success" : "warning") : "danger"}
            size="sm"
          >
            {vault.status === "active" ? (unlocked ? "Ativo" : "Bloqueado") : "Suspenso"}
          </StatusBadge>
        </CardContent>
      </Card>

      {/* Desbloqueio */}
      {!unlocked && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-h3 text-foreground">Desbloquear o cofre</h2>
                <p className="mt-1 text-small text-muted-foreground">
                  Informe a senha mestre para liberar o acesso nesta sessão.
                </p>
              </div>
            </div>
            <form onSubmit={handleUnlock} className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="password"
                autoComplete="off"
                value={unlockPassword}
                onChange={(e) => setUnlockPassword(e.target.value)}
                placeholder="Senha mestre"
                className="sm:max-w-xs"
              />
              <Button type="submit" disabled={unlock.isPending || !unlockPassword}>
                <LockOpen className="mr-2 h-4 w-4" />
                {unlock.isPending ? "Desbloqueando..." : "Desbloquear"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Credenciais (sanitizadas) */}
      {unlocked && (
        <div className="space-y-3">
          {credentialsQuery.isLoading ? (
            <Card className="animate-pulse"><CardContent className="h-24" /></Card>
          ) : credentialsQuery.isError ? (
            <EmptyState
              icon={ShieldAlert}
              title="Não foi possível listar os acessos"
              description={(credentialsQuery.error as any)?.message ?? "Tente novamente."}
              action={<Button variant="outline" size="sm" onClick={() => credentialsQuery.refetch()}>Tentar de novo</Button>}
            />
          ) : credentials.length === 0 ? (
            <EmptyState
              icon={KeyRound}
              title="Nenhum acesso cadastrado"
              description={
                clients.length === 0
                  ? "Cadastre um cliente antes de guardar acessos no cofre."
                  : "Guarde aqui as senhas dos clientes, cifradas no cofre da equipe."
              }
              action={
                canManageVault && clients.length > 0 ? (
                  <Button size="sm" onClick={() => setAddOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Adicionar primeiro acesso
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Select value={clientFilter} onValueChange={handleFilterChange}>
                  <SelectTrigger className="w-full sm:w-64">
                    <SelectValue placeholder="Todos os clientes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os clientes</SelectItem>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {groups.length === 0 ? (
                <EmptyState
                  icon={KeyRound}
                  title="Nenhum acesso para este cliente"
                  description="Troque o filtro ou cadastre um acesso para ele."
                  variant="inline"
                />
              ) : (
                groups.map(([clientId, creds]) => (
                  <ClientVaultGroup
                    key={clientId}
                    clientId={clientId}
                    clientName={clientNameById.get(clientId) ?? "Cliente removido"}
                    credentials={creds}
                    open={expanded.has(clientId)}
                    onToggle={() => toggleClient(clientId)}
                  />
                ))
              )}
            </>
          )}
        </div>
      )}

      {canManageVault && (
        <AddCredentialDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          clients={clients}
          createCredential={createCredential}
        />
      )}

      {canManageVault && (
        <VaultSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          currentMinutes={vault.unlock_duration_minutes}
          updateUnlockDuration={updateUnlockDuration}
        />
      )}
    </div>
  );
}
