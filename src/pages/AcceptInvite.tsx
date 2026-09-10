import { useEffect, useRef, useState } from "react";
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
  const [retry, setRetry] = useState(0);
  const [canRetry, setCanRetry] = useState(false);
  const acceptingRef = useRef(false);
  const userId = user?.id;

  useEffect(() => {
    if (!authLoading && !user && token) {
      navigate(`/auth?invite_token=${encodeURIComponent(token)}`, { replace: true });
    }
  }, [authLoading, user, token, navigate]);

  useEffect(() => {
    let active = true;
    setInvitation(null);
    setError(null);
    setCanRetry(false);
    setLoading(true);

    if (!token) {
      setError("Convite não encontrado ou inválido.");
      setLoading(false);
      return;
    }
    if (authLoading || !userId) return;

    const loadInvitation = async () => {
      try {
        const { data, error: requestError } = await supabase.rpc("get_invitation_by_token", { _token: token });
        if (!active) return;
        if (requestError) throw requestError;
        if (!data?.length) {
          setError("Convite não encontrado ou inválido.");
        } else {
          setInvitation(data[0]);
        }
      } catch {
        if (!active) return;
        setError("Não foi possível carregar o convite. Tente novamente.");
        setCanRetry(true);
      } finally {
        if (active) setLoading(false);
      }
    };
    void loadInvitation();
    // Ignore responses belonging to a previous token, session or retry.
    return () => { active = false; };
  }, [token, userId, authLoading, retry]);

  const expired = invitation ? !(Date.parse(invitation.expires_at) > Date.now()) : false;
  const emailMatches = !!user?.email && !!invitation?.email
    && user.email.trim().toLowerCase() === invitation.email.trim().toLowerCase();

  const handleAccept = async () => {
    if (!token || !userId || authLoading || acceptingRef.current || !emailMatches
      || invitation?.status !== "pending" || expired) return;
    acceptingRef.current = true;
    setAccepting(true);
    try {
      const { error } = await supabase.rpc("accept_organization_invitation", { _token: token });
      if (error) throw error;
      await refresh();
      toast.success("Convite aceito!");
      navigate("/dashboard", { replace: true });
    } catch (e: any) {
      toast.error(e.message ?? "Não foi possível aceitar o convite");
    } finally {
      acceptingRef.current = false;
      setAccepting(false);
    }
  };

  if (authLoading || loading || (token && !userId)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div role="status" aria-label="Carregando convite" className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
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
            <div className="space-y-3">
              <p role="alert" className="text-center text-sm text-destructive">{error}</p>
              {canRetry && <Button variant="outline" className="w-full" onClick={() => setRetry((value) => value + 1)}>Tentar novamente</Button>}
            </div>
          ) : invitation?.status !== "pending" ? (
            <p className="text-center text-sm text-muted-foreground">Este convite já foi utilizado ou não está mais disponível.</p>
          ) : expired ? (
            <p role="alert" className="text-center text-sm text-destructive">Este convite expirou. Peça um novo link ao administrador da agência.</p>
          ) : !emailMatches ? (
            <p role="alert" className="text-center text-sm text-destructive">Este convite é para outro e-mail. Saia da conta atual e entre com o e-mail que recebeu o convite; depois abra este link novamente.</p>
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
