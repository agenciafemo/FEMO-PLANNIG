import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BookOpenText,
  CheckCircle2,
  FileText,
  Library,
  Loader2,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  UsersRound,
} from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { DesignReferencesTab } from "@/components/content/DesignReferencesTab";
import {
  arrayToLines,
  ClaimStatus,
  ComplianceRule,
  ContentClaim,
  ContentProfile,
  contentDb,
  EMPTY_PROFILE,
  KnowledgeItem,
  KnowledgeType,
  linesToArray,
  loadClients,
  loadContentBase,
  RuleSeverity,
} from "@/lib/contentKnowledge";

const KNOWLEDGE_LABELS: Record<KnowledgeType, string> = {
  briefing: "Briefing",
  product_service: "Produto ou serviço",
  faq: "Pergunta frequente",
  regulation: "Regulamento",
  reference: "Referência",
  approved_example: "Exemplo aprovado",
  rejected_example: "Exemplo rejeitado",
};

const CLAIM_LABELS: Record<ClaimStatus, string> = {
  approved: "Aprovado",
  prohibited: "Proibido",
  review_required: "Exige revisão",
};

const SEVERITY_LABELS: Record<RuleSeverity, string> = {
  info: "Informativa",
  warning: "Atenção",
  block: "Bloqueante",
};

type KnowledgeDraft = {
  id?: string;
  item_type: KnowledgeType;
  title: string;
  content: string;
  source_url: string;
  tags: string;
  effective_from: string;
  effective_until: string;
};

type ClaimDraft = {
  id?: string;
  claim_text: string;
  status: ClaimStatus;
  source_title: string;
  source_url: string;
  usage_notes: string;
  effective_from: string;
  effective_until: string;
};

type RuleDraft = {
  id?: string;
  scope: "client" | "organization";
  segment: string;
  title: string;
  rule_text: string;
  severity: RuleSeverity;
  channels: string;
  source_title: string;
  source_url: string;
  version: number;
  effective_from: string;
  effective_until: string;
  exceptions: string;
};

type EditorState =
  | { kind: "knowledge"; draft: KnowledgeDraft }
  | { kind: "claim"; draft: ClaimDraft }
  | { kind: "rule"; draft: RuleDraft };

type DeleteTarget = { relation: string; id: string; label: string };

function optional(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

function safeExternalUrl(value: string | null | undefined) {
  return value && /^https?:\/\//i.test(value) ? value : null;
}

function ListField({ id, label, value, onChange, hint }: {
  id: string;
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  hint?: string;
}) {
  const [draft, setDraft] = useState(arrayToLines(value));

  useEffect(() => {
    setDraft(arrayToLines(value));
  }, [value]);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onChange(linesToArray(draft))}
        rows={4}
        placeholder="Um item por linha"
      />
      <p className="text-[11px] text-muted-foreground">{hint ?? "Use uma linha para cada item."}</p>
    </div>
  );
}

