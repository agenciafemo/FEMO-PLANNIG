import { describe, expect, it } from "vitest";
import { isPublicPlanningStatus } from "./publicPlanningVisibility";

describe("isPublicPlanningStatus", () => {
  it.each(["client_review", "approved"])(
    "permite o status público %s",
    (status) => {
      expect(isPublicPlanningStatus(status)).toBe(true);
    },
  );

  it.each(["draft", "internal_review", "", null, undefined])(
    "bloqueia o status interno %s",
    (status) => {
      expect(isPublicPlanningStatus(status)).toBe(false);
    },
  );
});
