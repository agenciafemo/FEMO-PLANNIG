import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { useOrganizationRole } from "@/hooks/useOrganizationRole";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, UserCheck, UserX, Mail, Copy, MessageCircle, Link, Clock } from "lucide-react";
import { toast } from "sonner";

type OrgRole = "owner" | "admin" | "manager" | "editor" | "viewer";

const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Dono",
  admin: "Admin",
  manager: "Gestor",
  editor: "Editor",
  viewer: "Visualizador",
};

function whatsappLink(link: string) {
  return `https://wa.me/?text=${encodeURIComponent(
    `Olá! Você foi convidado para acessar o painel.\n\nClique no link abaixo para entrar:\n${link}`
  )}`;
}

// Fluxo original de convite por email (tabela "team_members"), preservado
// sem alteração enquanto VITE_MULTI_ORG_ENABLED=false. Não usa nenhuma
// tabela ou RPC da migration multi-org.
function LegacyCollaborators() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [addedEmail, setAddedEmail] = useState<string | null>(null);

  const inviteLink = (inviteEmail: string) => `${window.location.origin}/auth?invite=${encodeURIComponent(inviteEmail)}`;

  const { data: members, isLoading } = useQuery({
    queryKey: ["team_members"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_members")
        .select("*")
        .eq("owner_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const addMember = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("team_members").insert({
        owner_id: user!.id,
        email: email.toLowerCase().trim(),
      });
      if (error) {
        if (error.code === "23505") throw new Error("Este email já foi adicionado");
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team_members"] });
      setAddedEmail(email.toLowerCase().trim());
      setEmail("");
      toast.success("Colaborador adicionado!");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const removeMember = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("team_members").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team_members"] });
      toast.success("Colaborador removido");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleClose = (v: boolean) => {
    setOpen(v);
    if (!v) { setEmail(""); setAddedEmail(null); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Colaboradores</h1>
          <p className="text-muted-foreground">Gerencie quem tem acesso ao seu painel</p>
        </div>
        <Dialog open={open} onOpenChange={handleClose}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> Adicionar Colaborador</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Adicionar Colaborador</DialogTitle></DialogHeader>

            {addedEmail ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                  <p className="font-medium mb-1">Colaborador adicionado!</p>
                  <p>Envie o link de cadastro para <strong>{addedEmail}</strong>:</p>
                </div>

                <div className="rounded-lg border bg-muted p-3 text-xs break-all text-muted-foreground flex items-start gap-2">
                  <Link className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
                  {inviteLink(addedEmail)}
                </div>

                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => {
                    navigator.clipboard.writeText(inviteLink(addedEmail));
                    toast.success("Link copiado!");
                  }}>
                    <Copy className="mr-2 h-4 w-4" /> Copiar link
                  </Button>
                  <Button variant="outline" className="flex-1 text-green-600 border-green-200 hover:bg-green-50" onClick={() => {
                    window.open(whatsappLink(inviteLink(addedEmail)), "_blank");
                  }}>
                    <MessageCircle className="mr-2 h-4 w-4" /> WhatsApp
                  </Button>
                </div>

                <Button variant="ghost" className="w-full" onClick={() => setAddedEmail(null)}>
                  Adicionar outro
                </Button>
              </div>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); addMember.mutate(); }} className="space-y-4">
                <div className="space-y-2">
                  <Label>Email do colaborador</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="colaborador@email.com"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Após adicionar, você receberá um link de convite para enviar ao colaborador.
                  </p>
                </div>
                <Button type="submit" className="w-full" disabled={addMember.isPending}>
                  {addMember.isPending ? "Adicionando..." : "Adicionar e gerar link"}
                </Button>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => <Card key={i} className="animate-pulse"><CardContent className="h-16" /></Card>)}
        </div>
      ) : members && members.length > 0 ? (
        <div className="space-y-3">
          {members.map((member) => (
            <Card key={member.id} className="group transition-shadow hover:shadow-md">
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <Mail className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium truncate">{member.email}</p>
                      <div className="flex items-center gap-1.5 text-xs">
                        {member.user_id ? (
                          <span className="flex items-center gap-1 text-green-600">
                            <UserCheck className="h-3 w-3" /> Ativo
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <UserX className="h-3 w-3" /> Aguardando cadastro
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!member.user_id && (
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => {
                          navigator.clipboard.writeText(inviteLink(member.email));
                          toast.success("Link copiado!");
                        }}>
                          <Copy className="h-3 w-3" /> Copiar link
                        </Button>
                        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs text-green-600 border-green-200 hover:bg-green-50" onClick={() => {
                          window.open(whatsappLink(inviteLink(member.email)), "_blank");
                        }}>
                          <MessageCircle className="h-3 w-3" /> WhatsApp
                        </Button>
                      </div>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 opacity-0 group-hover:opacity-100"
                      onClick={() => removeMember.mutate(member.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="mb-2 text-muted-foreground">Nenhum colaborador cadastrado</p>
            <p className="mb-4 text-sm text-muted-foreground">Adicione colaboradores para compartilhar o acesso ao painel</p>
            <Button onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" /> Adicionar Colaborador</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Fluxo novo baseado em organização (organization_members / organization_invitations).
// Só é montado quando isLegacy === false, ou seja, com a migration multi-org
// já aplicada e confirmada pelo OrganizationContext.
function RealCollaborators() {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const { isOwnerOrAdmin } = useOrganizationRole();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("editor");
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const { data: members, isLoading: loadingMembers } = useQuery({
    queryKey: ["organization-members", organizationId],
    queryFn: async () => {
      const { data: rows, error } = await (supabase.from("organization_members" as any) as any)
        .select("id, user_id, role, status, created_at")
        .eq("organization_id", organizationId!)
        .eq("status", "active")
        .order("created_at", { ascending: false });
      if (error) throw error;
      if (!rows || rows.length === 0) return [];

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", rows.map((r: any) => r.user_id));

      return rows.map((r: any) => ({
        ...r,
        profile: (profiles as any[] | null)?.find((p) => p.id === r.user_id) ?? null,
      }));
    },
    enabled: !!organizationId,
  });

  const { data: invitations, isLoading: loadingInvitations } = useQuery({
    queryKey: ["organization-invitations", organizationId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("organization_invitations" as any) as any)
        .select("*")
        .eq("organization_id", organizationId!)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!organizationId && isOwnerOrAdmin,
    retry: false,
  });

  const invite = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase.from("organization_invitations" as any) as any)
        .insert({
          organization_id: organizationId!,
          email: email.toLowerCase().trim(),
          role,
          created_by: user!.id,
        })
        .select()
        .single();
      if (error) {
        if (error.code === "23505") throw new Error("Já existe um convite pendente para este email");
        throw error;
      }
      return data;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["organization-invitations", organizationId] });
      setCreatedToken(data.token);
      setEmail("");
      toast.success("Convite criado!");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const revokeInvitation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from("organization_invitations" as any) as any).update({ status: "revoked" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization-invitations", organizationId] });
      toast.success("Convite revogado");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const removeMember = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from("organization_members" as any) as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization-members", organizationId] });
      toast.success("Membro removido");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleClose = (v: boolean) => {
    setOpen(v);
    if (!v) {
      setEmail("");
      setRole("editor");
      setCreatedToken(null);
    }
  };

  const inviteLink = (token: string) => `${window.location.origin}/invite/${token}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Colaboradores</h1>
          <p className="text-muted-foreground">Gerencie quem tem acesso à sua equipe</p>
        </div>
        {isOwnerOrAdmin && (
          <Dialog open={open} onOpenChange={handleClose}>
            <DialogTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" /> Convidar Colaborador</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Convidar Colaborador</DialogTitle></DialogHeader>

              {createdToken ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                    <p className="font-medium mb-1">Convite criado!</p>
                    <p>Envie o link de convite para o colaborador:</p>
                  </div>

                  <div className="rounded-lg border bg-muted p-3 text-xs break-all text-muted-foreground flex items-start gap-2">
                    <Link className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
                    {inviteLink(createdToken)}
                  </div>

                  <div className="flex gap-2">
                    <Button className="flex-1" onClick={() => {
                      navigator.clipboard.writeText(inviteLink(createdToken));
                      toast.success("Link copiado!");
                    }}>
                      <Copy className="mr-2 h-4 w-4" /> Copiar link
                    </Button>
                    <Button variant="outline" className="flex-1 text-green-600 border-green-200 hover:bg-green-50" onClick={() => {
                      window.open(whatsappLink(inviteLink(createdToken)), "_blank");
                    }}>
                      <MessageCircle className="mr-2 h-4 w-4" /> WhatsApp
                    </Button>
                  </div>

                  <Button variant="ghost" className="w-full" onClick={() => setCreatedToken(null)}>
                    Convidar outro
                  </Button>
                </div>
              ) : (
                <form onSubmit={(e) => { e.preventDefault(); invite.mutate(); }} className="space-y-4">
                  <div className="space-y-2">
                    <Label>Email do colaborador</Label>
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="colaborador@email.com"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Papel</Label>
                    <Select value={role} onValueChange={(v) => setRole(v as OrgRole)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="manager">Gestor</SelectItem>
                        <SelectItem value="editor">Editor</SelectItem>
                        <SelectItem value="viewer">Visualizador</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Após criar, você receberá um link de convite para enviar ao colaborador.
                  </p>
                  <Button type="submit" className="w-full" disabled={invite.isPending}>
                    {invite.isPending ? "Criando..." : "Criar convite"}
                  </Button>
                </form>
              )}
            </DialogContent>
          </Dialog>
        )}
      </div>

      {loadingMembers ? (
        <div className="space-y-3">
          {[1, 2].map((i) => <Card key={i} className="animate-pulse"><CardContent className="h-16" /></Card>)}
        </div>
      ) : (
        <div className="space-y-3">
          {members?.map((member: any) => {
            const profile = member.profile;
            return (
              <Card key={member.id} className="group transition-shadow hover:shadow-md">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                        <Mail className="h-5 w-5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium truncate">{profile?.full_name || "Usuário"}</p>
                        <p className="text-xs text-muted-foreground">{ROLE_LABELS[member.role as OrgRole]}</p>
                      </div>
                    </div>
                    {isOwnerOrAdmin && member.role !== "owner" && member.user_id !== user?.id && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 opacity-0 group-hover:opacity-100"
                        onClick={() => removeMember.mutate(member.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {isOwnerOrAdmin && !loadingInvitations && invitations && invitations.length > 0 && (
            <>
              <p className="pt-2 text-sm font-medium text-muted-foreground">Convites pendentes</p>
              {invitations.map((inv: any) => (
                <Card key={inv.id} className="group transition-shadow hover:shadow-md">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
                          <Clock className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium truncate">{inv.email}</p>
                          <p className="text-xs text-muted-foreground">{ROLE_LABELS[inv.role as OrgRole]} · aguardando aceite</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => {
                          navigator.clipboard.writeText(inviteLink(inv.token));
                          toast.success("Link copiado!");
                        }}>
                          <Copy className="h-3 w-3" /> Copiar link
                        </Button>
                        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs text-green-600 border-green-200 hover:bg-green-50" onClick={() => {
                          window.open(whatsappLink(inviteLink(inv.token)), "_blank");
                        }}>
                          <MessageCircle className="h-3 w-3" /> WhatsApp
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 opacity-0 group-hover:opacity-100"
                          onClick={() => revokeInvitation.mutate(inv.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function Collaborators() {
  const { isLegacy, loading } = useOrganization();

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => <Card key={i} className="animate-pulse"><CardContent className="h-16" /></Card>)}
      </div>
    );
  }

  return isLegacy ? <LegacyCollaborators /> : <RealCollaborators />;
}
