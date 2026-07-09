import { useNavigate } from "react-router-dom";
import { useOrganizationContext } from "@/contexts/OrganizationContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Building2, Plus } from "lucide-react";

export default function SelectOrganization() {
  const { memberships, switchOrganization, loading } = useOrganizationContext();
  const navigate = useNavigate();

  const handleSelect = async (organizationId: string) => {
    await switchOrganization(organizationId);
    navigate("/dashboard", { replace: true });
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Escolha uma equipe</CardTitle>
          <CardDescription>Selecione a agência que você quer acessar</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {memberships.map((m) => (
            <button
              key={m.organizationId}
              onClick={() => handleSelect(m.organizationId)}
              className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-accent"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="truncate font-medium">{m.organizationName}</p>
                <p className="text-xs capitalize text-muted-foreground">{m.role}</p>
              </div>
            </button>
          ))}

          <Button variant="outline" className="w-full" onClick={() => navigate("/organizations/new")}>
            <Plus className="mr-2 h-4 w-4" /> Criar nova equipe
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
