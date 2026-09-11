import { useEffect, useMemo, useState } from "react";
import { Clock3 } from "lucide-react";

type ReferenceClockProps = {
  timeZone?: string;
};

const DEFAULT_TIME_ZONE = "America/Sao_Paulo";

export function ReferenceClock({ timeZone = DEFAULT_TIME_ZONE }: ReferenceClockProps) {
  const [now, setNow] = useState(() => new Date());

  const formatters = useMemo(
    () => ({
      time: new Intl.DateTimeFormat("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
        timeZone,
      }),
      date: new Intl.DateTimeFormat("pt-BR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        timeZone,
      }),
    }),
    [timeZone],
  );

  useEffect(() => {
    let timeoutId: number;

    const scheduleNextTick = () => {
      setNow(new Date());
      timeoutId = window.setTimeout(scheduleNextTick, 1_000 - (Date.now() % 1_000));
    };

    timeoutId = window.setTimeout(scheduleNextTick, 1_000 - (Date.now() % 1_000));

    return () => window.clearTimeout(timeoutId);
  }, []);

  return (
    <div className="rounded-2xl border border-brand/20 bg-brand/[0.04] px-4 py-5 text-center sm:px-6 sm:py-6">
      <p className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <Clock3 className="h-4 w-4 text-brand" aria-hidden="true" />
        Horário de Brasília
      </p>
      <time
        className="mt-2 block font-mono text-5xl font-semibold leading-none tracking-tight text-foreground tabular-nums sm:text-6xl lg:text-7xl"
        dateTime={now.toISOString()}
        aria-label={`Horário de Brasília: ${formatters.time.format(now)}`}
      >
        {formatters.time.format(now)}
      </time>
      <p className="mt-3 text-sm capitalize text-muted-foreground">
        {formatters.date.format(now)}
      </p>
    </div>
  );
}
