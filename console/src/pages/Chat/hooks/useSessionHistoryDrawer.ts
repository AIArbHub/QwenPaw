import { useCallback, useState } from "react";

/**
 * Controls the visibility of the ChatSessionDrawer (history panel).
 *
 * The drawer state is intentionally kept in a hook rather than a global
 * store so that only the Chat page — which renders the drawer — owns
 * the lifecycle.  External callers (e.g. ChatSessionInitializer) receive
 * the `openHistoryDrawer` callback and trigger it via events.
 */
export function useSessionHistoryDrawer() {
  const [historyOpen, setHistoryOpen] = useState(false);

  const openHistoryDrawer = useCallback(() => {
    setHistoryOpen(true);
  }, []);

  const closeHistoryDrawer = useCallback(() => {
    setHistoryOpen(false);
  }, []);

  return {
    historyOpen,
    openHistoryDrawer,
    closeHistoryDrawer,
  } as const;
}
