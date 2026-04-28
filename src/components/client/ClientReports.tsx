import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, FileText, Sparkles } from "lucide-react";
import { toast } from "sonner";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

interface ClientReportsProps {
  clientId: string;
}

export function ClientReports({ clientId }: ClientReportsProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [summaryText, setSummaryText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState<string | null>(null);

  const { data: reports } = useQuery({
    queryKey: ["client-reports", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("monthly_reports")
        .select("*")
        .eq("client_id", clientId)
        .order("year", { ascending: false })
        .order("month", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const deleteReport = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("monthly_reports").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-reports", clientId] });
      toast.success("Relatório removido");
    },
  });

  const handleUploadPdf = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const path = `${clientId}/${year}-${month}-${Date.now()}.pdf`;
      const { error: uploadError } = await supabase.storage.from("report-pdfs").upload(path, file);
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("report-pdfs").getPublicUrl(path);

      const { error } = await supabase.from("monthly_reports").insert({
        client_id: clientId,
        user_id: user!.id,
        month: parseInt(month),
        year: parseInt(year),
        pdf_url: urlData.publicUrl,
        summary_text: summaryText || null,
      });
      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ["client-reports", clientId] });
      setOpen(false);
      setSummaryText("");
      toast.success("Relatório enviado!");
    } catch (err: any) {
      toast.error(err.message || "Erro no upload");
    } finally {
      setUploading(false);
    }
  };

  const analyzeWithAI = async (reportId: string, pdfUrl: string) => {
    setAnalyzing(reportId);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-report", {
        body: { pdfUrl },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (data?.aiSummary) {
        const { error: updateError } = await supabase
          .from("monthly_reports")
          .update({ ai_summary: data.aiSummary } as any)
          .eq("id", reportId);
        if (updateError) throw updateError;

        queryClient.invalidateQueries({ queryKey: ["client-reports", clientId] });
        toast.success("Análise gerada com sucesso!");
      }
    } catch (err: any) {
      toast.error(err.message || "Erro ao analisar relatório");
    } finally {
      setAnalyzing(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Relatórios Mensais</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm"><Plus className="mr-1 h-3 w-3" /> Adicionar</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo Relatório</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Mês</Label>
                  <Select value={month} onValueChange={setMonth}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MONTHS.map((m, i) => (
                        <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Ano</Label>
                  <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Resumo (opcional)</Label>
                <Textarea value={summaryText} onChange={(e) => setSummaryText(e.target.value)} placeholder="Resumo manual do relatório..." rows={3} />
              </div>
              <div className="space-y-2">
                <Label>PDF do Relatório</Label>
                <Input type="file" accept=".pdf" onChange={handleUploadPdf} disabled={uploading} />
                {uploading && <p className="text-xs text-muted-foreground">Enviando...</p>}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {reports && reports.length > 0 ? (
        <div className="space-y-2">
          {reports.map((r) => (
            <Card key={r.id}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">{MONTHS[r.month - 1]} {r.year}</span>
                  </div>
                  <div className="flex gap-1">
                    {r.pdf_url && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => analyzeWithAI(r.id, r.pdf_url!)}
                        disabled={analyzing === r.id}
                      >
                        <Sparkles className="mr-1 h-3 w-3" />
                        {analyzing === r.id ? "Analisando..." : (r as any).ai_summary ? "Reanalisar" : "Analisar com IA"}
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => deleteReport.mutate(r.id)}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                </div>
                {(r as any).ai_summary && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{(r as any).ai_summary}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Nenhum relatório</p>
      )}
    </div>
  );
}
