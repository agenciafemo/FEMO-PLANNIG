import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrganizationContext } from "@/contexts/OrganizationContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function CreateOrganization() {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useOrganizationContext();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const slug = slugify(name) || `agencia-${Date.now()}`;
      // TODO(multi-org-migration): RPC ainda não existe no schema real;
      // só é alcançável com VITE_MULTI_ORG_ENABLED=true.
      const { error } = await (supabase.rpc as any)("create_organization", { _name: name, _slug: slug });
      if (error) throw error;
      await refresh();
      toast.success("Equipe criada!");
      navigate("/dashboard", { replace: true });
    } catch (error: any) {
      toast.error(error.message ?? "Não foi possível criar a equipe");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Crie sua equipe</CardTitle>
          <CardDescription>Dê um nome para a sua agência para começar a usar o painel</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="org-name">Nome da agência</Label>
              <Input
                id="org-name"
                placeholder="Ex: Minha Agência"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading || !name.trim()}>
              {loading ? "Criando..." : "Criar equipe"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
