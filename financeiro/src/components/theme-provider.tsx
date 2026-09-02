import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Theme = { cor_primaria?: string; cor_secundaria?: string; cor_fundo?: string };

export function ThemeProvider() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) return;
      const { data } = await supabase
        .from("configuracoes")
        .select("*")
        .eq("id", 1)
        .single();
      if (mounted && data) setTheme(data as Theme);
    };
    load();
    const { data: sub } = supabase.auth.onAuthStateChange((e) => {
      if (e === "SIGNED_IN" || e === "USER_UPDATED") load();
    });
    const onCustom = () => load();
    window.addEventListener("os-theme:refresh", onCustom);
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
      window.removeEventListener("os-theme:refresh", onCustom);
    };
  }, []);

  if (!theme) return null;
  const css = `:root{${theme.cor_fundo ? `--background:${theme.cor_fundo};` : ""}${theme.cor_primaria ? `--primary:${theme.cor_primaria};--ring:${theme.cor_primaria};` : ""}${theme.cor_secundaria ? `--secondary:${theme.cor_secundaria};--accent:${theme.cor_secundaria};` : ""}}`;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
