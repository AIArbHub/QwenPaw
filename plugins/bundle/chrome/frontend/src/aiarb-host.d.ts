// Ambient declarations for the AIArb console host API.
//
// The AIArb console injects a shared `window.AIArb` object at
// runtime; we externalize `react`/`react-dom` (see `vite.config.ts`)
// and pull `React`/`antd` off `host` instead of bundling them. Without
// these declarations every access reduces to `any` and the compiler
// cannot tell us when the host contract drifts.

import type * as ReactNS from "react";

declare global {
  interface AIArbHost {
    React: typeof ReactNS;
    antd: any;
    getApiUrl: (path: string) => string;
    getApiToken: () => string;
  }

  interface AIArbRoute {
    path: string;
    component: unknown;
    label?: string;
    icon?: ReactNS.ReactNode;
    priority?: number;
  }

  interface AIArbGlobal {
    host: AIArbHost;
    registerRoutes?: (pluginId: string, routes: AIArbRoute[]) => void;
  }

  interface Window {
    AIArb: AIArbGlobal;
  }
}

export {};
