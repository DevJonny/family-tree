/**
 * Identifies this page load (tab session) for autosave, and lets other tabs
 * tell whether it's still open. Each session holds a Web Lock named after its
 * id until the page goes away; the browser releases it when the tab closes
 * or crashes, so "no one holds the lock" means "that session's autosave
 * record is a leftover". Browser plumbing, so it has no unit tests; the
 * decision logic it feeds (`readLeftovers`) does.
 */

const LOCK_PREFIX = "family-tree:session:";

let sessionId: string | null = null;

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** This page load's session id; the first call also takes the lock that marks it as open. */
export function thisSessionId(): string {
  if (sessionId) return sessionId;
  sessionId = newId();
  // Never resolves, so the lock is held until the page is gone.
  void navigator.locks?.request(`${LOCK_PREFIX}${sessionId}`, () => new Promise<never>(() => {})).catch(() => {});
  return sessionId;
}

/**
 * Whether a session is open in some tab. Without Web Locks every other
 * session counts as closed, so a second tab may offer to restore a first
 * tab's work (see ARCHITECTURE.md).
 */
export async function openSessionChecker(): Promise<(id: string) => boolean> {
  const own = thisSessionId();
  let held = new Set<string>();
  try {
    const snapshot = await navigator.locks?.query();
    held = new Set(
      (snapshot?.held ?? [])
        .map((lock) => lock.name ?? "")
        .filter((name) => name.startsWith(LOCK_PREFIX))
        .map((name) => name.slice(LOCK_PREFIX.length)),
    );
  } catch {
    // Locks unavailable: fall back to "only this tab is open".
  }
  return (id) => id === own || held.has(id);
}
