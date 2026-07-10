import { useOrganizationContext } from "@/contexts/OrganizationContext";

export function useOrganization() {
  return useOrganizationContext();
}
