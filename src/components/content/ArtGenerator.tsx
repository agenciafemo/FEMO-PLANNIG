import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, ExternalLink, Image as ImageIcon, Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { generateArt } from "@/lib/contentImage";

const ASPECTS = [
  { value: "1:1", label: "Quadrado (1:1)" },
  { value: "4:5", label: "Feed retrato (4:5)" },
  { value: "9:16", label: "Story (9:16)" },
  { value: "16:9", label: "Paisagem (16:9)" },
];

export function ArtGenerator({ clientId }: { clientId: string }) {
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState("1:1");
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const generate = useMutation({
    mutationFn: () => generateArt({ clientId, prompt: prompt.trim(), aspectRatio: aspect }),
    onSuccess: (url) => {
      setImageUrl(url);
      toast.success("Arte gerada!");
    },
    onError: (e: unknown) => toast.error("Erro ao gerar a arte: " + (e as Error).message),
  });

  return (
    <div className="mt-4 rounded-2xl border border-brand/20 bg-surface p-5 shadow-xs">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-primary-foreground">
          <Wand2 className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-sm font-semibold">Gerar arte com IA</h3>
          <p className="text-xs text-muted-foreground">
            Usa as referências de design e o estilo da marca deste cliente. Rascunho — revise antes de usar.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <div className="space-y-1.5">
          <Label className="text-xs">Direção da arte</Label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="Descreva a arte. Dica: cole a 'direção visual' que a IA gerou no conteúdo. Ex.: fundo minimalista azul, foto de uma pele saudável, espaço para texto no topo."
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Formato</Label>
          <Select value={aspect} onValueChange={setAspect}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ASPECTS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button
            className="mt-1 w-full gap-2"
            disabled={!clientId || !prompt.trim() || generate.isPending}
            onClick={() => generate.mutate()}
          >
            {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {generate.isPending ? "Gerando…" : "Gerar arte"}
          </Button>
        </div>
      </div>

      {generate.isPending && (
        <div className="mt-4 flex aspect-square max-w-sm animate-pulse items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <ImageIcon className="h-8 w-8" />
        </div>
      )}

      {imageUrl && !generate.isPending && (
        <div className="mt-4 space-y-2">
          <div className="max-w-sm overflow-hidden rounded-xl border border-border">
            <img src={imageUrl} alt="Arte gerada" className="w-full" />
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={imageUrl} download target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline" className="gap-1.5"><Download className="h-3.5 w-3.5" /> Baixar</Button>
            </a>
            <a href={imageUrl} target="_blank" rel="noreferrer">
              <Button size="sm" variant="ghost" className="gap-1.5"><ExternalLink className="h-3.5 w-3.5" /> Abrir</Button>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
