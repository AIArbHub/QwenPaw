import type * as ReactNS from "react";

declare global {
  interface AIArbHost {
    React: typeof ReactNS;
    antd: any;
    antdIcons: any;
    getApiUrl: (path: string) => string;
    getApiToken: () => string;
    useLocale?: () => string;
    useCurrentSession?: () => { id: string } | null;
    getCurrentSessionId?: () => string | null;
    fetch?: (path: string, init?: RequestInit) => Promise<Response>;
  }

  interface AIArbRoute {
    path: string;
    component: unknown;
    label?: string;
    icon?: string;
    priority?: number;
  }

  interface AIArbGlobal {
    host: AIArbHost;
    chat?: {
      approval: {
        render: (
          pluginId: string,
          sourceType: string,
          component: unknown,
        ) => unknown;
      };
      toolRender?: (
        pluginId: string,
        toolName: string,
        component: unknown,
      ) => unknown;
    };
    registerRoutes?: (pluginId: string, routes: AIArbRoute[]) => void;
  }

  interface Window {
    AIArb: AIArbGlobal;
  }
}

export {};
