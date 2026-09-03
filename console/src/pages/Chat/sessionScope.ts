import { createContext, useContext } from "react";
import sessionApi from "./sessionApi";

/**
 * Per-session isolation boundary used by the experimental multi-instance chat
 * surface (`ChatMultiInstance`). When a `<ChatScopeProvider>` is present, a
 * mounted `<ChatPage>` reads its OWN session state (its own SessionApi,
 * currentSessionId, agent binding) instead of the page-global singletons.
 *
 * When NO provider is present — i.e. the legacy single-chat route at
 * `/chat/*` — every hook falls back to the existing module-level singletons
 * (`sessionApi`, `window.currentSessionId`, `agentStore.selectedAgent`), so
 * existing behavior is completely unchanged.
 */
export interface ChatScope {
  /** Per-session SessionApi instance. Default: the module singleton. */
  sessionApi?: typeof sessionApi;
  /** Per-session resolved session id. Default: `window.currentSessionId`. */
  currentSessionId?: string | null;
  /** Per-session agent binding. Default: the global `agentStore.selectedAgent`. */
  agentId?: string;
}

const ChatScopeContext = createContext<ChatScope | null>(null);

export const ChatScopeProvider = ChatScopeContext.Provider;

export function useChatScope(): ChatScope {
  return useContext(ChatScopeContext) ?? EMPTY_SCOPE;
}

const EMPTY_SCOPE: ChatScope = {};

/** The `sessionApi` to use in the current session (scoped or module-level). */
export function useChatSessionApi(): typeof sessionApi {
  return useChatScope().sessionApi ?? sessionApi;
}

/** The resolved current session id for the current session (scoped or global). */
export function useChatCurrentSessionId(): string | null {
  const scoped = useChatScope().currentSessionId;
  if (scoped !== undefined) return scoped ?? null;
  // The global is set by SessionApi and typed in ChatPage's import graph; a
  // runtime-safe cast keeps this shared module self-contained.
  return (window as unknown as { currentSessionId?: string }).currentSessionId ?? null;
}

/** The agent binding for the current session (scoped or global). */
export function useChatAgentId(): string | undefined {
  return useChatScope().agentId;
}