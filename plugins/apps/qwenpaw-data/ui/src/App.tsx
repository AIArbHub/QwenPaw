import { useEffect, useMemo, useState } from "react";
import type { AIARBDataHandoff, AIARBDataSdk } from "./AIARB-host";
import { EmbeddedDataConsole } from "./EmbeddedDataConsole";

export function dataRouteFromHandoff(handoff: AIARBDataHandoff): string {
  const project = handoff.context.project_ref;
  if (
    handoff.target_app_id !== "AIARB-data" ||
    project.app_id !== "AIARB-data" ||
    project.kind !== "analysis-session"
  ) {
    throw new Error("unsupported_data_handoff");
  }
  const query = new URLSearchParams({ session_id: project.project_id });
  if (handoff.context.view_id) {
    query.set("paw_view", handoff.context.view_id);
  }
  return `/console?${query.toString()}`;
}

/**
 * The embedded engine console owns the entire app surface: navigation,
 * branding, language, model setup (Agent Configuration), channels, and
 * the DataBridge service configuration. The shell only mounts it.
 */
export function App({ paw }: { paw?: AIARBDataSdk } = {}) {
  const sdk = useMemo(
    () => paw ?? window.AIARB?.paw?.forApp("AIARB-data"),
    [paw],
  );
  const handoffId = new URLSearchParams(window.location.search).get("handoff");
  const [route, setRoute] = useState<string | null>(
    handoffId ? null : "/console",
  );
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!handoffId) return;
    if (!sdk) {
      setError(true);
      return;
    }
    let active = true;
    void sdk.apps
      .resolveHandoff(handoffId)
      .then((handoff) => {
        if (active) setRoute(dataRouteFromHandoff(handoff));
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [handoffId, sdk]);

  return (
    <div className="AIARB-data-app">
      <main className="AIARB-data-main">
        {route && <EmbeddedDataConsole route={route} active />}
        {!route && !error && (
          <p className="AIARB-data-handoff">Opening analysis…</p>
        )}
        {error && (
          <p className="AIARB-data-handoff" role="alert">
            This analysis link is unavailable.
          </p>
        )}
      </main>
    </div>
  );
}
