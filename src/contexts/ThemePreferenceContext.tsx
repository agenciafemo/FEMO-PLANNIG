import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useTheme } from "next-themes";

import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export type ThemePreference = "light" | "dark" | "system";

interface ThemePreferenceContextType {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => Promise<void>;
}

const ThemePreferenceContext = createContext<ThemePreferenceContextType | null>(null);

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function cacheKey(userId: string) {
  return `norteia:theme:${userId}`;
}

function readCachedPreference(userId: string): ThemePreference | null {
  try {
    const cached = localStorage.getItem(cacheKey(userId));
    return isThemePreference(cached) ? cached : null;
  } catch {
    return null;
  }
}

function writeCachedPreference(userId: string, preference: ThemePreference) {
  try {
    localStorage.setItem(cacheKey(userId), preference);
  } catch {
    // O next-themes ainda mantém o tema em memória se o storage não estiver disponível.
  }
}

export function ThemePreferenceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const activeUserIdRef = useRef<string | undefined>(user?.id);

  useEffect(() => {
    activeUserIdRef.current = user?.id;
  }, [user?.id]);

  useEffect(() => {
    const userId = user?.id;
    if (!userId) return;

    let cancelled = false;
    const cachedPreference = readCachedPreference(userId);

    if (cachedPreference) {
      setTheme(cachedPreference);
    }

    const loadPreference = async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("theme_preference")
        .eq("id", userId)
        .maybeSingle();

      if (cancelled || activeUserIdRef.current !== userId || error) return;

      const databasePreference = data?.theme_preference;
      if (!isThemePreference(databasePreference)) return;

      setTheme(databasePreference);
      writeCachedPreference(userId, databasePreference);
    };

    void loadPreference();

    return () => {
      cancelled = true;
    };
  }, [setTheme, user?.id]);

  const setPreference = useCallback(
    async (preference: ThemePreference) => {
      setTheme(preference);

      const userId = user?.id;
      if (!userId) return;

      writeCachedPreference(userId, preference);

      const { data, error } = await supabase
        .from("profiles")
        .update({ theme_preference: preference })
        .eq("id", userId)
        .select("id")
        .maybeSingle();

      if ((error || !data) && activeUserIdRef.current === userId) {
        toast.warning("Não foi possível salvar o tema na sua conta", {
          description: "A preferência foi mantida neste dispositivo.",
        });
      }
    },
    [setTheme, user?.id],
  );

  const value = useMemo<ThemePreferenceContextType>(
    () => ({
      preference: isThemePreference(theme) ? theme : "system",
      setPreference,
    }),
    [setPreference, theme],
  );

  return <ThemePreferenceContext.Provider value={value}>{children}</ThemePreferenceContext.Provider>;
}

export function useThemePreference() {
  const context = useContext(ThemePreferenceContext);
  if (!context) {
    throw new Error("useThemePreference must be used within ThemePreferenceProvider");
  }
  return context;
}
