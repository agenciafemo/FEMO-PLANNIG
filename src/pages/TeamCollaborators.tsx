import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Edit3, Mail, Plus, Tags, Trash2, UserRound, UsersRound, X } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/common";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { ProfileDialog } from "@/components/layout/ProfileDialog";

type OrganizationRole = "owner" | "admin" | "manager" | "editor" | "viewer";

// Cargos que aparecem na "tag" do topo. O acesso deriva do cargo: Proprietário,
// Gestor e Head têm acesso total (owner/admin); Designer, Social mídia e Editor
// são membros (editor) e enxergam a mesma coisa. O rótulo específico fica em
// job_title (por isso os três "membros" continuam distinguíveis na tela).
type Cargo = { label: string; role: OrganizationRole; access: "full" | "member" };
const CARGOS: Cargo[] = [
  { label: "Proprietário", role: "owner", access: "full" },
  { label: "Gestor", role: "admin", access: "full" },
  { label: "Head", role: "admin", access: "full" },
  { label: "Designer", role: "editor", access: "member" },
  { label: "Social mídia", role: "editor", access: "member" },
  { label: "Editor", role: "editor", access: "member" },
];

function cargoFor(member: { job_title: string | null; role: OrganizationRole }): Cargo {
  return (
    CARGOS.find((c) => c.label === (member.job_title ?? "")) ??
    CARGOS.find((c) => c.role === member.role) ??
    CARGOS[CARGOS.length - 1]
  );
}

type DirectoryMember = {
  user_id: string;
  display_name: string;
  job_title: string | null;
  avatar_url: string | null;
};

type MembershipRow = {
  user_id: string;
  role: OrganizationRole;
};

type FunctionTag = {
  id: string;
  organization_id: string;
  name: string;
  color: string;
  created_at: string;
};

type MemberFunction = {
  organization_id: string;
  user_id: string;
  tag_id: string;
};

type TeamMember = DirectoryMember & {
  role: OrganizationRole;
  functions: FunctionTag[];
};

type TeamData = {
  members: TeamMember[];
  tags: FunctionTag[];
  assignments: MemberFunction[];
};

type TeamQueryError = {
  message: string;
  code?: string;
};

type TeamQueryResult<T> = {
  data: T | null;
  error: TeamQueryError | null;
};

interface TeamQueryBuilder<T> extends PromiseLike<TeamQueryResult<T>> {
  select(columns?: string): TeamQueryBuilder<T>;
  eq(column: string, value: unknown): TeamQueryBuilder<T>;
  order(column: string, options?: { ascending?: boolean }): TeamQueryBuilder<T>;
  insert(values: Record<string, unknown>): TeamQueryBuilder<T>;
  update(values: Record<string, unknown>): TeamQueryBuilder<T>;
  delete(): TeamQueryBuilder<T>;
}

import { PermissionsPanel } from "@/components/team/PermissionsPanel";

const teamSupabase = supabase as unknown as {
  from<T>(relation: string): TeamQueryBuilder<T>;
  rpc<T>(functionName: string, params: Record<string, unknown>): PromiseLike<TeamQueryResult<T>>;
};

const ROLE_LABELS: Record<OrganizationRole, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  manager: "Head",
  editor: "Membro",
  viewer: "Visualizador",
};

const DEFAULT_TAG_COLOR = "#0F766E";
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "U";
}

function readableTextColor(hex: string) {
  const value = hex.replace("#", "");
  if (value.length !== 6) return "#FFFFFF";
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  return luminance > 150 ? "#111827" : "#FFFFFF";
}

