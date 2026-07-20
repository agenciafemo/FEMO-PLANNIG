import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Registra os fontSizes customizados (definidos em tailwind.config.ts) no grupo
// `font-size` do tailwind-merge. Sem isso, o merge não reconhece `text-caption`,
// `text-h1` etc. e os descarta quando há uma classe `text-{cor}` junto — foi o
// que fazia o StatusBadge perder o `text-caption` e renderizar em 16px.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["display", "h1", "h2", "h3", "body", "small", "caption", "label"] },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