function RecordCard({ title, description, badges, sourceUrl, onEdit, onDelete, canEdit }: {
  title: string;
  description: string;
  badges: string[];
  sourceUrl?: string | null;
  onEdit: () => void;
  onDelete: () => void;
  canEdit: boolean;
}) {
  return (
    <Card className="border-border/70 bg-card/80 shadow-sm">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold">{title}</p>
            <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-muted-foreground">{description}</p>
          </div>
          {canEdit && (
            <div className="flex shrink-0 gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit} aria-label="Editar">
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={onDelete} aria-label="Excluir">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {badges.map((badge) => <Badge key={badge} variant="secondary">{badge}</Badge>)}
        </div>
        {safeExternalUrl(sourceUrl) && (
          <a href={safeExternalUrl(sourceUrl)!} target="_blank" rel="noreferrer" className="block truncate text-xs font-medium text-brand hover:underline">
            Abrir fonte
          </a>
        )}
      </CardContent>
    </Card>
  );
}

export default function ContentKnowledge() {
  const { user } = useAuth();
  const { organizationId, role } = useOrganization();
  const queryClient = useQueryClient();
  const canEdit = role === "owner" || role === "admin" || role === "manager" || role === "editor";
  const canManageCompliance = role === "owner" || role === "admin" || role === "manager";
  const [clientId, setClientId] = useState("");
  const [profile, setProfile] = useState<ContentProfile>({ ...EMPTY_PROFILE });
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const clientsQuery = useQuery({
    queryKey: ["content-knowledge-clients", organizationId],
    queryFn: () => loadClients(organizationId!),
    enabled: Boolean(organizationId),
  });

  useEffect(() => {
    if (!clientId && clientsQuery.data?.length) setClientId(clientsQuery.data[0].id);
  }, [clientId, clientsQuery.data]);

  const baseKey = ["content-knowledge-base", organizationId, clientId];
  const baseQuery = useQuery({
    queryKey: baseKey,
    queryFn: () => loadContentBase(organizationId!, clientId),
    enabled: Boolean(organizationId && clientId),
  });

  useEffect(() => {
    setProfile(baseQuery.data?.profile ? { ...baseQuery.data.profile } : { ...EMPTY_PROFILE });
  }, [baseQuery.data?.profile]);

  const selectedClient = useMemo(
    () => clientsQuery.data?.find((client) => client.id === clientId),
    [clientId, clientsQuery.data],
  );

  const invalidateBase = () => queryClient.invalidateQueries({ queryKey: baseKey });

  const saveProfile = useMutation({
    mutationFn: async () => {
      if (!organizationId || !clientId || !user) throw new Error("Selecione um cliente.");
      const { id: _id, ...fields } = profile;
      const query = profile.id
        ? contentDb.from<unknown>("client_content_profiles").update({ ...fields, updated_by: user.id })
          .eq("id", profile.id).eq("organization_id", organizationId)
        : contentDb.from<unknown>("client_content_profiles").insert({
          organization_id: organizationId,
          client_id: clientId,
          ...fields,
          created_by: user.id,
          updated_by: user.id,
        });
      const { error } = await query;
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateBase();
      toast.success("Dossiê do cliente salvo.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveRecord = useMutation({
    mutationFn: async (state: EditorState) => {
      if (!organizationId || !clientId || !user) throw new Error("Selecione um cliente.");
      const identity = { organization_id: organizationId, created_by: user.id, updated_by: user.id };
      let relation = "";
      let id: string | undefined;
      let values: Record<string, unknown>;

      if (state.kind === "knowledge") {
        relation = "client_knowledge_items";
        id = state.draft.id;
        values = {
          ...identity,
          client_id: clientId,
          item_type: state.draft.item_type,
          title: state.draft.title.trim(),
          content: state.draft.content.trim(),
          source_url: optional(state.draft.source_url),
          tags: linesToArray(state.draft.tags),
          effective_from: state.draft.effective_from || null,
          effective_until: state.draft.effective_until || null,
        };
      } else if (state.kind === "claim") {
        relation = "client_content_claims";
        id = state.draft.id;
        values = {
          ...identity,
          client_id: clientId,
          claim_text: state.draft.claim_text.trim(),
          status: state.draft.status,
          source_title: optional(state.draft.source_title),
          source_url: optional(state.draft.source_url),
          usage_notes: optional(state.draft.usage_notes),
          effective_from: state.draft.effective_from || null,
          effective_until: state.draft.effective_until || null,
          approved_by: state.draft.status === "approved" ? user.id : null,
          reviewed_at: state.draft.status === "approved" ? new Date().toISOString() : null,
        };
      } else {
        relation = "client_compliance_rules";
        id = state.draft.id;
        values = {
          ...identity,
          client_id: state.draft.scope === "client" ? clientId : null,
          segment: optional(state.draft.segment),
          title: state.draft.title.trim(),
          rule_text: state.draft.rule_text.trim(),
          severity: state.draft.severity,
          channels: linesToArray(state.draft.channels),
          source_title: optional(state.draft.source_title),
          source_url: optional(state.draft.source_url),
          version: state.draft.version,
          effective_from: state.draft.effective_from || null,
          effective_until: state.draft.effective_until || null,
          exceptions: optional(state.draft.exceptions),
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        };
      }

      let query;
      if (id) {
        const { organization_id: _organizationId, client_id: _clientId, created_by: _createdBy, ...updateValues } = values;
        query = contentDb.from<unknown>(relation).update({ ...updateValues, updated_by: user.id })
          .eq("id", id).eq("organization_id", organizationId);
      } else {
        query = contentDb.from<unknown>(relation).insert(values);
      }
      const { error } = await query;
      if (error) throw error;
    },
    onSuccess: () => {
      setEditor(null);
      invalidateBase();
      toast.success("Registro salvo.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteRecord = useMutation({
    mutationFn: async (target: DeleteTarget) => {
      const { error } = await contentDb.from<unknown>(target.relation).delete()
        .eq("id", target.id).eq("organization_id", organizationId!);
      if (error) throw error;
    },
    onSuccess: () => {
      setDeleteTarget(null);
      invalidateBase();
      toast.success("Registro excluído.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const openKnowledge = (item?: KnowledgeItem) => setEditor({
    kind: "knowledge",
    draft: item ? {
      id: item.id, item_type: item.item_type, title: item.title, content: item.content,
      source_url: item.source_url ?? "", tags: arrayToLines(item.tags),
      effective_from: item.effective_from ?? "", effective_until: item.effective_until ?? "",
    } : {
      item_type: "briefing", title: "", content: "", source_url: "", tags: "",
      effective_from: "", effective_until: "",
    },
  });

  const openClaim = (item?: ContentClaim) => setEditor({
    kind: "claim",
    draft: item ? {
      id: item.id, claim_text: item.claim_text, status: item.status,
      source_title: item.source_title ?? "", source_url: item.source_url ?? "",
      usage_notes: item.usage_notes ?? "", effective_from: item.effective_from ?? "",
      effective_until: item.effective_until ?? "",
    } : {
      claim_text: "", status: "review_required", source_title: "", source_url: "",
      usage_notes: "", effective_from: "", effective_until: "",
    },
  });

  const openRule = (item?: ComplianceRule) => setEditor({
    kind: "rule",
    draft: item ? {
      id: item.id, scope: item.client_id ? "client" : "organization", segment: item.segment ?? "",
      title: item.title, rule_text: item.rule_text, severity: item.severity,
      channels: arrayToLines(item.channels), source_title: item.source_title ?? "",
      source_url: item.source_url ?? "", version: item.version,
      effective_from: item.effective_from ?? "", effective_until: item.effective_until ?? "",
      exceptions: item.exceptions ?? "",
    } : {
      scope: "client", segment: profile.segment, title: "", rule_text: "", severity: "warning",
      channels: "Instagram\nFacebook", source_title: "", source_url: "", version: 1,
      effective_from: "", effective_until: "", exceptions: "",
    },
  });

  if (clientsQuery.isError) {
    return (
      <div className="nrt-surface -mx-4 -mt-4 min-h-screen px-4 py-6 sm:-mx-6 sm:-mt-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-[1180px]">
          <PageHeader title="Base de Conteúdo" subtitle="Conhecimento editorial por cliente." />
          <EmptyState icon={AlertTriangle} title="Não foi possível carregar os clientes" description="Tente novamente em instantes." action={<Button onClick={() => clientsQuery.refetch()}>Tentar novamente</Button>} className="mt-6" />
        </div>
      </div>
    );
  }

  return (
    <div className="nrt-surface -mx-4 -mt-4 min-h-screen px-4 pb-16 pt-6 sm:-mx-6 sm:-mt-6 sm:px-6 sm:pt-8">
      <div className="mx-auto max-w-[1180px] space-y-6">
        <PageHeader
          title="Base de Conteúdo"
          subtitle="Centralize o contexto que orientará as futuras criações com IA."
          breadcrumb={[{ label: "Conteúdo" }, { label: "Base por cliente" }]}
        />

        <Card className="border-brand/20 bg-brand-soft/30">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-brand-soft p-2.5 text-brand"><Sparkles className="h-5 w-5" /></div>
              <div>
                <p className="font-semibold">Primeira etapa: dossiê confiável</p>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                  Cadastre apenas informações aprovadas. A geração de roteiros e copies será conectada a esta base em uma etapa posterior.
                </p>
              </div>
            </div>
            <div className="w-full sm:w-72">
              <Label className="mb-1.5 block text-xs">Cliente</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger><SelectValue placeholder="Selecione um cliente" /></SelectTrigger>
                <SelectContent>
                  {(clientsQuery.data ?? []).map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {!clientsQuery.isLoading && (clientsQuery.data?.length ?? 0) === 0 ? (
          <EmptyState icon={UsersRound} title="Nenhum cliente cadastrado" description="Cadastre um cliente antes de montar a base de conteúdo." />
        ) : !clientId ? (
          <Skeleton className="h-96 rounded-2xl" />
        ) : baseQuery.isError ? (
          <EmptyState
            icon={Library}
            title="A base de conteúdo ainda não está disponível"
            description="A migration desta etapa precisa ser revisada e aplicada pelo diretor antes de usar a tela. Nenhuma alteração foi aplicada automaticamente."
            action={<Button variant="outline" onClick={() => baseQuery.refetch()}>Tentar novamente</Button>}
          />
        ) : baseQuery.isLoading ? (
          <Skeleton className="h-[620px] rounded-2xl" />
        ) : (
          <Tabs defaultValue="identity" className="space-y-5">
            <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-xl bg-muted/70 p-1">
              <TabsTrigger value="identity">Identidade</TabsTrigger>
              <TabsTrigger value="audience">Público</TabsTrigger>
              <TabsTrigger value="voice">Voz</TabsTrigger>
              <TabsTrigger value="knowledge">Conhecimento ({baseQuery.data?.items.length ?? 0})</TabsTrigger>
              <TabsTrigger value="claims">Claims ({baseQuery.data?.claims.length ?? 0})</TabsTrigger>
              <TabsTrigger value="rules">Regras ({baseQuery.data?.rules.length ?? 0})</TabsTrigger>
              <TabsTrigger value="design_refs">Referências</TabsTrigger>
            </TabsList>

            <TabsContent value="identity">
              <ProfilePanel title={`Identidade · ${selectedClient?.name ?? "Cliente"}`} description="O que a marca é, oferece e defende." onSave={() => saveProfile.mutate()} saving={saveProfile.isPending} canEdit={canEdit}>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="brand-summary">Resumo da marca</Label>
                  <Textarea id="brand-summary" rows={5} value={profile.brand_summary} onChange={(e) => setProfile({ ...profile, brand_summary: e.target.value })} placeholder="História, contexto atual e essência da marca." />
                </div>
                <Field id="segment" label="Segmento" value={profile.segment} onChange={(value) => setProfile({ ...profile, segment: value })} placeholder="Ex.: Medicina, varejo, educação" />
                <Field id="location" label="Localização e atuação" value={profile.location_scope} onChange={(value) => setProfile({ ...profile, location_scope: value })} placeholder="Ex.: Florianópolis e atendimento nacional" />
                <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="positioning">Posicionamento</Label><Textarea id="positioning" rows={3} value={profile.positioning} onChange={(e) => setProfile({ ...profile, positioning: e.target.value })} /></div>
                <ListField id="specialties" label="Especialidades" value={profile.specialties} onChange={(value) => setProfile({ ...profile, specialties: value })} />
                <ListField id="products" label="Produtos e serviços" value={profile.products_services} onChange={(value) => setProfile({ ...profile, products_services: value })} />
                <ListField id="differentiators" label="Diferenciais confirmados" value={profile.differentiators} onChange={(value) => setProfile({ ...profile, differentiators: value })} />
                <ListField id="disclosures" label="Informações obrigatórias" value={profile.mandatory_disclosures} onChange={(value) => setProfile({ ...profile, mandatory_disclosures: value })} hint="Ex.: CRM/RQE, aviso legal ou identificação que deve acompanhar o conteúdo." />
              </ProfilePanel>
            </TabsContent>

            <TabsContent value="audience">
              <ProfilePanel title="Público e contexto" description="Para quem a marca fala e quais limites devem ser respeitados." onSave={() => saveProfile.mutate()} saving={saveProfile.isPending} canEdit={canEdit}>
                <ListField id="personas" label="Personas" value={profile.personas} onChange={(value) => setProfile({ ...profile, personas: value })} />
                <ListField id="pains" label="Dores" value={profile.audience_pains} onChange={(value) => setProfile({ ...profile, audience_pains: value })} />
                <ListField id="desires" label="Desejos" value={profile.audience_desires} onChange={(value) => setProfile({ ...profile, audience_desires: value })} />
                <ListField id="objections" label="Objeções" value={profile.audience_objections} onChange={(value) => setProfile({ ...profile, audience_objections: value })} />
                <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="audience-language">Linguagem do público</Label><Textarea id="audience-language" rows={3} value={profile.audience_language} onChange={(e) => setProfile({ ...profile, audience_language: e.target.value })} placeholder="Vocabulário, nível de conhecimento e tom que melhor funciona." /></div>
                <div className="sm:col-span-2"><ListField id="sensitive" label="Temas sensíveis" value={profile.sensitive_topics} onChange={(value) => setProfile({ ...profile, sensitive_topics: value })} /></div>
              </ProfilePanel>
            </TabsContent>

            <TabsContent value="voice">
              <ProfilePanel title="Voz da marca" description="Preferências editoriais usadas para manter consistência." onSave={() => saveProfile.mutate()} saving={saveProfile.isPending} canEdit={canEdit}>
                <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="voice">Personalidade e tom</Label><Textarea id="voice" rows={4} value={profile.voice_personality} onChange={(e) => setProfile({ ...profile, voice_personality: e.target.value })} placeholder="Ex.: segura, acolhedora, didática e sem promessas exageradas." /></div>
                <div className="space-y-1.5"><Label>Formalidade</Label><Select value={profile.formality} onValueChange={(value: ContentProfile["formality"]) => setProfile({ ...profile, formality: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="casual">Casual</SelectItem><SelectItem value="balanced">Equilibrada</SelectItem><SelectItem value="formal">Formal</SelectItem></SelectContent></Select></div>
                <div className="space-y-1.5"><Label htmlFor="emoji-limit">Limite sugerido de emojis</Label><Input id="emoji-limit" type="number" min={0} max={20} value={profile.emoji_limit} onChange={(e) => setProfile({ ...profile, emoji_limit: Number(e.target.value) })} /></div>
                <ListField id="preferred-words" label="Palavras preferidas" value={profile.preferred_words} onChange={(value) => setProfile({ ...profile, preferred_words: value })} />
                <ListField id="forbidden-words" label="Palavras proibidas" value={profile.forbidden_words} onChange={(value) => setProfile({ ...profile, forbidden_words: value })} />
                <ListField id="preferred-ctas" label="CTAs permitidos/preferidos" value={profile.preferred_ctas} onChange={(value) => setProfile({ ...profile, preferred_ctas: value })} />
                <ListField id="forbidden-ctas" label="CTAs proibidos" value={profile.forbidden_ctas} onChange={(value) => setProfile({ ...profile, forbidden_ctas: value })} />
              </ProfilePanel>
            </TabsContent>

            <TabsContent value="knowledge">
              <CollectionPanel title="Conhecimento e referências" description="Briefings, FAQs, serviços, regulamentos e exemplos que dão contexto verificável." icon={BookOpenText} canEdit={canEdit} onAdd={() => openKnowledge()}>
                {(baseQuery.data?.items.length ?? 0) === 0 ? <EmptyState icon={BookOpenText} title="Nenhuma referência cadastrada" description="Adicione o briefing e as fontes que devem orientar o conteúdo." variant="inline" /> : (
                  <div className="grid gap-3 md:grid-cols-2">{baseQuery.data?.items.map((item) => <RecordCard key={item.id} title={item.title} description={item.content} badges={[KNOWLEDGE_LABELS[item.item_type], ...item.tags]} sourceUrl={item.source_url} canEdit={canEdit} onEdit={() => openKnowledge(item)} onDelete={() => setDeleteTarget({ relation: "client_knowledge_items", id: item.id, label: item.title })} />)}</div>
                )}
              </CollectionPanel>
            </TabsContent>

            <TabsContent value="claims">
              <CollectionPanel title="Fatos e claims" description="Registre o que pode ser afirmado, o que é proibido e o que exige revisão humana." icon={CheckCircle2} canEdit={canEdit} onAdd={() => openClaim()}>
                {(baseQuery.data?.claims.length ?? 0) === 0 ? <EmptyState icon={CheckCircle2} title="Nenhum claim classificado" description="Classifique afirmações importantes antes de gerar conteúdo." variant="inline" /> : (
                  <div className="grid gap-3 md:grid-cols-2">{baseQuery.data?.claims.map((item) => <RecordCard key={item.id} title={CLAIM_LABELS[item.status]} description={item.claim_text} badges={[CLAIM_LABELS[item.status], item.source_title ?? "Sem fonte informada"]} sourceUrl={item.source_url} canEdit={canEdit} onEdit={() => openClaim(item)} onDelete={() => setDeleteTarget({ relation: "client_content_claims", id: item.id, label: item.claim_text })} />)}</div>
                )}
              </CollectionPanel>
            </TabsContent>

            <TabsContent value="rules">
              <CollectionPanel title="Regras e conformidade" description="Regras versionadas com gravidade, vigência e fonte oficial. Regras gerais também aparecem para o cliente." icon={ShieldCheck} canEdit={canEdit} onAdd={() => openRule()}>
                {(baseQuery.data?.rules.length ?? 0) === 0 ? <EmptyState icon={ShieldCheck} title="Nenhuma regra cadastrada" description="Cadastre restrições legais e editoriais com a fonte que as sustenta." variant="inline" /> : (
                  <div className="grid gap-3 md:grid-cols-2">{baseQuery.data?.rules.map((item) => <RecordCard key={item.id} title={item.title} description={item.rule_text} badges={[SEVERITY_LABELS[item.severity], `v${item.version}`, item.client_id ? "Deste cliente" : "Regra geral", ...(item.channels ?? [])]} sourceUrl={item.source_url} canEdit={canEdit && (Boolean(item.client_id) || canManageCompliance)} onEdit={() => openRule(item)} onDelete={() => setDeleteTarget({ relation: "client_compliance_rules", id: item.id, label: item.title })} />)}</div>
                )}
              </CollectionPanel>
            </TabsContent>
            <TabsContent value="design_refs">
              <DesignReferencesTab organizationId={organizationId!} clientId={clientId} />
            </TabsContent>
          </Tabs>
        )}
      </div>

      <RecordEditor state={editor} onChange={setEditor} onClose={() => setEditor(null)} onSave={() => editor && saveRecord.mutate(editor)} saving={saveRecord.isPending} canCreateGlobalRule={canManageCompliance} />

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Excluir este registro?</AlertDialogTitle><AlertDialogDescription>“{deleteTarget?.label}” será removido da base. Esta ação não pode ser desfeita.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={deleteRecord.isPending}>Cancelar</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={deleteRecord.isPending || !deleteTarget} onClick={(event) => { event.preventDefault(); if (deleteTarget) deleteRecord.mutate(deleteTarget); }}>{deleteRecord.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Excluir</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Field({ id, label, value, onChange, placeholder }: { id: string; label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><Input id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></div>;
}

function ProfilePanel({ title, description, children, onSave, saving, canEdit }: { title: string; description: string; children: React.ReactNode; onSave: () => void; saving: boolean; canEdit: boolean }) {
  return <Card className="border-border/70 bg-card/80"><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>{title}</CardTitle><CardDescription className="mt-1">{description}</CardDescription></div>{canEdit && <Button onClick={onSave} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Salvar</Button>}</div></CardHeader><CardContent className="grid gap-5 sm:grid-cols-2"><fieldset disabled={!canEdit} className="contents">{children}</fieldset></CardContent></Card>;
}

function CollectionPanel({ title, description, icon: Icon, children, canEdit, onAdd }: { title: string; description: string; icon: typeof FileText; children: React.ReactNode; canEdit: boolean; onAdd: () => void }) {
  return <Card className="border-border/70 bg-card/80"><CardHeader><div className="flex items-start justify-between gap-3"><div className="flex gap-3"><div className="rounded-xl bg-brand-soft p-2 text-brand"><Icon className="h-5 w-5" /></div><div><CardTitle>{title}</CardTitle><CardDescription className="mt-1">{description}</CardDescription></div></div>{canEdit && <Button onClick={onAdd}><Plus className="mr-2 h-4 w-4" />Adicionar</Button>}</div></CardHeader><CardContent>{children}</CardContent></Card>;
}

function RecordEditor({ state, onChange, onClose, onSave, saving, canCreateGlobalRule }: { state: EditorState | null; onChange: (state: EditorState | null) => void; onClose: () => void; onSave: () => void; saving: boolean; canCreateGlobalRule: boolean }) {
  const submit = (event: FormEvent) => { event.preventDefault(); onSave(); };
  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{state?.draft.id ? "Editar registro" : "Adicionar registro"}</DialogTitle><DialogDescription>Inclua somente informações verificadas e evite dados pessoais ou sigilosos.</DialogDescription></DialogHeader>
        {state?.kind === "knowledge" && <form onSubmit={submit} className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><Label>Tipo</Label><Select value={state.draft.item_type} onValueChange={(value: KnowledgeType) => onChange({ ...state, draft: { ...state.draft, item_type: value } })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(KNOWLEDGE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div><Field id="knowledge-title" label="Título" value={state.draft.title} onChange={(title) => onChange({ ...state, draft: { ...state.draft, title } })} /></div><div className="space-y-1.5"><Label htmlFor="knowledge-content">Conteúdo</Label><Textarea id="knowledge-content" rows={8} required value={state.draft.content} onChange={(e) => onChange({ ...state, draft: { ...state.draft, content: e.target.value } })} /></div><Field id="knowledge-source" label="Link da fonte" value={state.draft.source_url} onChange={(source_url) => onChange({ ...state, draft: { ...state.draft, source_url } })} placeholder="https://" /><div className="space-y-1.5"><Label htmlFor="knowledge-tags">Tags</Label><Textarea id="knowledge-tags" rows={3} value={state.draft.tags} onChange={(e) => onChange({ ...state, draft: { ...state.draft, tags: e.target.value } })} placeholder="Uma tag por linha" /></div><DateFields from={state.draft.effective_from} until={state.draft.effective_until} onFrom={(effective_from) => onChange({ ...state, draft: { ...state.draft, effective_from } })} onUntil={(effective_until) => onChange({ ...state, draft: { ...state.draft, effective_until } })} /><EditorFooter saving={saving} /></form>}
        {state?.kind === "claim" && <form onSubmit={submit} className="space-y-4"><div className="space-y-1.5"><Label htmlFor="claim-text">Afirmação</Label><Textarea id="claim-text" rows={5} required value={state.draft.claim_text} onChange={(e) => onChange({ ...state, draft: { ...state.draft, claim_text: e.target.value } })} /></div><div className="space-y-1.5"><Label>Status</Label><Select value={state.draft.status} onValueChange={(status: ClaimStatus) => onChange({ ...state, draft: { ...state.draft, status } })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(CLAIM_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-4 sm:grid-cols-2"><Field id="claim-source-title" label="Nome da fonte" value={state.draft.source_title} onChange={(source_title) => onChange({ ...state, draft: { ...state.draft, source_title } })} /><Field id="claim-source-url" label="Link da fonte" value={state.draft.source_url} onChange={(source_url) => onChange({ ...state, draft: { ...state.draft, source_url } })} placeholder="https://" /></div><div className="space-y-1.5"><Label htmlFor="claim-notes">Orientação de uso</Label><Textarea id="claim-notes" rows={4} value={state.draft.usage_notes} onChange={(e) => onChange({ ...state, draft: { ...state.draft, usage_notes: e.target.value } })} /></div><DateFields from={state.draft.effective_from} until={state.draft.effective_until} onFrom={(effective_from) => onChange({ ...state, draft: { ...state.draft, effective_from } })} onUntil={(effective_until) => onChange({ ...state, draft: { ...state.draft, effective_until } })} /><EditorFooter saving={saving} /></form>}
        {state?.kind === "rule" && <form onSubmit={submit} className="space-y-4"><div className="grid gap-4 sm:grid-cols-3"><div className="space-y-1.5"><Label>Escopo</Label><Select value={state.draft.scope} disabled={Boolean(state.draft.id)} onValueChange={(scope: "client" | "organization") => onChange({ ...state, draft: { ...state.draft, scope } })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="client">Cliente atual</SelectItem>{canCreateGlobalRule && <SelectItem value="organization">Regra geral</SelectItem>}</SelectContent></Select></div><div className="space-y-1.5"><Label>Gravidade</Label><Select value={state.draft.severity} onValueChange={(severity: RuleSeverity) => onChange({ ...state, draft: { ...state.draft, severity } })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(SEVERITY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1.5"><Label htmlFor="rule-version">Versão</Label><Input id="rule-version" type="number" min={1} value={state.draft.version} onChange={(e) => onChange({ ...state, draft: { ...state.draft, version: Number(e.target.value) } })} /></div></div><div className="grid gap-4 sm:grid-cols-2"><Field id="rule-title" label="Título" value={state.draft.title} onChange={(title) => onChange({ ...state, draft: { ...state.draft, title } })} /><Field id="rule-segment" label="Segmento" value={state.draft.segment} onChange={(segment) => onChange({ ...state, draft: { ...state.draft, segment } })} /></div><div className="space-y-1.5"><Label htmlFor="rule-text">Regra</Label><Textarea id="rule-text" rows={6} required value={state.draft.rule_text} onChange={(e) => onChange({ ...state, draft: { ...state.draft, rule_text: e.target.value } })} /></div><div className="space-y-1.5"><Label htmlFor="rule-channels">Canais</Label><Textarea id="rule-channels" rows={3} value={state.draft.channels} onChange={(e) => onChange({ ...state, draft: { ...state.draft, channels: e.target.value } })} placeholder="Um canal por linha" /></div><div className="grid gap-4 sm:grid-cols-2"><Field id="rule-source-title" label="Nome da fonte" value={state.draft.source_title} onChange={(source_title) => onChange({ ...state, draft: { ...state.draft, source_title } })} /><Field id="rule-source-url" label="Link da fonte oficial" value={state.draft.source_url} onChange={(source_url) => onChange({ ...state, draft: { ...state.draft, source_url } })} placeholder="https://" /></div><div className="space-y-1.5"><Label htmlFor="rule-exceptions">Exceções e observações</Label><Textarea id="rule-exceptions" rows={3} value={state.draft.exceptions} onChange={(e) => onChange({ ...state, draft: { ...state.draft, exceptions: e.target.value } })} /></div><DateFields from={state.draft.effective_from} until={state.draft.effective_until} onFrom={(effective_from) => onChange({ ...state, draft: { ...state.draft, effective_from } })} onUntil={(effective_until) => onChange({ ...state, draft: { ...state.draft, effective_until } })} /><EditorFooter saving={saving} /></form>}
      </DialogContent>
    </Dialog>
  );
}

function DateFields({ from, until, onFrom, onUntil }: { from: string; until: string; onFrom: (value: string) => void; onUntil: (value: string) => void }) {
  return <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="effective-from">Válido a partir de</Label><Input id="effective-from" type="date" value={from} onChange={(e) => onFrom(e.target.value)} /></div><div className="space-y-1.5"><Label htmlFor="effective-until">Válido até</Label><Input id="effective-until" type="date" value={until} onChange={(e) => onUntil(e.target.value)} /></div></div>;
}

function EditorFooter({ saving }: { saving: boolean }) {
  return <DialogFooter><Button type="submit" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar registro</Button></DialogFooter>;
}
