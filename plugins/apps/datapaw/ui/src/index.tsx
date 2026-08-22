import { createRoot } from "react-dom/client";

import { App } from "./App";
import { requireAIArbDataSdk } from "./sdk";
import styles from "./styles.css?inline";

function installStyles(): () => void {
  const element = document.createElement("style");
  element.dataset.datapawApp = "true";
  element.textContent = styles;
  document.head.appendChild(element);
  return () => element.remove();
}

try {
  const paw = requireAIArbDataSdk();
  paw.ui.registerPage({
    path: "/apps/datapaw",
    label: "AIArb-Data",
    icon: "📊",
    priority: 20,
    mount(container) {
      const removeStyles = installStyles();
      const root = createRoot(container);
      root.render(<App paw={paw} />);
      return () => {
        root.unmount();
        removeStyles();
      };
    },
  });
} catch (error) {
  console.error("[datapaw] Could not register the native app", error);
}
