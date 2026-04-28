import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, Users, Image, Layers } from "lucide-react";
import { toast } from "sonner";

export default function Templates() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [replicateOpen, setReplicateOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [postCount, setPostCount] = useState(8);
  const [storiesCount, setStoriesCount] = useState(0);

  const { data: templates, isLoading } = useQuery({
    queryKey: ["templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("planning_templates")
        .select("*, template_posts(count)")
        .eq("user_id", user!.id)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: clients } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").eq("user_id", user!.id).order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const createTemplate = useMutation({
    mutationFn: async () => {
      const { data: template, error } = await supabase
        .from("planning_templates")
        .insert({
          user_id: user!.id,
          name,
          description,
          default_post_count: postCount,
          default_stories_count: storiesCount,
        } as any)
        .select()
        .single();
      if (error) throw error;

      const templatePosts = [
        ...Array.from({ length: postCount }, (_, i) => ({
          template_id: template.id,
          position: i,
          content_type: "static" as const,
        })),
        ...Array.from({ length: storiesCount }, (_, i) => ({
          template_id: template.id,
          position: postCount + i,
          content_type: "story" as const,
        })),
      ];
      if (templatePosts.length > 0) {
        await supabase.from("template_posts").insert(templatePosts);
      }
      return template;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      setOpen(false);
      setName("");
      setDescription("");
      setPostCount(8);
      setStoriesCount(0);
      toast.success("Template criado!");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("planning_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      toast.success("Template removido");
    },
  });

  const replicateTemplate = useMutation({
    mutationFn: async () => {
      const currentMonth = new Date().getMonth() + 1;
      const currentYear = new Date().getFullYear();

      const { data: templatePosts } = await supabase
        .from("template_posts")
        .select("*")
        .eq("template_id", selectedTemplate)
        .order("position");

      for (const clientId of selectedClients) {
        const { data: planning, error } = await supabase
          .from("plannings")
          .insert({ client_id: clientId, user_id: user!.id, month: currentMonth, year: currentYear })
          .select()
          .single();
        if (error) continue;

        if (templatePosts) {
          const posts = templatePosts.map((tp) => ({
            planning_id: planning.id,
            position: tp.position,
            content_type: tp.content_type,
            caption: tp.caption,
            hashtags: tp.hashtags,
          }));
          await supabase.from("posts").insert(posts);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plannings"] });
      setReplicateOpen(false);
      setSelectedClients([]);
      toast.success(`Template replicado para ${selectedClients.length} clientes!`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleClient = (clientId: string) => {
    setSelectedClients((prev) =>
      prev.includes(clientId) ? prev.filter((id) => id !== clientId) : [...prev, clientId]
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Templates</h1>
          <p className="text-muted-foreground">Modelos reutilizáveis de planejamento</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> Novo Template</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo Template</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); createTemplate.mutate(); }} className="space-y-4">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Padrão 12 posts + 15 stories" required />
              </div>
              <div className="space-y-2">
                <Label>Descrição</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descrição do template..." />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Image className="h-4 w-4" /> Posts do Feed ({postCount})
                  </Label>
                  <Input type="range" min={0} max={20} value={postCount} onChange={(e) => setPostCount(Number(e.target.value))} />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Layers className="h-4 w-4" /> Stories ({storiesCount})
                  </Label>
                  <Input type="range" min={0} max={30} value={storiesCount} onChange={(e) => setStoriesCount(Number(e.target.value))} />
                </div>
              </div>
              {/* Preview */}
              <div className="rounded-lg border bg-muted/50 p-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">Visualização</p>
                <div className="flex items-center gap-4">
                  <div className="text-center">
                    <div className="grid grid-cols-3 gap-0.5">
                      {Array.from({ length: Math.min(postCount, 9) }).map((_, i) => (
                        <div key={i} className="h-4 w-4 rounded-[2px] bg-primary/20" />
                      ))}
                    </div>
                    {postCount > 9 && <p className="text-[10px] text-muted-foreground mt-0.5">+{postCount - 9}</p>}
                    <p className="text-[10px] text-muted-foreground mt-1">{postCount} posts</p>
                  </div>
                  <div className="h-8 w-px bg-border" />
                  <div className="text-center">
                    <div className="flex gap-0.5">
                      {Array.from({ length: Math.min(storiesCount, 8) }).map((_, i) => (
                        <div key={i} className="h-6 w-4 rounded-full bg-primary/20" />
                      ))}
                    </div>
                    {storiesCount > 8 && <p className="text-[10px] text-muted-foreground mt-0.5">+{storiesCount - 8}</p>}
                    <p className="text-[10px] text-muted-foreground mt-1">{storiesCount} stories</p>
                  </div>
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={createTemplate.isPending || (postCount === 0 && storiesCount === 0)}>
                {createTemplate.isPending ? "Criando..." : "Criar Template"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <Card key={i} className="animate-pulse"><CardContent className="h-32" /></Card>)}
        </div>
      ) : templates && templates.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((t: any) => (
            <Card key={t.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-lg">{t.name}</CardTitle>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteTemplate.mutate(t.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}
                <div className="flex gap-3 text-sm">
                  <span className="flex items-center gap-1"><Image className="h-3.5 w-3.5" /> {t.default_post_count} posts</span>
                  {(t.default_stories_count || 0) > 0 && (
                    <span className="flex items-center gap-1"><Layers className="h-3.5 w-3.5" /> {t.default_stories_count} stories</span>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => { setSelectedTemplate(t.id); setReplicateOpen(true); }}
                >
                  <Users className="mr-1 h-4 w-4" /> Replicar para Clientes
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="mb-4 text-muted-foreground">Nenhum template criado</p>
            <Button onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" /> Criar Template</Button>
          </CardContent>
        </Card>
      )}

      {/* Replicate Dialog */}
      <Dialog open={replicateOpen} onOpenChange={setReplicateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Replicar Template para Clientes</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Selecione os clientes que receberão este template como planejamento do mês atual:</p>
            <div className="max-h-60 space-y-2 overflow-y-auto">
              {clients?.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent">
                  <input type="checkbox" checked={selectedClients.includes(c.id)} onChange={() => toggleClient(c.id)} className="rounded" />
                  <span className="font-medium">{c.name}</span>
                </label>
              ))}
            </div>
            <Button className="w-full" disabled={selectedClients.length === 0 || replicateTemplate.isPending} onClick={() => replicateTemplate.mutate()}>
              {replicateTemplate.isPending ? "Replicando..." : `Replicar para ${selectedClients.length} cliente(s)`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
