import { supabase } from "@/integrations/supabase/client";

export const initialPasswordQueryKey = (userId: string) => ["initial-password", userId] as const;

export async function hasCompletedInitialPassword(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .select("password_changed_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data?.password_changed_at);
}

export async function markInitialPasswordComplete(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from("profiles")
    .update({ password_changed_at: new Date().toISOString() })
    .eq("id", userId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Perfil do usuário não encontrado.");
}

export function safePasswordReturnPath(candidate: unknown): string {
  if (typeof candidate !== "string" || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return "/organizations/select";
  }
  if (candidate.startsWith("/primeiro-acesso/senha")) return "/organizations/select";
  return candidate;
}
