import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Link, useLocation } from "react-router-dom";
import {
  CalendarClock,
  Compass,
  LayoutGrid,
  ListTodo,
  Users,
  Workflow,
  X,
} from "lucide-react";
import "./motion-floating-action-button-utils/index.css";

const buttonTransition = { type: "spring" as const, stiffness: 500, damping: 30 };
const itemTransition = { type: "spring" as const, stiffness: 400, damping: 22 };

/**
 * Atalhos do botão. A ordem importa: o primeiro sai mais perto do botão, e é
 * por isso que o Dashboard vem primeiro — é o "voltar para o centro", o destino
 * mais pedido quando alguém se perde.
 */
const ATALHOS = [
  { label: "Dashboard", to: "/dashboard", Icon: Compass },
  { label: "Planejamentos", to: "/plannings", Icon: LayoutGrid },
  { label: "Produção", to: "/producao", Icon: Workflow },
  { label: "Tarefas", to: "/tasks", Icon: ListTodo },
  { label: "Clientes", to: "/clients", Icon: Users },
  { label: "Programação", to: "/programacao", Icon: CalendarClock },
] as const;

/**
 * Botão flutuante de navegação — fica no canto e acompanha todas as telas.
 *
 * Serve para quem se perdeu voltar ao centro do app sem caçar o caminho, na
 * ideia do botão flutuante do iPhone. Some no destino em que você já está: não
 * faz sentido oferecer "Tarefas" para quem está em Tarefas.
 */
export function FloatingActionButton({
  staggerInterval = 0.05,
}: {
  staggerInterval?: number;
} = {}) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const stageRef = useRef<HTMLDivElement>(null);

  // Trocar de página fecha o leque: ele cumpriu o papel.
  useEffect(() => { setOpen(false); }, [pathname]);

  // Esc fecha, e clicar fora tambem — senão o leque fica aberto sobre a tela.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e: PointerEvent) => {
      if (!stageRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const atalhos = ATALHOS.filter((a) => !pathname.startsWith(a.to));

  return (
    <div className="fab-stage" ref={stageRef}>
      <div className="fab-root">
        <div className="fab-actions">
          <AnimatePresence>
            {open &&
              atalhos.map((atalho, index) => {
                const distance = ((index + 1) / atalhos.length) * 88;
                const { Icon } = atalho;
                return (
                  <motion.div
                    key={atalho.to}
                    initial={{ offsetDistance: "0%", opacity: 0, scale: 0.3 }}
                    animate={{ offsetDistance: `${distance}%`, opacity: 1, scale: 1 }}
                    exit={{ offsetDistance: "0%", opacity: 0, scale: 0.3 }}
                    transition={{ ...itemTransition, delay: index * staggerInterval }}
                    className="fab-action"
                  >
                    <Link
                      to={atalho.to}
                      aria-label={atalho.label}
                      className="flex h-full w-full items-center justify-center rounded-full"
                      onClick={() => setOpen(false)}
                    >
                      <Icon className="h-[18px] w-[18px]" />
                      <motion.span
                        className="fab-label"
                        initial={{ opacity: 0, x: 8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * staggerInterval + 0.1, duration: 0.15 }}
                      >
                        {atalho.label}
                      </motion.span>
                    </Link>
                  </motion.div>
                );
              })}
          </AnimatePresence>
        </div>

        <motion.button
          type="button"
          className="fab-main"
          animate={{ rotate: open ? 90 : 0 }}
          transition={buttonTransition}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setOpen((value) => !value)}
          aria-label={open ? "Fechar atalhos de navegação" : "Abrir atalhos de navegação"}
          aria-expanded={open}
          data-primary-action
        >
          {open ? <X className="h-6 w-6" /> : <Compass className="h-6 w-6" />}
        </motion.button>
      </div>
    </div>
  );
}

export default FloatingActionButton;
