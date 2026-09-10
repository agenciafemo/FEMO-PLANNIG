import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrganizationAccessRequests } from "./OrganizationAccessRequests";
const mock = vi.hoisted(() => ({ queue: vi.fn(), review: vi.fn(), discovery: vi.fn() }));
vi.mock("@/lib/organizationAccess", () => ({ organizationReviewQueue: mock.queue, reviewOrganizationRequest: mock.review, setOrganizationDiscovery: mock.discovery }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mock.queue.mockResolvedValue({ accepts_join_requests: false, requests: [{ id: "r1", user_id: "u1", email: "person@example.test", created_at: "2026-09-09T12:00:00Z" }] });
  mock.review.mockResolvedValue(undefined); mock.discovery.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); client.clear(); });
function show(canConfigure = false) { render(<QueryClientProvider client={client}><OrganizationAccessRequests organizationId="org" canConfigure={canConfigure} /></QueryClientProvider>); }
it("líder aprova como colaborador sem poder configurar a busca", async () => {
  show(); fireEvent.click(await screen.findByRole("button", { name: "Aprovar colaborador" }));
  await waitFor(() => expect(mock.review).toHaveBeenCalledWith("r1", true));
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});
it("administrador pode autorizar descoberta da própria agência", async () => {
  show(true); fireEvent.click(await screen.findByRole("checkbox"));
  await waitFor(() => expect(mock.discovery).toHaveBeenCalledWith("org", true));
});
it("recusar não envia uma aprovação", async () => {
  show(); fireEvent.click(await screen.findByRole("button", { name: "Recusar" }));
  await waitFor(() => expect(mock.review).toHaveBeenCalledWith("r1", false));
});
