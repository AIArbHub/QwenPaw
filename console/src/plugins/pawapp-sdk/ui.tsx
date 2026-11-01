import React, { useEffect, useRef } from "react";
import { routeRegistry } from "../registry/store";
import type {
  PawChatUiNamespace,
  PawDisposable,
  PawPageRegistration,
  PawUiNamespace,
} from "./types";
import { normalizeAppId, normalizeAppRelativePath } from "./scope";

function mountedComponent(
  mount: NonNullable<PawPageRegistration["mount"]>,
): React.ComponentType {
  return function PawAppMountedPage() {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
      if (!ref.current) return;
      const cleanup = mount(ref.current);
      return () => {
        if (typeof cleanup === "function") cleanup();
        else cleanup?.dispose();
      };
    }, []);
    return <div ref={ref} style={{ width: "100%", height: "100%" }} />;
  };
}

function requireChat() {
  if (!window.AIARB.chat) {
    throw new Error("PawApp chat UI capabilities are unavailable");
  }
  return window.AIARB.chat;
}

type AppIdProvider = string | (() => string);

function resolveAppId(provider: AppIdProvider): string {
  return typeof provider === "function" ? provider() : provider;
}

function createChatUiNamespace(provider: AppIdProvider): PawChatUiNamespace {
  return {
    theme: {
      set: (partial: Record<string, unknown>) =>
        requireChat().theme.set(resolveAppId(provider), partial),
    },
    welcome: {
      set: (partial: Record<string, unknown>) =>
        requireChat().welcome.set(resolveAppId(provider), partial),
      render: (value: unknown) =>
        requireChat().welcome.render(resolveAppId(provider), value),
    },
    leftHeader: {
      set: (partial: Record<string, unknown>) =>
        requireChat().leftHeader.set(resolveAppId(provider), partial),
      render: (node: React.ReactNode) =>
        requireChat().leftHeader.render(resolveAppId(provider), node),
    },
    rightHeader: {
      add: (node: React.ReactNode, opts?: { id?: string; order?: number }) =>
        requireChat().rightHeader.add(resolveAppId(provider), node, opts),
    },
    sender: {
      set: (partial: Record<string, unknown>) =>
        requireChat().sender.set(resolveAppId(provider), partial),
      addPrefix: (node: React.ReactNode, opts?: { id?: string; order?: number }) =>
        requireChat().sender.addPrefix(resolveAppId(provider), node, opts),
      addSuggestion: (item: { id?: string; items: unknown[] }) =>
        requireChat().sender.addSuggestion(resolveAppId(provider), item),
    },
    actions: {
      add: (action: unknown) =>
        requireChat().actions.add(resolveAppId(provider), action),
    },
    requestActions: {
      add: (action: unknown) =>
        requireChat().requestActions.add(resolveAppId(provider), action),
    },
    requestPayload: {
      add: (transform: unknown, opts?: { id?: string; order?: number }) =>
        requireChat().requestPayload.add(
          resolveAppId(provider),
          transform,
          opts,
        ),
    },
    request: {
      render: (render: unknown) =>
        requireChat().request.render(resolveAppId(provider), render),
      prepend: (render: unknown, opts?: { id?: string; order?: number }) =>
        requireChat().request.prepend(resolveAppId(provider), render, opts),
      append: (render: unknown, opts?: { id?: string; order?: number }) =>
        requireChat().request.append(resolveAppId(provider), render, opts),
    },
    response: {
      set: (partial: Record<string, unknown>) =>
        requireChat().response.set(resolveAppId(provider), partial),
      render: (render: unknown) =>
        requireChat().response.render(resolveAppId(provider), render),
      prepend: (render: unknown, opts?: { id?: string; order?: number }) =>
        requireChat().response.prepend(resolveAppId(provider), render, opts),
      append: (render: unknown, opts?: { id?: string; order?: number }) =>
        requireChat().response.append(resolveAppId(provider), render, opts),
    },
    toolRender: (toolName: string, render: unknown) =>
      requireChat().toolRender(resolveAppId(provider), toolName, render),
    approvalRender: (sourceType: string, render: unknown) =>
      requireChat().approval.render(resolveAppId(provider), sourceType, render),
    card: (cardName: string, render: unknown) =>
      requireChat().card(resolveAppId(provider), cardName, render),
    disposeAll: () => requireChat().disposeAll(resolveAppId(provider)),
  };
}

export function createUiNamespace(provider: AppIdProvider): PawUiNamespace {
  return {
    registerPage(registration: PawPageRegistration): PawDisposable {
      const appId = normalizeAppId(resolveAppId(provider));
      if (!!registration.component === !!registration.mount) {
        throw new Error(
          "PawApp page registration requires exactly one of component or mount",
        );
      }
      const path = normalizeAppRelativePath(
        registration.path ?? `/apps/${appId}`,
      );
      if (path !== `/apps/${appId}` && !path.startsWith(`/apps/${appId}/`)) {
        throw new Error(`PawApp page path must stay under /apps/${appId}`);
      }
      const Component =
        registration.component ?? mountedComponent(registration.mount!);
      return routeRegistry.add(appId, {
        id: `pawapp:${appId}:${path}`,
        path,
        component: Component,
      });
    },
    registerToolCard(): void {},
    registerSourceCard(): void {},
    registerResponseItem(): void {},
    appendResponseItem(): PawDisposable {
      return { dispose() {} };
    },
    appendResponseHtml(): PawDisposable {
      return { dispose() {} };
    },
    prependResponseItem(): PawDisposable {
      return { dispose() {} };
    },
    appendUserMessage(): PawDisposable {
      return { dispose() {} };
    },
    registerAction(): void {},
    registerActionWith(): void {},
    registerTransform(): void {},
    registerToolResult(): void {},
    registerSidebarNode(): void {},
    setValue(): void {},
    setMetadata(): void {},
    update(): void {},
    chat: createChatUiNamespace(provider),
  };
}
