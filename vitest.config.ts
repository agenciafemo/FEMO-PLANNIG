import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Qualquer teste que importe um módulo tocado pelo client do Supabase
    // carrega `integrations/supabase/client.ts`, e o createClient recusa uma
    // URL vazia — o arquivo inteiro morre na coleta, antes de rodar um teste
    // sequer. Valores falsos aqui não fazem chamada nenhuma: nenhum teste do
    // projeto vai à rede, eles só precisam que o módulo carregue.
    env: {
      VITE_SUPABASE_URL: "https://exemplo.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "chave-de-teste",
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
