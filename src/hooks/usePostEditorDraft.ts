import { useCallback, useMemo } from "react";

const DRAFT_PREFIX = "norteia:posteditor:v1";
const ACTIVE_EDITOR_PREFIX = "norteia:posteditor:active:v1";
const DRAFT_VERSION = 1;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface PostDraftKeyParts {
  organizationId: string | null;
  userId: string | null;
  planningId: string;
  postId: string;
}

export interface StoredPostDraft<T> {
  version: typeof DRAFT_VERSION;
  savedAt: number;
  baseUpdatedAt: string | null;
  data: T;
}

export interface ActivePostEditorKeyParts {
  organizationId: string | null;
  userId: string | null;
  planningId: string;
}

interface StoredActivePostEditor {
  version: typeof DRAFT_VERSION;
  savedAt: number;
  postId: string;
}

export function buildPostDraftKey(parts: PostDraftKeyParts): string {
  const organizationId = parts.organizationId ?? "legacy";
  const userId = parts.userId ?? "anon";

  return [
    DRAFT_PREFIX,
    `org=${organizationId}`,
    `user=${userId}`,
    `planning=${parts.planningId}`,
    `post=${parts.postId}`,
  ].join(":");
}

function buildActivePostEditorKey(parts: ActivePostEditorKeyParts): string {
  const organizationId = parts.organizationId ?? "legacy";
  const userId = parts.userId ?? "anon";

  return [
    ACTIVE_EDITOR_PREFIX,
    `org=${organizationId}`,
    `user=${userId}`,
    `planning=${parts.planningId}`,
  ].join(":");
}

export function setActivePostEditor(
  parts: ActivePostEditorKeyParts,
  postId: string,
): boolean {
  try {
    const stored: StoredActivePostEditor = {
      version: DRAFT_VERSION,
      savedAt: Date.now(),
      postId,
    };

    window.localStorage.setItem(
      buildActivePostEditorKey(parts),
      JSON.stringify(stored),
    );
    return true;
  } catch {
    return false;
  }
}

export function getActivePostEditor(
  parts: ActivePostEditorKeyParts,
  ttlMs: number = DEFAULT_TTL_MS,
): string | null {
  try {
    const key = buildActivePostEditorKey(parts);
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as StoredActivePostEditor;
    const isValid =
      parsed?.version === DRAFT_VERSION &&
      typeof parsed.savedAt === "number" &&
      typeof parsed.postId === "string" &&
      parsed.postId.length > 0;

    if (!isValid || Date.now() - parsed.savedAt > ttlMs) {
      window.localStorage.removeItem(key);
      return null;
    }

    return parsed.postId;
  } catch {
    return null;
  }
}

export function clearActivePostEditor(
  parts: ActivePostEditorKeyParts,
): void {
  try {
    window.localStorage.removeItem(buildActivePostEditorKey(parts));
  } catch {
    // O editor continua funcionando mesmo sem armazenamento local.
  }
}

export function usePostEditorDraft<T>(
  parts: PostDraftKeyParts,
  ttlMs: number = DEFAULT_TTL_MS,
) {
  const { organizationId, userId, planningId, postId } = parts;
  const key = useMemo(
    () =>
      buildPostDraftKey({
        organizationId,
        userId,
        planningId,
        postId,
      }),
    [organizationId, planningId, postId, userId],
  );

  const loadDraft = useCallback((): StoredPostDraft<T> | null => {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;

      const parsed = JSON.parse(raw) as StoredPostDraft<T>;
      const isValid =
        parsed?.version === DRAFT_VERSION &&
        typeof parsed.savedAt === "number" &&
        parsed.data != null;

      if (!isValid || Date.now() - parsed.savedAt > ttlMs) {
        window.localStorage.removeItem(key);
        return null;
      }

      return parsed;
    } catch {
      return null;
    }
  }, [key, ttlMs]);

  const saveDraft = useCallback(
    (data: T, baseUpdatedAt: string | null): boolean => {
      try {
        const stored: StoredPostDraft<T> = {
          version: DRAFT_VERSION,
          savedAt: Date.now(),
          baseUpdatedAt,
          data,
        };

        window.localStorage.setItem(key, JSON.stringify(stored));
        return true;
      } catch {
        return false;
      }
    },
    [key],
  );

  const clearDraft = useCallback(() => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // O editor continua funcionando mesmo sem armazenamento local.
    }
  }, [key]);

  return { key, loadDraft, saveDraft, clearDraft };
}
