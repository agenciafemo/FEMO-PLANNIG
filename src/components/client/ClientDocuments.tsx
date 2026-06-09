import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, FolderOpen, Download } from "lucide-react";
import { toast } from "sonner";

interface ClientDocumentsProps {
  clientId: string;
}

export function ClientDocuments({ clientId }: ClientDocumentsProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [docName, setDocName] = useState("");
  const [docDescription, setDocDescription] = useState("");
  const [docCategory, setDocCategory] = useState("geral");
  const [uploading, setUploading] = useState(false);

  const { data: documents } = useQuery({
    queryKey: ["client-documents", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_documents")
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const deleteDoc = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("client_documents").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-documents", clientId] });
      toast.success("Documento removido");
    },
  });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !docName.trim()) {
      toast.error("Preencha o nome e selecione um arquivo");
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${clientId}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("client-documents").upload(path, file);
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("client-documents").getPublicUrl(path);

      const { error } = await supabase.from("client_documents").insert({
        client_id: clientId,
        user_id: user!.id,
        name: docName,
        description: docDescription || null,
        file_url: urlData.publicUrl,
        category: docCategory,
      } as any);
      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ["client-documents", clientId] });
      setOpen(false);
      setDocName("");
      setDocDescription("");
      toast.success("Documento enviado!");
    } catch (err: any) {
      toast.error(err.message || "Erro no upload");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Documentos</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm"><Plus className="mr-1 h-3 w-3" /> Adicionar</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo Documento</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input value={docName} onChange={(e) => setDocName(e.target.value)} placeholder="Ex: Logo principal" required />
              </div>
              <div className="space-y-2">
                <Label>Descrição (opcional)</Label>
                <Input value={docDescription} onChange={(e) => setDocDescription(e.target.value)} placeholder="Ex: Versão horizontal PNG" />
              </div>
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Select value={docCategory} onValueChange={setDocCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="identidade_visual">Identidade Visual</SelectItem>
                    <SelectItem value="manual_marca">Manual da Marca</SelectItem>
                    <SelectItem value="fotos">Fotos</SelectItem>
                    <SelectItem value="geral">Geral</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Arquivo</Label>
                <Input type="file" onChange={handleUpload} disabled={uploading || !docName.trim()} />
                {uploading && <p className="text-xs text-muted-foreground">Enviando...</p>}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {documents && documents.length > 0 ? (
        <div className="space-y-2">
          {documents.map((doc: any) => (
            <Card key={doc.id}>
              <CardContent className="flex items-center justify-between p-3">
                <div className="flex items-center gap-2 min-w-0">
                  <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{doc.name}</p>
                    <p className="text-xs text-muted-foreground">{doc.category === "identidade_visual" ? "Identidade Visual" : doc.category === "manual_marca" ? "Manual da Marca" : doc.category === "fotos" ? "Fotos" : "Geral"}</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <a href={doc.file_url} target="_blank" rel="noopener noreferrer">
                    <Button variant="ghost" size="sm"><Download className="h-3 w-3" /></Button>
                  </a>
                  <Button variant="ghost" size="sm" onClick={() => deleteDoc.mutate(doc.id)}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Nenhum documento</p>
      )}
    </div>
  );
}
