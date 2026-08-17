import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImagePlus, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import {
  deleteDesignReference,
  loadDesignReferences,
  saveDesignReference,
  uploadDesignImage,
  type DesignReference,
} from "@/lib/contentDesignRefs";

const MAX_MB = 8;

export function DesignReferencesTab({
  organizationId,
  clientId,
}: {
  organizationId: string;
  clientId: string;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const key = ["design-refs", organizationId, clientId];
  const refsQuery = useQuery({
    queryKey: key,
    queryFn: () => loadDesignReferences(organizationId, clientId),
    enabled: !!organizationId && !!clientId,
  });

  const add = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Escolha uma imagem.");
      if (!user) throw new Error("Sessão expirada.");
      if (file.size > MAX_MB * 1024 * 1024) throw new Error(`Imagem acima de ${MAX_MB}MB.`);
      const { url, path } = await uploadDesignImage(organizationId, clientId, file);
      await saveDesignReference({
        organizationId,
        clientId,
        userId: user.id,
        imageUrl: url,
        storagePath: path,
        title,
        description,
      });
    },
    onSuccess: () => {
      toast.success("Referência adicionada!");
      setFile(null);
      setTitle("");
      setDescription("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const remove = useMutation({
    mutationFn: (ref: DesignReference) => deleteDesignReference(ref),
    onSuccess: () => {
      toast.success("Referência removida");
      queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const refs = refsQuery.data ?? [];

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Imagens de referência do estilo visual do cliente. A IA vai usá-las como base ao gerar
        artes (paleta, layout, mood). Adicione exemplos que representem bem a marca.
      </p>

      {/* Formulário de adição */}
      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" className="gap-2" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4" /> {file ? "Trocar imagem" : "Escolher imagem"}
          </Button>
          {file && <span className="truncate text-xs text-muted-foreground">{file.name}</span>}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Título (opcional)</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Post feed — estilo clean" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Descrição do estilo (opcional)</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Ex.: paleta azul e branco, tipografia serifada, muito espaço em branco, fotos reais."
          />
        </div>
        <Button className="gap-2" disabled={!file || add.isPending} onClick={() => add.mutate()}>
          {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          Adicionar referência
        </Button>
      </div>

      {/* Grade de referências */}
      {refsQuery.isLoading ? (
        <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando referências…
        </div>
      ) : refs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nenhuma referência ainda. Adicione a primeira acima.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {refs.map((ref) => (
            <div key={ref.id} className="group overflow-hidden rounded-xl border border-border bg-card">
              <div className="relative aspect-square w-full overflow-hidden bg-muted">
                <img src={ref.image_url} alt={ref.title ?? ""} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => remove.mutate(ref)}
                  disabled={remove.isPending}
                  className="absolute right-2 top-2 rounded-lg bg-background/85 p-1.5 text-destructive opacity-0 shadow-sm transition-opacity hover:bg-background group-hover:opacity-100"
                  aria-label="Remover"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {(ref.title || ref.description) && (
                <div className="space-y-0.5 p-2.5">
                  {ref.title && <p className="truncate text-xs font-medium">{ref.title}</p>}
                  {ref.description && <p className="line-clamp-2 text-[11px] text-muted-foreground">{ref.description}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
