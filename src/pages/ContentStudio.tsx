import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, BookOpenText, FileText, GalleryHorizontalEnd, Loader2, Sparkles, Video } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { GeneratedContentResult } from "@/components/content/GeneratedContentResult";
import { EmptyState, PageHeader } from "@/components/common";
import { ArtGenerator } from "@/components/content/ArtGenerator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useOrganization } from "@/hooks/useOrganization";
import {
  ContentChannel,
  ContentFormat,
  ContentGenerationResult,
  generateClientContent,
} from "@/lib/contentGeneration";
import { loadClients, loadContentBase } from "@/lib/contentKnowledge";
import { cn } from "@/lib/utils";

const FORMATS: Array<{ value: ContentFormat; title: string; description: string; icon: typeof FileText }> = [
  { value: "post", title: "Post", description: "Copy e legenda para uma peça única", icon: FileText },
  { value: "carousel", title: "Carrossel", description: "Sequência de slides, legenda e direção visual", icon: GalleryHorizontalEnd },
  { value: "video_script", title: "Roteiro", description: "Blocos de fala para Reels ou vídeo", icon: Video },
];

function friendlyGenerationError(error: Error) {
  const message = error.message.toLowerCase();
  if (message.includes("content_profile_required")) return "Complete o dossiê deste cliente antes de gerar conteúdo.";
  if (message.includes("forbidden")) return "Seu perfil não possui permissão para gerar conteúdo.";
  if (message.includes("function") || message.includes("fetch") || message.includes("non-2xx")) {
    return "A geração ainda não está disponível neste ambiente. Confirme o deploy da Edge Function generate-content.";
  }
  return "Não foi possível gerar o conteúdo agora. Tente novamente em instantes.";
}

