import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InitialPasswordGuard } from "./InitialPasswordGuard";

const mock = vi.hoisted(() => ({
  completed: false,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/lib/initialPassword", () => ({
  initialPasswordQueryKey: (userId: string) => ["initial-password", userId],
  hasCompletedInitialPassword: () => Promise.resolve(mock.completed),
}));

function PasswordPage() {
  const location = useLocation();
  return <p>Tela de senha: {(location.state as { next?: string } | null)?.next}</p>;
}

function renderGuard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/dashboard?origem=login#resumo"]}>
        <Routes>
          <Route path="/primeiro-acesso/senha" element={<PasswordPage />} />
          <Route
            path="/dashboard"
            element={
              <InitialPasswordGuard>
                <p>Dashboard liberado</p>
              </InitialPasswordGuard>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("InitialPasswordGuard", () => {
  beforeEach(() => {
    mock.completed = false;
  });

  it("leva o primeiro acesso à criação de senha e preserva o destino", async () => {
    renderGuard();

    expect(await screen.findByText("Tela de senha: /dashboard?origem=login#resumo")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard liberado")).not.toBeInTheDocument();
  });

  it("libera o app depois que a senha inicial foi definida", async () => {
    mock.completed = true;
    renderGuard();

    expect(await screen.findByText("Dashboard liberado")).toBeInTheDocument();
  });
});
