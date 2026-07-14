import { Monitor, Moon, Sun } from "lucide-react";

import { isThemePreference, useThemePreference } from "@/contexts/ThemePreferenceContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const themeOptions = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Escuro", icon: Moon },
  { value: "system", label: "Sistema", icon: Monitor },
] as const;

export function ThemeToggle() {
  const { preference, setPreference } = useThemePreference();
  const currentTheme = themeOptions.find((option) => option.value === preference) ?? themeOptions[2];
  const CurrentIcon = currentTheme.icon;

  const handlePreferenceChange = (value: string) => {
    if (isThemePreference(value)) {
      void setPreference(value);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          aria-label={`Tema: ${currentTheme.label}`}
        >
          <CurrentIcon className="h-3.5 w-3.5" />
          <span>Tema</span>
          <span className="ml-auto text-[11px] text-sidebar-foreground/40">{currentTheme.label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-52">
        <DropdownMenuLabel>Escolher tema</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={preference} onValueChange={handlePreferenceChange}>
          {themeOptions.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <option.icon className="mr-2 h-4 w-4" />
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
