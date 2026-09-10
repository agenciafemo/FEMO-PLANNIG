import { memo, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

type TetrisLoadingProps = {
  size?: "sm" | "md" | "lg";
  showLoadingText?: boolean;
  loadingText?: string;
  className?: string;
};

const SIZE = {
  sm: { cell: 6, width: 48, height: 72 },
  md: { cell: 8, width: 64, height: 96 },
  lg: { cell: 10, width: 80, height: 120 },
} as const;

const SETTLED_BLOCKS = [
  [0, 10], [1, 10], [4, 10], [5, 10], [6, 10],
  [0, 11], [1, 11], [2, 11], [3, 11], [4, 11], [5, 11], [6, 11], [7, 11],
] as const;

const FALLING_PIECES = [
  { blocks: [[0, 0], [1, 0], [2, 0], [1, 1]], left: 1, delay: "0s" },
  { blocks: [[0, 0], [0, 1], [1, 1], [2, 1]], left: 4, delay: "-0.85s" },
] as const;

function TetrisLoadingComponent({
  size = "sm",
  showLoadingText = false,
  loadingText = "Carregando...",
  className,
}: TetrisLoadingProps) {
  const config = SIZE[size];

  return (
    <div className={cn("inline-flex flex-col items-center gap-2", className)}>
      <div
        aria-hidden="true"
        className="relative overflow-hidden border-2 border-foreground bg-background p-px text-foreground"
        style={{ width: config.width + 4, height: config.height + 4 }}
      >
        <div
          className="absolute inset-px opacity-25"
          style={{
            backgroundImage: "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
            backgroundSize: `${config.cell}px ${config.cell}px`,
          }}
        />

        {SETTLED_BLOCKS.map(([x, y]) => (
          <span
            key={`${x}-${y}`}
            className="absolute bg-foreground"
            style={{
              left: x * config.cell + 1,
              top: y * config.cell + 1,
              width: config.cell - 1,
              height: config.cell - 1,
            }}
          />
        ))}

        {FALLING_PIECES.map((piece, pieceIndex) => (
          <span
            key={pieceIndex}
            className="nrt-tetris-piece absolute left-0 top-0"
            style={{
              width: config.cell * 3,
              height: config.cell * 2,
              marginLeft: piece.left * config.cell + 1,
              animationDelay: piece.delay,
              "--nrt-tetris-distance": `${config.cell * 8}px`,
            } as CSSProperties}
          >
            {piece.blocks.map(([x, y]) => (
              <span
                key={`${x}-${y}`}
                className="absolute bg-foreground"
                style={{
                  left: x * config.cell,
                  top: y * config.cell,
                  width: config.cell - 1,
                  height: config.cell - 1,
                }}
              />
            ))}
          </span>
        ))}
      </div>
      {showLoadingText && <p className="text-center text-sm font-medium">{loadingText}</p>}
    </div>
  );
}

export const TetrisLoading = memo(TetrisLoadingComponent);
export default TetrisLoading;
