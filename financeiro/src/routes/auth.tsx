import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Entrar — FEMO FINANÇAS" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    navigate({ to: "/dashboard", replace: true });
  }

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const redirectUrl = `${window.location.origin}/dashboard`;
    const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectUrl } });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Conta criada. Faça login.");
  }

  return (
    <main className="min-h-screen grid lg:grid-cols-2">
      <section className="hidden lg:flex flex-col justify-between p-12 bg-[var(--gradient-subtle)] border-r">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-md bg-primary" />
          <span className="font-semibold tracking-tight">FEMO FINANÇAS</span>
        </div>
        <div className="space-y-4 max-w-md">
          <h1 className="text-4xl font-semibold tracking-tight leading-tight">
            Clareza absoluta sobre cada real que entra e sai.
          </h1>
          <p className="text-muted-foreground">
            Painel reservado a Fernanda e Marco. Gestão de clientes, fatiamento de comissões, folha e fluxo de caixa em um único lugar.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} · Sistema Operacional Financeiro</p>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold tracking-tight">Acesso restrito</h2>
            <p className="text-sm text-muted-foreground">Entre com suas credenciais administrativas.</p>
          </div>

          <Tabs defaultValue="signin" className="w-full">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="signin">Entrar</TabsTrigger>
              <TabsTrigger value="signup">Cadastrar</TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              <form onSubmit={signIn} className="space-y-4 pt-4">
                <Field label="E-mail" id="email">
                  <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>
                <Field label="Senha" id="password">
                  <Input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </Field>
                <Button type="submit" disabled={loading} className="w-full">{loading ? "Entrando…" : "Entrar"}</Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={signUp} className="space-y-4 pt-4">
                <p className="text-xs text-muted-foreground">Reservado apenas para Fernanda e Marco no primeiro acesso.</p>
                <Field label="E-mail" id="email2">
                  <Input id="email2" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>
                <Field label="Senha" id="password2">
                  <Input id="password2" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
                </Field>
                <Button type="submit" disabled={loading} variant="outline" className="w-full">{loading ? "Criando…" : "Criar conta"}</Button>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </section>
    </main>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
