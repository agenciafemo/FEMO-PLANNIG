import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, UserCheck, UserX, Mail } from "lucide-react";
import { toast } from "sonner";

export default function Collaborators() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");

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
      // Check if user exists with this email
      const { data: profile } = await supabase
        .from("profiles")
        .select("user_id")
        .eq("user_id", user!.id)
        .single();

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
      setOpen(false);
      setEmail("");
      toast.success("Colaborador adicionado! Ele precisa criar uma conta com este email para ter acesso.");
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Colaboradores</h1>
          <p className="text-muted-foreground">Gerencie quem tem acesso ao seu painel</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> Adicionar Colaborador</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Adicionar Colaborador</DialogTitle></DialogHeader>
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
                  O colaborador precisa criar uma conta no Femo Planning com este email para ter acesso.
                </p>
              </div>
              <Button type="submit" className="w-full" disabled={addMember.isPending}>
                {addMember.isPending ? "Adicionando..." : "Adicionar"}
              </Button>
            </form>
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
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                    <Mail className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{member.email}</p>
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
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 opacity-0 group-hover:opacity-100"
                  onClick={() => removeMember.mutate(member.id)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
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