async function loadTeamData(organizationId: string): Promise<TeamData> {
  const [membersResult, directoryResult, tagsResult, assignmentsResult] = await Promise.all([
    teamSupabase.from<MembershipRow[]>("organization_members")
      .select("user_id, role")
      .eq("organization_id", organizationId)
      .eq("status", "active"),
    teamSupabase.rpc<DirectoryMember[]>("get_task_assignees", { _organization_id: organizationId }),
    teamSupabase.from<FunctionTag[]>("team_function_tags")
      .select("id, organization_id, name, color, created_at")
      .eq("organization_id", organizationId)
      .order("name", { ascending: true }),
    teamSupabase.from<MemberFunction[]>("team_member_functions")
      .select("organization_id, user_id, tag_id")
      .eq("organization_id", organizationId),
  ]);

  const firstError = membersResult.error
    ?? directoryResult.error
    ?? tagsResult.error
    ?? assignmentsResult.error;
  if (firstError) throw firstError;

  const memberships = (membersResult.data ?? []) as MembershipRow[];
  const directory = (directoryResult.data ?? []) as DirectoryMember[];
  const tags = (tagsResult.data ?? []) as FunctionTag[];
  const assignments = (assignmentsResult.data ?? []) as MemberFunction[];
  const directoryByUser = new Map(directory.map((member) => [member.user_id, member]));
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]));

  const members = memberships
    .map<TeamMember>((membership) => {
      const directoryMember = directoryByUser.get(membership.user_id);
      return {
        user_id: membership.user_id,
        display_name: directoryMember?.display_name ?? "Usuário",
        job_title: directoryMember?.job_title ?? null,
        avatar_url: directoryMember?.avatar_url ?? null,
        role: membership.role,
        functions: assignments
          .filter((assignment) => assignment.user_id === membership.user_id)
          .map((assignment) => tagsById.get(assignment.tag_id))
          .filter((tag): tag is FunctionTag => Boolean(tag))
          .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
      };
    })
    .sort((a, b) => a.display_name.localeCompare(b.display_name, "pt-BR"));

  return { members, tags, assignments };
}

