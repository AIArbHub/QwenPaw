import { useCallback, useEffect, useRef, useState } from "react";
import { useAppMessage } from "./useAppMessage";
import api from "../api";
import type { MCPClientInfo } from "../api/types";
import { useTranslation } from "react-i18next";

export interface BuiltinMCPStatus {
  /** All built-in MCP clients (元典, 北大法宝) */
  clients: MCPClientInfo[];
  /** Clients that are not yet enabled (need API key configuration) */
  pendingSetup: MCPClientInfo[];
  /** Whether the setup check is in progress */
  loading: boolean;
  /** Whether any built-in client needs attention */
  needsAttention: boolean;
  /** Refresh the built-in MCP client list */
  refresh: () => Promise<void>;
  /** Update a client's headers (for setting API key) and enable it */
  configureAndEnable: (
    clientKey: string,
    headers: Record<string, string>,
  ) => Promise<boolean>;
}

/**
 * Hook for checking built-in legal research MCP clients after login.
 *
 * On mount (i.e., after the user logs in), this hook fetches the built-in
 * MCP clients (元典, 北大法宝) and identifies which ones still need the
 * user to configure their API key. The UI can use `pendingSetup` to
 * display a setup guide.
 */
export function useBuiltinMCPSetup(): BuiltinMCPStatus {
  const { t } = useTranslation();
  const { message } = useAppMessage();
  const [clients, setClients] = useState<MCPClientInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const hasFetched = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listBuiltinMCPClients();
      setClients(data);
    } catch (error) {
      console.error("Failed to load built-in MCP clients:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    void refresh();
  }, [refresh]);

  const pendingSetup = clients.filter((c) => !c.enabled);

  const configureAndEnable = useCallback(
    async (clientKey: string, headers: Record<string, string>) => {
      try {
        // Update the client with the new headers (API key)
        await api.updateMCPClient(clientKey, { headers });
        // Toggle to enable
        await api.toggleMCPClient(clientKey);
        message.success(t("builtinMcp.configureSuccess"));
        await refresh();
        return true;
      } catch (error: any) {
        const errorMsg = error?.message || t("builtinMcp.configureError");
        message.error(errorMsg);
        return false;
      }
    },
    [message, t, refresh],
  );

  return {
    clients,
    pendingSetup,
    loading,
    needsAttention: pendingSetup.length > 0,
    refresh,
    configureAndEnable,
  };
}
