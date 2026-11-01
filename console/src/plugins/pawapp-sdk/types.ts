/**
 * pawapp-sdk/types.ts — Public type definitions for the PawApp SDK.
 *
 * These types define the contract between PawApps and the host AIARB console.
 * They were originally re-exported from an external package; the definitions
 * are now inlined here to keep the SDK self-contained after the rename.
 */

// ---------------------------------------------------------------------------
// Disposable
// ---------------------------------------------------------------------------

/** A handle that can release a resource. */
export interface PawDisposable {
  dispose(): void;
}

// ---------------------------------------------------------------------------
// HTTP request types
// ---------------------------------------------------------------------------

export interface PawRequestOptions {
  query?: Record<string, string | number | boolean | null | undefined>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface PawRequestInit extends PawRequestOptions {
  method?: string;
  body?: unknown;
  rawBody?: BodyInit | null;
}

export interface PawSseOptions extends PawRequestOptions {
  method?: string;
  body?: unknown;
  rawBody?: BodyInit | null;
}

export interface PawSseEvent {
  data: string;
  event?: string;
  id?: string;
  retry?: number;
}

export interface PawApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

export interface PawApiNamespace {
  request<T = unknown>(path: string, opts?: PawRequestInit): Promise<T>;
  get<T = unknown>(
    path: string,
    opts?: PawRequestOptions,
  ): Promise<T>;
  post<T = unknown>(
    path: string,
    body?: unknown,
    opts?: PawRequestOptions,
  ): Promise<T>;
  put<T = unknown>(
    path: string,
    body?: unknown,
    opts?: PawRequestOptions,
  ): Promise<T>;
  patch<T = unknown>(
    path: string,
    body?: unknown,
    opts?: PawRequestOptions,
  ): Promise<T>;
  delete<T = unknown>(
    path: string,
    opts?: PawRequestOptions,
  ): Promise<T>;
  download(path: string, opts?: PawRequestOptions): Promise<Blob>;
  stream(
    path: string,
    body?: unknown,
    opts?: PawRequestOptions,
  ): AsyncGenerator<string>;
  events(
    path: string,
    opts?: PawSseOptions,
  ): AsyncGenerator<PawSseEvent>;
  task(
    path: string,
    params?: Record<string, unknown>,
  ): PawTaskHandle;
}

// ---------------------------------------------------------------------------
// Task types
// ---------------------------------------------------------------------------

export type PawTaskEventHandler<T = unknown> = (data: T) => void;

export interface PawTaskHandle {
  readonly id: string;
  readonly result: Promise<unknown>;
  on(event: string, handler: PawTaskEventHandler): PawTaskHandle;
  once(event: string, handler: PawTaskEventHandler): PawTaskHandle;
  off(event: string, handler?: PawTaskEventHandler): PawTaskHandle;
  abort(reason?: string): void;
}

// ---------------------------------------------------------------------------
// Chat types
// ---------------------------------------------------------------------------

export interface PawChatOptions {
  agentId?: string;
  sessionId?: string | null;
  skill?: string;
}

export interface PawChatSessionScope {
  agentId?: string;
}

export interface PawChatSession {
  id: string;
  sessionId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  pinned: boolean;
}

export interface PawChatHistoryMessage {
  id?: string;
  role: string;
  content: unknown;
  metadata?: Record<string, unknown>;
  created_at?: string;
  sequence_number?: number;
}

export interface PawChatHistory {
  sessionId: string;
  messages: PawChatHistoryMessage[];
}

export interface PawChatStreamEvent {
  type?: string;
  object?: string;
  status?: string;
  data?: unknown;
  text?: string;
  error?: unknown;
  [key: string]: unknown;
}

export interface PawChatSessionsApi {
  list(options?: PawChatSessionScope): Promise<PawChatSession[]>;
  create(
    options?: PawChatSessionScope & { name?: string },
  ): Promise<PawChatSession>;
  rename(
    chatId: string,
    name: string,
    options?: PawChatSessionScope,
  ): Promise<PawChatSession>;
  archive(
    chatId: string,
    options?: PawChatSessionScope,
  ): Promise<PawChatSession>;
  pin(
    chatId: string,
    pinned: boolean,
    options?: PawChatSessionScope,
  ): Promise<PawChatSession>;
  delete(chatId: string, options?: PawChatSessionScope): Promise<void>;
}

// ---------------------------------------------------------------------------
// Storage API
// ---------------------------------------------------------------------------

export interface PawStorageApi {
  get<T = unknown>(key: string, defaultValue?: T): Promise<T>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Host namespace
// ---------------------------------------------------------------------------

export interface PawHostNamespace {
  chat(message: string, options?: PawChatOptions): Promise<string>;
  chatStream(
    message: string,
    options?: PawChatOptions,
  ): AsyncGenerator<PawChatStreamEvent>;
  getChatHistory(options?: PawChatOptions): Promise<PawChatHistory>;
  chatSessions: PawChatSessionsApi;
  storage: PawStorageApi;
  getSelectedAgentId(): string;
  getCurrentSessionId(): string | null;
  toast(message: string, kind?: "info" | "success" | "warning" | "error"): Promise<void>;
  notify(title: string, body?: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// UI namespace
// ---------------------------------------------------------------------------

export interface PawPageRegistration {
  id: string;
  title?: string;
  icon?: React.ComponentType<{ size?: number }>;
  mount?: (el: HTMLDivElement) => PawDisposable | (() => void);
  route?: string;
}

export interface PawUiNamespace {
  registerPage(registration: PawPageRegistration): void;
  registerToolCard(
    cardName: string,
    render: (data: unknown) => React.ReactNode,
    opts?: { label?: string; icon?: string },
  ): void;
  registerSourceCard(
    sourceType: string,
    render: (data: unknown) => React.ReactNode,
  ): void;
  registerResponseItem(
    itemName: string,
    render: (data: unknown) => React.ReactNode,
  ): void;
  appendResponseItem(
    render: () => React.ReactNode,
    opts?: { clearOnNewTurn?: boolean },
  ): PawDisposable;
  appendResponseHtml(
    html: string,
    opts?: { clearOnNewTurn?: boolean },
  ): PawDisposable;
  prependResponseItem(
    render: () => React.ReactNode,
    opts?: { clearOnNewTurn?: boolean },
  ): PawDisposable;
  appendUserMessage(
    render: () => React.ReactNode,
    opts?: { clearOnNewTurn?: boolean },
  ): PawDisposable;
  registerAction(
    action: string,
    render: (data: unknown) => React.ReactNode,
  ): void;
  registerActionWith(
    action: string,
    render: (data: unknown) => React.ReactNode,
  ): void;
  registerTransform(
    transform: string,
    render: (data: unknown) => React.ReactNode,
    opts?: { label?: string; icon?: string },
  ): void;
  registerToolResult(
    toolName: string,
    render: (data: unknown) => React.ReactNode,
  ): void;
  registerSidebarNode(
    node: React.ReactNode,
    opts?: { order?: number; label?: string },
  ): void;
  setValue(partial: Record<string, unknown>): void;
  setMetadata(partial: Record<string, unknown>): void;
  update(value: unknown): void;
}

export interface PawChatUiNamespace extends PawUiNamespace {
  /** Extend with chat-specific methods if needed. */
}

// ---------------------------------------------------------------------------
// Dependencies namespace
// ---------------------------------------------------------------------------

export type PawDependencyStatus =
  | "healthy"
  | "degraded"
  | "down"
  | "unknown";

export type PawDependencyAction =
  | "restart"
  | "rollback"
  | "scale_up"
  | "scale_down";

export interface PawDependencyHealthState {
  healthy: boolean;
  message?: string;
  checkedAt: string;
}

export interface PawDependencyLifecycleState {
  state: string;
  uptime?: number;
  restartCount?: number;
}

export type PawDependencyOwnership =
  | "owned"
  | "shared"
  | "external";

export interface PawDependencySnapshot {
  id: string;
  name: string;
  status: PawDependencyStatus;
  health?: PawDependencyHealthState;
  lifecycle?: PawDependencyLifecycleState;
  ownership?: PawDependencyOwnership;
  version?: string;
}

export type PawCapabilityStatus = "enabled" | "disabled" | "unavailable";

export interface PawDependenciesNamespace {
  list(force?: boolean): Promise<PawDependencySnapshot[]>;
  restart(dependencyId: string, action: PawDependencyAction, options?: { force?: boolean; intervalMs?: number }): Promise<PawDependencySnapshot>;
  subscribe(listener: (snapshot: PawDependencySnapshot) => void): PawDisposable;
}

// ---------------------------------------------------------------------------
// SDK entry point
// ---------------------------------------------------------------------------

export interface PawSdk {
  api: PawApiNamespace;
  host: PawHostNamespace;
  ui: PawUiNamespace;
  dependencies: PawDependenciesNamespace;
}

export interface PawSdkFactory {
  forApp(appId: string): PawSdk;
}
