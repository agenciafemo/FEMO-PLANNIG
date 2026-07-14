import { useState } from "react";
import { Outlet } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

export function AppLayout() {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  if (isMobile) {
    return (
      <div className="min-h-screen">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/70 bg-background/85 px-3 shadow-xs backdrop-blur-xl supports-[backdrop-filter]:bg-background/75">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Abrir menu"
            onClick={() => setOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <img
            src="/brand/norteia/logo/NORTEIA.png"
            alt="Norteia"
            className="h-6 w-auto object-contain dark:brightness-0 dark:invert"
          />
        </header>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="left" className="w-64 p-0">
            <AppSidebar onNavigate={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
        <main className="min-h-[calc(100vh-3.5rem)] p-4">
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <AppSidebar />
      <main className="ml-64 min-h-screen p-6">
        <Outlet />
      </main>
    </div>
  );
}
