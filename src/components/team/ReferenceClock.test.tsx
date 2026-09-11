import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReferenceClock } from "./ReferenceClock";

describe("ReferenceClock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T15:04:05-03:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exibe o horário de Brasília com segundos e o mantém atualizado", () => {
    render(<ReferenceClock />);

    expect(screen.getByText("15:04:05")).toBeInTheDocument();
    expect(screen.getByText(/sexta-feira, 11 de setembro/i)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(screen.getByText("15:04:06")).toBeInTheDocument();
  });
});
