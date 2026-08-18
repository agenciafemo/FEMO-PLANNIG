import { Buffer } from "buffer";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import App from "./App.tsx";
import "./index.css";

// Polyfill do Buffer para o navegador — o @react-pdf/renderer precisa dele
// (sem isso o "Baixar PDF" quebra com "Buffer is not defined").
if (!(globalThis as unknown as { Buffer?: unknown }).Buffer) {
  (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}

createRoot(document.getElementById("root")!).render(<App />);