function FunctionChip({
  tag,
  onRemove,
  disabled,
}: {
  tag: FunctionTag;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold shadow-sm"
      style={{ backgroundColor: tag.color, color: readableTextColor(tag.color) }}
    >
      {tag.name}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="rounded-full p-0.5 opacity-70 transition-opacity hover:bg-black/10 hover:opacity-100 disabled:pointer-events-none"
          aria-label={`Remover função ${tag.name}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

export default function TeamCollaborators() {
  const { organizationId, role } = useOrganization();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  // Só Proprietário/Gestor/Head (owner/admin) editam cargos e funções. Os demais
  // veem a tela em modo leitura. Cada pessoa edita apenas o PRÓPRIO perfil.
  const canManage = role === "owner" || role === "admin";
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteCargo, setInviteCargo] = useState<Cargo>(CARGOS[3]); // Designer (membro) por padrão
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [editingTag, setEditingTag] = useState<FunctionTag | null>(null);
  const [deletingTag, setDeletingTag] = useState<FunctionTag | null>(null);
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState(DEFAULT_TAG_COLOR);

  const teamQueryKey = ["team-function-management", organizationId];
  const teamQuery = useQuery({
    queryKey: teamQueryKey,
    queryFn: () => loadTeamData(organizationId!),
    enabled: Boolean(organizationId),
  });

  const invalidateTeam = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: teamQueryKey }),
    queryClient.invalidateQueries({ queryKey: ["my-functions", organizationId] }),
  ]);

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const email = inviteEmail.trim();
      if (!email) throw new Error("Informe um e-mail.");
      const { data, error } = await teamSupabase.rpc<{ token: string } | { token: string }[]>(
        "create_organization_invitation",
        { _organization_id: organizationId!, _email: email, _role: inviteCargo.role },
      );
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.token) throw new Error("Não foi possível gerar o link do convite.");
      return `${window.location.origin}/invite/${row.token}`;
    },
    onSuccess: (link) => {
      setInviteLink(link);
      toast.success("Convite criado! Copie o link e envie para a pessoa.");
    },
    onError: (error: { message?: string }) =>
      toast.error(error.message ?? "Não foi possível criar o convite."),
  });

  const cargoMutation = useMutation({
    mutationFn: async ({ userId, cargo }: { userId: string; cargo: Cargo }) => {
      const { error } = await teamSupabase.from<unknown>("organization_members")
        .update({ role: cargo.role, job_title: cargo.label })
        .eq("organization_id", organizationId!)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateTeam();
      toast.success("Cargo atualizado.");
    },
    onError: (error: { message?: string }) =>
      toast.error(error.message ?? "Não foi possível mudar o cargo. Verifique sua permissão."),
  });

  const assignmentMutation = useMutation({
    mutationFn: async ({ userId, tagId, assigned }: { userId: string; tagId: string; assigned: boolean }) => {
      if (assigned) {
        const { error } = await teamSupabase.from<unknown>("team_member_functions")
          .delete()
          .eq("organization_id", organizationId!)
          .eq("user_id", userId)
          .eq("tag_id", tagId);
        if (error) throw error;
        return;
      }

      const { error } = await teamSupabase.from<unknown>("team_member_functions").insert({
        organization_id: organizationId!,
        user_id: userId,
        tag_id: tagId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateTeam();
      toast.success("Funções do colaborador atualizadas.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveTagMutation = useMutation({
    mutationFn: async () => {
      const name = tagName.trim();
      const color = tagColor.toUpperCase();
      if (!name) throw new Error("Informe o nome da função.");
      if (!HEX_COLOR_PATTERN.test(color)) throw new Error("Informe uma cor hexadecimal válida.");

      if (editingTag) {
        const { error } = await teamSupabase.from<unknown>("team_function_tags")
          .update({ name, color })
          .eq("organization_id", organizationId!)
          .eq("id", editingTag.id);
        if (error) throw error;
        return "updated" as const;
      }

      const { error } = await teamSupabase.from<unknown>("team_function_tags").insert({
        organization_id: organizationId!,
        name,
        color,
      });
      if (error) throw error;
      return "created" as const;
    },
    onSuccess: (action) => {
      invalidateTeam();
      resetTagForm();
      toast.success(action === "created" ? "Função criada." : "Função atualizada.");
    },
    onError: (error: { message?: string; code?: string }) => {
      if (error.code === "23505") {
        toast.error("Já existe uma função com esse nome.");
        return;
      }
      toast.error(error.message ?? "Não foi possível salvar a função.");
    },
  });

  const deleteTagMutation = useMutation({
    mutationFn: async (tag: FunctionTag) => {
      const { error } = await teamSupabase.from<unknown>("team_function_tags")
        .delete()
        .eq("organization_id", organizationId!)
        .eq("id", tag.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateTeam();
      setDeletingTag(null);
      if (editingTag?.id === deletingTag?.id) resetTagForm();
      toast.success("Função excluída.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const assignedCountByTag = useMemo(() => {
    const counts = new Map<string, number>();
    for (const assignment of teamQuery.data?.assignments ?? []) {
      counts.set(assignment.tag_id, (counts.get(assignment.tag_id) ?? 0) + 1);
    }
    return counts;
  }, [teamQuery.data?.assignments]);

  function resetTagForm() {
    setEditingTag(null);
    setTagName("");
    setTagColor(DEFAULT_TAG_COLOR);
  }

  function startEditing(tag: FunctionTag) {
    setEditingTag(tag);
    setTagName(tag.name);
    setTagColor(tag.color);
  }

  function handleTagSubmit(event: FormEvent) {
    event.preventDefault();
    saveTagMutation.mutate();
  }

  if (teamQuery.isError) {
    return (
      <div className="nrt-surface -mx-4 -mt-4 min-h-screen px-4 py-6 sm:-mx-6 sm:-mt-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-[1100px]">
          <PageHeader
            title="Equipe / Colaboradores"
            subtitle="Organize as funções de trabalho da equipe."
            breadcrumb={[{ label: "Gestão da equipe" }, { label: "Colaboradores" }]}
          />
          <EmptyState
            icon={UsersRound}
            title="Não foi possível carregar a equipe"
            description="Confirme se a migration das tags foi aplicada neste ambiente e tente novamente."
            action={<Button onClick={() => teamQuery.refetch()}>Tentar novamente</Button>}
            className="mt-6"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="nrt-surface -mx-4 -mt-4 min-h-screen px-4 pb-16 pt-6 sm:-mx-6 sm:-mt-6 sm:px-6 sm:pt-8">
      <div className="mx-auto max-w-[1100px] space-y-6">
        <PageHeader
          title="Equipe"
          subtitle="Veja a equipe, os cargos e as funções de trabalho de cada pessoa."
          breadcrumb={[{ label: "Equipe" }]}
          actions={canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => { setInviteLink(null); setInviteEmail(""); setInviteOpen(true); }}>
                <Mail className="mr-2 h-4 w-4" />
                Convidar membro
              </Button>
              <Button variant="outline" onClick={() => setCatalogOpen(true)}>
                <Tags className="mr-2 h-4 w-4" />
                Gerenciar funções
              </Button>
            </div>
          ) : undefined}
        />

        {organizationId && user && (
          <PermissionsPanel
            organizationId={organizationId}
            currentUserId={user.id}
            podeEditar={role === "owner" || role === "admin"}
            membros={(teamQuery.data?.members ?? []).map((m) => ({
              user_id: m.user_id,
              display_name: m.display_name,
              role: m.role,
            }))}
          />
        )}

        <div className="rounded-2xl border border-border/70 bg-card/70 p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold">Colaboradores ativos</h2>
              <p className="text-sm text-muted-foreground">
                O cargo (tag do topo) define o acesso; as funções organizam o trabalho.
              </p>
            </div>
            {!teamQuery.isLoading && (
              <span className="text-xs text-muted-foreground">
                {teamQuery.data?.members.length ?? 0} {(teamQuery.data?.members.length ?? 0) === 1 ? "pessoa" : "pessoas"}
              </span>
            )}
          </div>
        </div>

        {teamQuery.isLoading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-40 rounded-2xl" />)}
          </div>
        ) : teamQuery.data && teamQuery.data.members.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {teamQuery.data.members.map((member) => (
              <Card key={member.user_id} className="border-border/70 bg-card/80 shadow-sm">
                <CardContent className="space-y-5 p-5">
                  <div className="flex items-start gap-3">
                    <Avatar className="h-11 w-11 border border-border/70">
                      {member.avatar_url && <AvatarImage src={member.avatar_url} alt={member.display_name} />}
                      <AvatarFallback className="bg-brand-soft text-sm font-semibold text-brand">
                        {initials(member.display_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">
                        {member.display_name}
                        {member.user_id === user?.id && (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">(você)</span>
                        )}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        {cargoFor(member).access === "full" ? "Acesso total" : "Membro"}
                      </p>
                    </div>
                    {canManage ? (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button className="inline-flex items-center gap-1 rounded-full border border-border/70 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:border-brand/50 hover:text-foreground">
                            {cargoFor(member).label}
                            <ChevronDown className="h-3 w-3" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-52 p-1">
                          <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">Cargo</p>
                          {CARGOS.map((cargo) => {
                            const active = cargoFor(member).label === cargo.label;
                            return (
                              <button
                                key={cargo.label}
                                type="button"
                                disabled={cargoMutation.isPending}
                                onClick={() => cargoMutation.mutate({ userId: member.user_id, cargo })}
                                className={cn(
                                  "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted",
                                  active && "bg-muted/60",
                                )}
                              >
                                <span>{cargo.label}</span>
                                <span className="flex items-center gap-1.5">
                                  <span className="text-[10px] text-muted-foreground">
                                    {cargo.access === "full" ? "acesso total" : "membro"}
                                  </span>
                                  {active && <Check className="h-4 w-4 text-brand" />}
                                </span>
                              </button>
                            );
                          })}
                        </PopoverContent>
                      </Popover>
                    ) : (
                      <span className="rounded-full border border-border/70 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {cargoFor(member).label}
                      </span>
                    )}
                  </div>

                  {member.user_id === user?.id && (
                    <Button variant="outline" size="sm" className="w-full" onClick={() => setProfileOpen(true)}>
                      <Edit3 className="mr-2 h-4 w-4" /> Editar meu perfil
                    </Button>
                  )}

                  <div className="space-y-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Funções
                    </p>
                    <div className="flex min-h-8 flex-wrap items-center gap-2">
                      {member.functions.map((tag) => (
                        <FunctionChip
                          key={tag.id}
                          tag={tag}
                          disabled={assignmentMutation.isPending}
                          onRemove={canManage ? () => assignmentMutation.mutate({
                            userId: member.user_id,
                            tagId: tag.id,
                            assigned: true,
                          }) : undefined}
                        />
                      ))}
                      {!canManage && member.functions.length === 0 && (
                        <span className="text-xs text-muted-foreground/60">Sem funções</span>
                      )}

                      {canManage && <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="h-7 rounded-full border-dashed text-xs">
                            <Plus className="mr-1 h-3.5 w-3.5" />
                            Adicionar função
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-64 p-2">
                          <p className="px-2 pb-2 pt-1 text-xs font-medium text-muted-foreground">
                            Funções disponíveis
                          </p>
                          {teamQuery.data.tags.length === 0 ? (
                            <div className="px-2 py-3 text-sm text-muted-foreground">
                              Crie uma função no gerenciador do catálogo.
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {teamQuery.data.tags.map((tag) => {
                                const assigned = member.functions.some((item) => item.id === tag.id);
                                return (
                                  <button
                                    key={tag.id}
                                    type="button"
                                    disabled={assignmentMutation.isPending}
                                    onClick={() => assignmentMutation.mutate({
                                      userId: member.user_id,
                                      tagId: tag.id,
                                      assigned,
                                    })}
                                    className={cn(
                                      "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-muted",
                                      assigned && "bg-muted/60",
                                    )}
                                  >
                                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: tag.color }} />
                                    <span className="flex-1">{tag.name}</span>
                                    {assigned && <Check className="h-4 w-4 text-brand" />}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </PopoverContent>
                      </Popover>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={UserRound}
            title="Nenhum colaborador ativo"
            description="Os membros ativos da organização aparecerão aqui."
          />
        )}
      </div>

      <Dialog
        open={catalogOpen}
        onOpenChange={(open) => {
          setCatalogOpen(open);
          if (!open) resetTagForm();
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Catálogo de funções</DialogTitle>
            <DialogDescription>
              Crie as funções usadas para classificar os colaboradores. Isso não altera permissões.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleTagSubmit} className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_170px]">
              <div className="space-y-2">
                <Label htmlFor="team-function-name">Nome</Label>
                <Input
                  id="team-function-name"
                  value={tagName}
                  onChange={(event) => setTagName(event.target.value)}
                  maxLength={80}
                  placeholder="Ex.: Social Mídia"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="team-function-color">Cor</Label>
                <div className="flex gap-2">
                  <Input
                    id="team-function-color"
                    type="color"
                    value={HEX_COLOR_PATTERN.test(tagColor) ? tagColor : DEFAULT_TAG_COLOR}
                    onChange={(event) => setTagColor(event.target.value.toUpperCase())}
                    className="h-10 w-12 cursor-pointer p-1"
                    aria-label="Selecionar cor"
                  />
                  <Input
                    value={tagColor}
                    onChange={(event) => setTagColor(event.target.value.toUpperCase())}
                    maxLength={7}
                    placeholder="#0F766E"
                    className="font-mono uppercase"
                  />
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              {editingTag && (
                <Button type="button" variant="ghost" onClick={resetTagForm}>
                  Cancelar edição
                </Button>
              )}
              <Button type="submit" disabled={saveTagMutation.isPending}>
                {editingTag ? <Edit3 className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
                {saveTagMutation.isPending ? "Salvando..." : editingTag ? "Salvar alterações" : "Criar função"}
              </Button>
            </div>
          </form>

          <div className="space-y-2">
            {(teamQuery.data?.tags ?? []).map((tag) => (
              <div key={tag.id} className="flex items-center gap-3 rounded-xl border border-border/70 p-3">
                <span className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{tag.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {assignedCountByTag.get(tag.id) ?? 0} {(assignedCountByTag.get(tag.id) ?? 0) === 1 ? "colaborador" : "colaboradores"}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => startEditing(tag)} aria-label={`Editar ${tag.name}`}>
                  <Edit3 className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDeletingTag(tag)}
                  aria-label={`Excluir ${tag.name}`}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
            {!teamQuery.isLoading && (teamQuery.data?.tags.length ?? 0) === 0 && (
              <EmptyState
                icon={Tags}
                title="Nenhuma função criada"
                description="Use o formulário acima para criar a primeira função."
                variant="inline"
              />
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCatalogOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deletingTag)} onOpenChange={(open) => !open && setDeletingTag(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir a função “{deletingTag?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              A função será removida de todos os colaboradores. As pessoas e suas permissões não serão alteradas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteTagMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (deletingTag) deleteTagMutation.mutate(deletingTag);
              }}
            >
              {deleteTagMutation.isPending ? "Excluindo..." : "Excluir função"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />

      <Dialog open={inviteOpen} onOpenChange={(open) => { setInviteOpen(open); if (!open) setInviteLink(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Convidar membro</DialogTitle>
            <DialogDescription>
              Gere um link de convite. A pessoa precisa entrar com <strong>este mesmo e-mail</strong> para aceitar.
            </DialogDescription>
          </DialogHeader>

          {inviteLink ? (
            <div className="space-y-3">
              <Label>Link do convite</Label>
              <div className="flex gap-2">
                <Input readOnly value={inviteLink} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { navigator.clipboard?.writeText(inviteLink); toast.success("Link copiado!"); }}
                >
                  Copiar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Envie este link para <strong>{inviteEmail}</strong>. Ele expira em 14 dias.
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" onClick={() => { setInviteLink(null); setInviteEmail(""); }}>Novo convite</Button>
                <Button onClick={() => setInviteOpen(false)}>Fechar</Button>
              </div>
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(event) => { event.preventDefault(); inviteMutation.mutate(); }}
            >
              <div className="space-y-2">
                <Label htmlFor="invite-email">E-mail</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="pessoa@empresa.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Cargo</Label>
                <div className="flex flex-wrap gap-2">
                  {CARGOS.filter((cargo) => cargo.role !== "owner").map((cargo) => (
                    <button
                      key={cargo.label}
                      type="button"
                      onClick={() => setInviteCargo(cargo)}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-sm transition-colors",
                        inviteCargo.label === cargo.label
                          ? "border-brand bg-brand-soft text-brand"
                          : "border-border/70 text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {cargo.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {inviteCargo.access === "full" ? "Acesso total à operação." : "Acesso de membro (mesma visão da equipe)."}
                </p>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={inviteMutation.isPending || !inviteEmail.trim()}>
                  {inviteMutation.isPending ? "Gerando…" : "Gerar link de convite"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
