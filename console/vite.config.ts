/// <reference types="vitest" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Vitest plugin: transforms .css imports inside node_modules to empty stubs.
// This prevents errors from packages like @agentscope-ai/icons that import CSS.
const cssStubPlugin = {
  name: "css-stub",
  transform(_code: string, id: string) {
    if (id.includes("node_modules") && id.endsWith(".css")) {
      return { code: "export default {}" };
    }
  },
};

// Suppress known third-party React DOM warnings in dev mode.
// @ant-design/icons uses kebab-case SVG attrs (fill-rule) that trigger React warnings.
// @agentscope-ai/design ActionButton/IconButton forwardRef render functions
// accept only (props) without ref, which triggers a React warning.
// NOTE: We cannot use import.meta.env inside transformIndexHtml because Vite
// does not transform inline scripts. Instead, we check mode at build time.
function suppressThirdPartyWarningsPlugin(mode: string) {
  return {
    name: "suppress-third-party-warnings",
    transformIndexHtml(html: string) {
      if (mode !== "development") return html;
      return html.replace(
        "</head>",
        `<script>
          const origWarn = console.warn;
          console.warn = function (...args) {
            const msg = args[0];
            if (typeof msg === 'string' && msg.includes('Invalid DOM property')) return;
            if (typeof msg === 'string' && msg.includes('forwardRef render functions accept exactly two parameters')) return;
            origWarn.apply(console, args);
          };
        </script></head>`,
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Empty = same-origin; frontend and backend served together, no hardcoded host.
  // Use a dedicated Vite-prefixed key so unrelated shell BASE_URL values don't leak into the build.
  const apiBaseUrl = env.VITE_API_BASE_URL ?? "";

  return {
    define: {
      VITE_API_BASE_URL: JSON.stringify(apiBaseUrl),
      TOKEN: JSON.stringify(env.TOKEN || ""),
      MOBILE: false,
    },
    plugins: [react(), cssStubPlugin, suppressThirdPartyWarningsPlugin(mode)],
    css: {
      modules: {
        localsConvention: "camelCase",
        generateScopedName: "[name]__[local]__[hash:base64:5]",
      },
      preprocessorOptions: {
        less: {
          javascriptEnabled: true,
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      host: "0.0.0.0",
      port: 5173,
      proxy: {
        "/api": {
          target: "http://localhost:8088",
          changeOrigin: false,
        },
      },
    },
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      css: true,
      // all @agentscope-ai/* packages excluded from inline — they are large / have CSS imports
      // aliases below redirect each to a stub or compiled entry
      deps: {
        inline: [/@agentscope-ai\/(?!icons|chat|design)/],
      },
      alias: {
        // chat is aliased to a tiny stub to avoid OOM from the 2.3MB real package
        // Tests that need specific behavior override with vi.mock('@agentscope-ai/chat', factory)
        "@agentscope-ai/chat": path.resolve(__dirname, "src/test/chat-mock.ts"),
        // design is aliased to a stub to avoid hanging from its 3MB lib
        "@agentscope-ai/design": path.resolve(
          __dirname,
          "src/test/design-mock.ts",
        ),
        "@agentscope-ai/icons": path.resolve(
          __dirname,
          "src/test/icons-mock.ts",
        ),
        "@tauri-apps/api/core": path.resolve(
          __dirname,
          "src/test/tauri-mock.ts",
        ),
        "@tauri-apps/plugin-dialog": path.resolve(
          __dirname,
          "src/test/tauri-mock.ts",
        ),
      },
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        // 旧测试用 node:test，与 vitest 不兼容，待迁移
        "**/testConnectionMessage.test.ts",
        // ChatPage test causes worker crash - pre-existing issue, needs more mock setup
        "**/pages/Chat/ChatPage.test.tsx",
        // Tauri modules require @tauri-apps/api which only exists in desktop builds
        "**/src/tauri/**",
      ],
      coverage: {
        provider: "v8",
        reporter: ["text", "html", "json", "json-summary", "lcov", "cobertura"],
        include: ["src/**/*.{ts,tsx}"],
        exclude: [
          "src/test/**",
          "src/tauri/**",
          "src/**/*.d.ts",
          "src/main.tsx",
          "src/vite-env.d.ts",
        ],
        thresholds: {
          statements: 5,
          branches: 4,
          functions: 3,
          lines: 5,
        },
      },
    },
    optimizeDeps: {
      include: [
        "diff",
        // react-syntax-highlighter prism language modules — the
        // CodeHighlighter from @ant-design/x uses dynamic imports
        // (`import('.../prism/${lang}')`) which Vite can't pre-bundle
        // automatically.  Listing the common languages here ensures
        // they are resolved at runtime.
        "react-syntax-highlighter/dist/esm/languages/prism/bash",
        "react-syntax-highlighter/dist/esm/languages/prism/markdown",
        "react-syntax-highlighter/dist/esm/languages/prism/json",
        "react-syntax-highlighter/dist/esm/languages/prism/python",
        "react-syntax-highlighter/dist/esm/languages/prism/javascript",
        "react-syntax-highlighter/dist/esm/languages/prism/typescript",
        "react-syntax-highlighter/dist/esm/languages/prism/jsx",
        "react-syntax-highlighter/dist/esm/languages/prism/tsx",
        "react-syntax-highlighter/dist/esm/languages/prism/yaml",
        "react-syntax-highlighter/dist/esm/languages/prism/css",
        "react-syntax-highlighter/dist/esm/languages/prism/sql",
        "react-syntax-highlighter/dist/esm/languages/prism/go",
        "react-syntax-highlighter/dist/esm/languages/prism/rust",
        "react-syntax-highlighter/dist/esm/languages/prism/java",
        "react-syntax-highlighter/dist/esm/languages/prism/c",
        "react-syntax-highlighter/dist/esm/languages/prism/cpp",
        "react-syntax-highlighter/dist/esm/languages/prism/shell-session",
        "react-syntax-highlighter/dist/esm/languages/prism/markup",
        "react-syntax-highlighter/dist/esm/languages/prism/diff",
        "react-syntax-highlighter/dist/esm/languages/prism/docker",
        "react-syntax-highlighter/dist/esm/languages/prism/nginx",
        "react-syntax-highlighter/dist/esm/languages/prism/powershell",
        "react-syntax-highlighter/dist/esm/languages/prism/latex",
      ],
    },
    build: {
      // Output to QwenPaw's console directory,
      // so we don't need to copy files manually after build.
      // outDir: path.resolve(__dirname, "../src/qwenpaw/console"),
      // emptyOutDir: true,
      cssCodeSplit: true,
      sourcemap: mode !== "production",
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            // React core
            if (
              id.includes("node_modules/react/") ||
              id.includes("node_modules/react-dom/") ||
              id.includes("node_modules/react-router-dom/") ||
              id.includes("node_modules/scheduler/")
            ) {
              return "react-vendor";
            }
            // Ant Design + AgentScope design system (merged to avoid circular deps)
            if (
              id.includes("node_modules/antd/") ||
              id.includes("node_modules/antd-style/") ||
              id.includes("node_modules/@ant-design/") ||
              id.includes("node_modules/@agentscope-ai/")
            ) {
              return "ui-vendor";
            }
            // i18n
            if (
              id.includes("node_modules/i18next/") ||
              id.includes("node_modules/react-i18next/")
            ) {
              return "i18n-vendor";
            }
            // Markdown rendering
            if (
              id.includes("node_modules/react-markdown/") ||
              id.includes("node_modules/remark-gfm/") ||
              id.includes("node_modules/rehype") ||
              id.includes("node_modules/remark") ||
              id.includes("node_modules/unified/") ||
              id.includes("node_modules/mdast") ||
              id.includes("node_modules/hast") ||
              id.includes("node_modules/micromark")
            ) {
              return "markdown-vendor";
            }
            // Drag and drop
            if (id.includes("node_modules/@dnd-kit/")) {
              return "dnd-vendor";
            }
            // Utilities (dayjs, zustand, ahooks, etc.)
            if (
              id.includes("node_modules/dayjs/") ||
              id.includes("node_modules/zustand/") ||
              id.includes("node_modules/ahooks/") ||
              id.includes("node_modules/@vvo/tzdb/")
            ) {
              return "utils-vendor";
            }
          },
        },
      },
    },
  };
});