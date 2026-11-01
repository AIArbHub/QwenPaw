/** Public types for the AIARB plugin system.
 *
 *  Re-exports host-facing type aliases from the canonical definitions in
 *  `src/aiarb/plugins/frontend/host.d.ts`.
 */
export type {
  ChatCodeBlockProps,
  ChatSubmitInput,
  ChatRequestData,
  ChatResponseData,
  ChatRequestRenderFn,
  ChatResponseRenderFn,
  ChatRequestSlotFn,
  ChatResponseSlotFn,
  ChatRequestPayloadTransform,
  AIARBChatNamespace,
  AIARBHostNamespace,
  AIARBAuditNamespace,
  AIARBWindowNamespace,
  Disposable,
  Localized,
  HostThemeMode,
  HostAgentInfo,
  HostSessionInfo,
  ChatPromptItem,
  ChatSuggestionItem,
  ChatActionSpec,
  OverrideRecord,
  WelcomeRenderProps,
  WelcomeRenderValue,
  PluginRouteDeclaration,
  MemoryBackendExtension,
  AIARBMemoryBackendsNamespace,
} from "../../../../../src/aiarb/plugins/frontend/host";
