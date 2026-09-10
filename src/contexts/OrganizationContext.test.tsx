import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrganizationProvider, useOrganizationContext } from "./OrganizationContext";

const mock = vi.hoisted(() => ({
  user: { id: "a" } as { id: string } | null,
  from: vi.fn(), members: [] as unknown[], active: null as string | null,
  error: false, canSwitch: true, updateError: false, updates: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mock.user, loading: false }) }));
vi.mock("@/lib/featureFlags", () => ({ MULTI_ORG_ENABLED: true }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mock.from } }));
function Probe() {
  const org = useOrganizationContext();
  return <><p data-testid="identity">{org.loading ? "loading" : org.error ? "error" : `${org.organizationId ?? "none"}:${org.role ?? "none"}`}</p>
    <p data-testid="legacy">{String(org.isLegacy)}</p>
    <button onClick={() => void org.switchOrganization("org-b").catch(() => {})}>Switch</button>
  </>;
}
const member = (id: string) => ({ organization_id: id, role: "admin", organizations: { name: id, slug: id, client_limit: null } });
let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks(); mock.user = { id: "a" }; mock.members = [member("org-a")]; mock.active = "org-a";
  mock.error = false; mock.canSwitch = true; mock.updateError = false;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mock.from.mockImplementation((table: string) => {
    let columns = ""; let update: { active_organization_id: string } | null = null;
    const result = () => {
      if (update) {
        if (mock.updateError) return { data: null, error: new Error("write failure") };
        mock.active = update.active_organization_id;
        return { data: { id: mock.user?.id }, error: null };
      }
      if (mock.error) return { data: null, error: new Error("read failure") };
      return { data: table === "profiles" ? { active_organization_id: mock.active } : columns === "id" ? (mock.canSwitch ? { id: "membership" } : null) : mock.members, error: null };
    };
    const builder = {
      select: (value: string) => { columns = value; return builder; },
      eq: () => builder,
      update: (value: { active_organization_id: string }) => { update = value; mock.updates(value); return builder; },
      maybeSingle: async () => result(),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
    };
    return builder;
  });
});
afterEach(() => { cleanup(); client.clear(); });
function show() { return render(<QueryClientProvider client={client}><OrganizationProvider><Probe /></OrganizationProvider></QueryClientProvider>); }
it("preserva o vínculo existente e nunca assume proprietário em falha", async () => {
  mock.error = true; show();
  await waitFor(() => expect(screen.getByTestId("identity")).toHaveTextContent("error"));
  expect(screen.getByTestId("legacy")).toHaveTextContent("false");
});
it("usuário sem vínculo permanece sem agência", async () => {
  mock.members = []; show();
  await waitFor(() => expect(screen.getByTestId("identity")).toHaveTextContent("none:none"));
});
it("duas agências sem escolha válida não selecionam uma aleatoriamente", async () => {
  mock.members = [member("org-a"), member("org-b")]; mock.active = "invalid"; show();
  await waitFor(() => expect(screen.getByTestId("identity")).toHaveTextContent("none:none"));
});
it("falha ao persistir seleção mantém a agência anterior", async () => {
  mock.updateError = true; show();
  await waitFor(() => expect(screen.getByTestId("identity")).toHaveTextContent("org-a:admin"));
  fireEvent.click(screen.getByText("Switch"));
  await waitFor(() => expect(mock.updates).toHaveBeenCalled());
  expect(screen.getByTestId("identity")).toHaveTextContent("org-a:admin");
});
it("vínculo revogado impede salvar seleção", async () => {
  mock.canSwitch = false; show();
  await waitFor(() => expect(screen.getByTestId("identity")).toHaveTextContent("org-a:admin"));
  await act(async () => { fireEvent.click(screen.getByText("Switch")); });
  expect(mock.updates).not.toHaveBeenCalled();
});
it("troca validada remove dados em cache da agência anterior", async () => {
  mock.members = [member("org-a"), member("org-b")];
  client.setQueryData(["client-data", "org-a"], { secret: "old agency" });
  show(); await waitFor(() => expect(screen.getByTestId("identity")).toHaveTextContent("org-a:admin"));
  fireEvent.click(screen.getByText("Switch"));
  await waitFor(() => expect(screen.getByTestId("identity")).toHaveTextContent("org-b:admin"));
  expect(client.getQueryData(["client-data", "org-a"])).toBeUndefined();
});
it("troca de login não reutiliza o vínculo da conta anterior", async () => {
  const view = show();
  await waitFor(() => expect(screen.getByTestId("identity")).toHaveTextContent("org-a:admin"));
  mock.user = { id: "b" }; mock.members = []; mock.active = null;
  view.rerender(<QueryClientProvider client={client}><OrganizationProvider><Probe /></OrganizationProvider></QueryClientProvider>);
  expect(screen.getByTestId("identity")).not.toHaveTextContent("org-a:admin");
  await waitFor(() => expect(screen.getByTestId("identity")).toHaveTextContent("none:none"));
});
