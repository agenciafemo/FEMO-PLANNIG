import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganizationContext } from "@/contexts/OrganizationContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

interface InvitationPreview {
  organization_id: string;
  organization_name: string;
  role: string;
  email: string;
  status: string;
  expires_at: string;
}

export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { refresh } = useOrganizationContext();
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user && token) {
      navigate(`/auth?invite_token=${token}`, { replace: true });
    }
  }, [authLoading, user, token, navigate]);

  useEffect(() => {
    if (!token || !user) return;
    // TODO(multi-org-migration): RPCs ainda não existem no schema real;
    // esta tela só é alcançável com VITE_MULTI_ORG_ENABLED=true.
    (supabase.rpc as any)("get_invitation_by_token", { _token: token })
      .then(({ data, error }: any) => {
        if (error || !data || data.length === 0) {
          setError("Convite não encontrado ou inválido.");
        } else {
          setInvitation(data[0] as InvitationPreview);
        }
        setLoading(false);
      });
  }, [token]);

  const handleAccept = async () => {
    if (!token) return;
    setAccepting(true);
    try {
      const { error } = await (supabase.rpc as any)("accept_organization_invitation", { _token: token });
      if (error) throw error;
      await refresh();
      toast.success("Convite aceito!");
      navigate("/dashboard", { replace: true });
    } catch (e: any) {
      toast.error(e.message ?? "Não foi possível aceitar o convite");
    } finally {
      setAccepting(false);
    }
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
          <CardTitle className="text-2xl">Convite de equipe</CardTitle>
          {invitation && !error && (
            <CardDescription>
              Você foi convidado para entrar em <strong>{invitation.organization_name}</strong> como{" "}
              <span className="capitalize">{invitation.role}</span>.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <p className="text-center text-sm text-destructive">{error}</p>
          ) : invitation?.status !== "pending" ? (
            <p className="text-center text-sm text-muted-foreground">Este convite já foi utilizado ou não está mais disponível.</p>
          ) : (
            <Button className="w-full" onClick={handleAccept} disabled={accepting}>
              {accepting ? "Aceitando..." : "Aceitar convite"}
            </Button>
          )}
          <Button variant="ghost" className="w-full" onClick={() => navigate("/dashboard")}>
            Voltar
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