export default function ContentStudio() {
  const { organizationId, role } = useOrganization();
  const canGenerate = role === "owner" || role === "admin" || role === "manager" || role === "editor";
  const [clientId, setClientId] = useState("");
  const [format, setFormat] = useState<ContentFormat>("carousel");
  const [channel, setChannel] = useState<ContentChannel>("instagram");
  const [topic, setTopic] = useState("");
  const [objective, setObjective] = useState("Educar e gerar interesse");
  const [audienceFocus, setAudienceFocus] = useState("");
  const [extraInstructions, setExtraInstructions] = useState("");
  const [carouselSlides, setCarouselSlides] = useState(7);
  const [durationSeconds, setDurationSeconds] = useState(60);
  const [result, setResult] = useState<ContentGenerationResult | null>(null);

  const clientsQuery = useQuery({
    queryKey: ["content-studio-clients", organizationId],
    queryFn: () => loadClients(organizationId!),
    enabled: Boolean(organizationId),
  });

  useEffect(() => {
    if (!clientId && clientsQuery.data?.length) setClientId(clientsQuery.data[0].id);
  }, [clientId, clientsQuery.data]);

  const baseQuery = useQuery({
    queryKey: ["content-studio-base", organizationId, clientId],
    queryFn: () => loadContentBase(organizationId!, clientId),
    enabled: Boolean(organizationId && clientId),
  });

  useEffect(() => setResult(null), [clientId, format]);

  const selectedClient = useMemo(
    () => clientsQuery.data?.find((client) => client.id === clientId),
    [clientId, clientsQuery.data],
  );

  const contextStats = useMemo(() => ({
    profile: Boolean(baseQuery.data?.profile.id),
    knowledge: baseQuery.data?.items.filter((item) => item.status === "active").length ?? 0,
    claims: baseQuery.data?.claims.length ?? 0,
    rules: baseQuery.data?.rules.filter((item) => item.status === "active").length ?? 0,
  }), [baseQuery.data]);

  const generateMutation = useMutation({
    mutationFn: () => generateClientContent({
      clientId,
      format,
      channel,
      topic,
      objective,
      audienceFocus,
      extraInstructions,
      carouselSlides,
      durationSeconds,
    }),
    onSuccess: (data) => {
      setResult(data);
      toast.success("Rascunho gerado com a base do cliente.");
    },
    onError: (error: Error) => toast.error(friendlyGenerationError(error)),
  });

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!clientId) return toast.error("Selecione um cliente.");
    if (!topic.trim()) return toast.error("Descreva o tema do conteúdo.");
    if (!contextStats.profile) return toast.error("Complete o dossiê do cliente antes de gerar.");
    generateMutation.mutate();
  };

  return (
    <div className="nrt-surface -mx-4 -mt-4 min-h-screen px-4 pb-16 pt-6 sm:-mx-6 sm:-mt-6 sm:px-6 sm:pt-8">
      <div className="mx-auto max-w-[1180px] space-y-6">
        <PageHeader
          title="Estúdio de Conteúdo"
          subtitle="Crie copies e roteiros orientados pelo dossiê aprovado de cada cliente."
          breadcrumb={[{ label: "Conteúdo" }, { label: "Estúdio" }]}
          actions={<Button asChild variant="outline"><Link to="/conteudo/base"><BookOpenText className="mr-2 h-4 w-4" />Gerenciar base</Link></Button>}
        />

        <Alert className="border-brand/20 bg-brand-soft/30">
          <Sparkles className="h-4 w-4 text-brand" />
          <AlertTitle>A IA consulta o banco, não o navegador</AlertTitle>
          <AlertDescription>Identidade, claims e regras são lidos novamente no servidor a cada geração. O resultado sempre nasce como rascunho editável.</AlertDescription>
        </Alert>

        <div className="grid gap-6 lg:grid-cols-[390px_minmax(0,1fr)]">
          <form onSubmit={submit} className="space-y-4">
            <Card className="border-border/70 bg-card/80 lg:sticky lg:top-6">
              <CardHeader><CardTitle>Novo conteúdo</CardTitle><CardDescription>Defina a intenção criativa. O tom e os limites vêm da base.</CardDescription></CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-1.5">
                  <Label>Cliente</Label>
                  <Select value={clientId} onValueChange={setClientId}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{(clientsQuery.data ?? []).map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent></Select>
                </div>

                {clientId && !baseQuery.isLoading && (
                  <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
                    <div className="flex items-center justify-between"><p className="text-xs font-semibold">Base de {selectedClient?.name}</p><Badge variant={contextStats.profile ? "secondary" : "destructive"}>{contextStats.profile ? "Dossiê pronto" : "Dossiê incompleto"}</Badge></div>
                    <p className="mt-2 text-xs text-muted-foreground">{contextStats.knowledge} referências · {contextStats.claims} claims · {contextStats.rules} regras</p>
                    {!contextStats.profile && <Button asChild variant="link" className="mt-1 h-auto p-0 text-xs"><Link to="/conteudo/base">Completar base <ArrowRight className="ml-1 h-3 w-3" /></Link></Button>}
                  </div>
                )}

                <div className="space-y-2"><Label>Formato</Label><div className="grid gap-2">{FORMATS.map((item) => { const Icon = item.icon; return <button key={item.value} type="button" onClick={() => setFormat(item.value)} className={cn("flex items-center gap-3 rounded-xl border p-3 text-left transition-colors", format === item.value ? "border-brand bg-brand-soft/50" : "border-border/70 hover:bg-muted/40")}><span className={cn("rounded-lg p-2", format === item.value ? "bg-brand text-primary-foreground" : "bg-muted text-muted-foreground")}><Icon className="h-4 w-4" /></span><span><span className="block text-sm font-semibold">{item.title}</span><span className="block text-xs text-muted-foreground">{item.description}</span></span></button>; })}</div></div>

                <div className="space-y-1.5"><Label>Canal</Label><Select value={channel} onValueChange={(value: ContentChannel) => setChannel(value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="instagram">Instagram</SelectItem><SelectItem value="facebook">Facebook</SelectItem><SelectItem value="both">Instagram e Facebook</SelectItem></SelectContent></Select></div>
                <div className="space-y-1.5"><Label htmlFor="content-topic">Tema ou ideia central</Label><Textarea id="content-topic" value={topic} onChange={(event) => setTopic(event.target.value)} rows={4} maxLength={500} placeholder="Ex.: explicar quando uma pinta precisa ser avaliada por um dermatologista" required /></div>
                <div className="space-y-1.5"><Label htmlFor="content-objective">Objetivo</Label><Input id="content-objective" value={objective} onChange={(event) => setObjective(event.target.value)} maxLength={500} /></div>
                <div className="space-y-1.5"><Label htmlFor="audience-focus">Recorte de público <span className="font-normal text-muted-foreground">(opcional)</span></Label><Input id="audience-focus" value={audienceFocus} onChange={(event) => setAudienceFocus(event.target.value)} maxLength={500} placeholder="Ex.: mulheres de 30 a 45 anos" /></div>

                {format === "carousel" && <div className="space-y-1.5"><Label htmlFor="slides-count">Quantidade de slides</Label><Input id="slides-count" type="number" min={3} max={12} value={carouselSlides} onChange={(event) => setCarouselSlides(Number(event.target.value))} /></div>}
                {format === "video_script" && <div className="space-y-1.5"><Label htmlFor="video-duration">Duração estimada (segundos)</Label><Input id="video-duration" type="number" min={15} max={180} step={15} value={durationSeconds} onChange={(event) => setDurationSeconds(Number(event.target.value))} /></div>}

                <div className="space-y-1.5"><Label htmlFor="extra-instructions">Orientações desta peça <span className="font-normal text-muted-foreground">(opcional)</span></Label><Textarea id="extra-instructions" value={extraInstructions} onChange={(event) => setExtraInstructions(event.target.value)} rows={3} maxLength={2000} placeholder="Ex.: evitar termos técnicos e terminar com uma pergunta" /><p className="text-[11px] text-muted-foreground">Estas orientações não substituem claims e regras cadastradas.</p></div>
                <Button type="submit" className="w-full" disabled={!canGenerate || generateMutation.isPending || !contextStats.profile || !topic.trim()}>{generateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}{generateMutation.isPending ? "Criando rascunho..." : "Gerar conteúdo"}</Button>
                {!canGenerate && <p className="text-center text-xs text-muted-foreground">Seu perfil possui acesso somente para leitura.</p>}
              </CardContent>
            </Card>
          </form>

          <div className="min-w-0">
            {clientsQuery.isLoading || baseQuery.isLoading ? <Skeleton className="h-[520px] rounded-2xl" /> : result ? <GeneratedContentResult content={result.content} contextSummary={result.context_summary} onChange={(content) => setResult({ ...result, content })} onRegenerate={() => submit()} /> : <EmptyState icon={Sparkles} title="Seu rascunho aparecerá aqui" description="Selecione o cliente, escolha o formato e descreva o tema. A IA usará apenas a base aprovada no Norteia." className="min-h-[520px]" />}
          </div>
        </div>

        {clientId && <ArtGenerator clientId={clientId} />}
      </div>
    </div>
  );
}
