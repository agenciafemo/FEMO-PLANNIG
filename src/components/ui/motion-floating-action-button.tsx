import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useAnimationFrame,
  useMotionValue,
  useReducedMotion,
  type AnimationPlaybackControls,
} from "motion/react";
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

// ── Física da bússola ───────────────────────────────────────────────────────
// A agulha de uma bússola é um pêndulo de torção amortecido. O que define o
// "jeito" do movimento é o fator de amortecimento ζ = c / (2·√(I·k)):
//   ζ ≈ 0,1  → bússola SECA: balança por muitos segundos, ruim de ler.
//   ζ ≈ 0,7  → bússola COM LÍQUIDO: passa do norte uma ou duas vezes e assenta
//              em ~1s. É por isso que bússolas têm líquido dentro, e é este o
//              movimento que se reconhece como "de bússola".
//   ζ ≥ 1    → superamortecida: rasteja até o norte, parece emperrada.
//
// Numa mola de animação com massa 1: ζ = damping / (2·√stiffness).
// 12 / (2·√90) = 0,63 — dentro da faixa da bússola de líquido.
const MOLA_BUSSOLA = { type: "spring" as const, stiffness: 90, damping: 12, mass: 1 };

/** Giro em repouso: uma volta a cada 24s. Devagar o bastante para não distrair. */
const GRAUS_POR_SEGUNDO = 360 / 24;

/** Voltas que o empurrão do mouse dá antes de procurar o norte. */
const VOLTAS_NO_HOVER = 2;
import "./motion-floating-action-button-utils/index.css";

const buttonTransition = { type: "spring" as const, stiffness: 500, damping: 30 };
const itemTransition = { type: "spring" as const, stiffness: 400, damping: 22 };

/** Distância entre um atalho e o seguinte. O botão tem 56px; 60 dá o respiro. */
const PASSO_PX = 60;

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

  // ── Rotação da rosa dos ventos ───────────────────────────────────────────
  const semMovimento = useReducedMotion();
  const rotacao = useMotionValue(0);
  const assentando = useRef(false);
  const molaRef = useRef<AnimationPlaybackControls | null>(null);

  // Giro de repouso. Pausa enquanto a mola do hover está assentando, para as
  // duas animações não disputarem o mesmo valor.
  useAnimationFrame((_, delta) => {
    if (semMovimento || assentando.current) return;
    rotacao.set(rotacao.get() + (delta / 1000) * GRAUS_POR_SEGUNDO);
  });

  // O mouse é o empurrão: gira rápido e a própria mola desacelera até o norte,
  // passando um pouco e voltando — como a agulha achando o polo.
  const empurrarBussola = () => {
    if (semMovimento) return;
    const atual = rotacao.get();
    // Norte mais próximo depois das voltas: múltiplo de 360 acima do atual.
    const alvo = Math.ceil((atual + VOLTAS_NO_HOVER * 360) / 360) * 360;
    molaRef.current?.stop();
    assentando.current = true;
    molaRef.current = animate(rotacao, alvo, {
      ...MOLA_BUSSOLA,
      onComplete: () => {
        // Múltiplo de 360 desenha igual a 0; zerar evita o número crescer sem
        // limite enquanto a tela fica aberta.
        rotacao.set(0);
        assentando.current = false;
      },
    });
  };

  useEffect(() => () => molaRef.current?.stop(), []);

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
                // Coluna: cada atalho sobe um passo fixo. Espaçamento constante
                // é o que garante que nunca se sobreponham, com 3 ou com 8.
                const y = -(index + 1) * PASSO_PX;
                const { Icon } = atalho;
                return (
                  <motion.div
                    key={atalho.to}
                    initial={{ y: 0, opacity: 0, scale: 0.3 }}
                    animate={{ y, opacity: 1, scale: 1 }}
                    exit={{ y: 0, opacity: 0, scale: 0.3 }}
                    transition={{ ...itemTransition, delay: index * staggerInterval }}
                    className="fab-action"
                  >
                    <Link
                      to={atalho.to}
                      aria-label={atalho.label}
                      className="fab-action-botao"
                      onClick={() => setOpen(false)}
                    >
                      <Icon className="h-[18px] w-[18px]" />
                    </Link>
                    {/* A caixa externa ocupa a altura toda e centraliza por
                        flex; a pílula fica dentro. Centralizar por transform
                        aqui não funciona: o motion anima `x` no transform e
                        sobrescreveria. */}
                    <motion.span
                      className="fab-label"
                      initial={{ opacity: 0, x: 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 8 }}
                      transition={{ delay: index * staggerInterval + 0.1, duration: 0.15 }}
                    >
                      <span className="fab-label-texto">{atalho.label}</span>
                    </motion.span>
                  </motion.div>
                );
              })}
          </AnimatePresence>
        </div>

        <motion.button
          type="button"
          className="fab-main"
          transition={buttonTransition}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setOpen((value) => !value)}
          onHoverStart={empurrarBussola}
          onFocus={empurrarBussola}
          aria-label={open ? "Fechar atalhos de navegação" : "Abrir atalhos de navegação"}
          aria-expanded={open}
          data-primary-action
        >
          {open ? (
            <X className="h-6 w-6" />
          ) : (
            // A rosa dos ventos da marca gira; o X, não — ele indica fechar e
            // girando viraria ruído.
            <motion.img
              src="/brand/norteia/logo/NOR.png"
              alt=""
              aria-hidden="true"
              draggable={false}
              className="h-11 w-11 select-none object-contain"
              style={{ rotate: rotacao }}
            />
          )}
        </motion.button>
      </div>
    </div>
  );
}

export default FloatingActionButton;
