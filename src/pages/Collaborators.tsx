import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, UserCheck, UserX, Mail, Copy, MessageCircle, Link } from "lucide-react";
import { toast } from "sonner";

const APP_URL = "https://app.femo.com.br";

function inviteLink(email: string) {
  return `${APP_URL}/auth?invite=${encodeURIComponent(email)}`;
}

function InviteActions({ email }: { email: string }) {
  const link = inviteLink(email);

  const copyLink = () => {
    navigator.clipboard.writeText(link);
    toast.success("Link copiado!");
  };

  const whatsapp = () => {
    const msg = encodeURIComponent(
      `Olá! Você foi convidado para acessar o Femo Planning.\n\nClique no link abaixo para criar sua conta:\n${link}`
    );
    window.open(`https://wa.me/?text=${msg}`, "_blank");
  };

  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={copyLink}>
        <Copy className="h-3 w-3" /> Copiar link
      </Button>
      <Button variant="outline" size="sm" className="h-7 gap-1 text-xs text-green-600 border-green-200 hover:bg-green-50" onClick={whatsapp}>
        <MessageCircle className="h-3 w-3" /> WhatsApp
      </Button>
    </div>
  );
}

export default function Collaborators() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [addedEmail, setAddedEmail] = useState<string | null>(null);

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
                    const msg = encodeURIComponent(
                      `Olá! Você foi convidado para acessar o Femo Planning.\n\nClique no link abaixo para criar sua conta:\n${inviteLink(addedEmail)}`
                    );
                    window.open(`https://wa.me/?text=${msg}`, "_blank");
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
                      <InviteActions email={member.email} />
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
