export type ProductionMetricRow = {
  id: string;
  client_id: string | null;
  content_type: string;
  post_id: string | null;
  assignee_id: string | null;
  production_item_steps: Array<{
    done: boolean;
    done_at: string | null;
    assignee_id: string | null;
  }>;
};

/** Production is measured separately from Kanban: a linked task is not another piece. */
export function summarizeProduction(rows: ProductionMetricRow[], from: string, until: string, members: Set<string> | null = null) {
  const filtered = rows.filter((row) => !members || (row.assignee_id && members.has(row.assignee_id))
    || row.production_item_steps.some((step) => step.assignee_id && members.has(step.assignee_id)));
  let done = 0, doing = 0, completedInPeriod = 0, unknownCompletionDate = 0;
  for (const row of filtered) {
    const steps = row.production_item_steps;
    if (steps.length && steps.every((step) => step.done)) {
      done++;
      if (steps.some((step) => !step.done_at)) { unknownCompletionDate++; continue; }
      const completedAt = Math.max(...steps.map((step) => Date.parse(step.done_at!)));
      if (!Number.isFinite(completedAt)) { unknownCompletionDate++; continue; }
      if (completedAt >= Date.parse(`${from}T00:00:00-03:00`) && completedAt < Date.parse(`${until}T00:00:00-03:00`)) completedInPeriod++;
    } else if (steps.some((step) => step.done)) doing++;
  }
  return {
    total: filtered.length, open: filtered.length - done, done, doing,
    todo: filtered.length - done - doing, completedInPeriod, unknownCompletionDate,
    unlinked: filtered.filter((row) => row.content_type !== "extra" && !row.post_id).length,
    withoutSteps: filtered.filter((row) => !row.production_item_steps.length).length,
  };
}
