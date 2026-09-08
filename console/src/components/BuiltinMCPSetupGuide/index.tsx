import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Input, Modal, Tag } from "antd";
import { useTranslation } from "react-i18next";
import { ExternalLink, KeyRound } from "lucide-react";
import { useBuiltinMCPSetup } from "../../hooks/useBuiltinMCPSetup";
import type { MCPClientInfo } from "../../api/types";

/**
 * A setup guide banner that appears after login when built-in legal
 * research MCP clients (元典, 北大法宝) need API key configuration.
 *
 * Shows a dismissible Alert at the top of the main content area, and
 * a Modal for entering API keys when the user clicks "Configure".
 */
export function BuiltinMCPSetupGuide() {
  const { t } = useTranslation();
  const { pendingSetup, loading, configureAndEnable } = useBuiltinMCPSetup();
  const [dismissed, setDismissed] = useState(false);
  const [modalClient, setModalClient] = useState<MCPClientInfo | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [confirmLoading, setConfirmLoading] = useState(false);

  // Reset dismissed state when the set of pending clients changes
  useEffect(() => {
    if (pendingSetup.length === 0) {
      setDismissed(false);
    }
  }, [pendingSetup.length]);

  const handleConfigure = useCallback(
    async (client: MCPClientInfo) => {
      setModalClient(client);
      setApiKey("");
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!modalClient || !apiKey.trim()) return;
    setConfirmLoading(true);
    // Both Yuandian and Pkulaw use Bearer token in the
    // Authorization header — just replace the placeholder
    // with the actual key.
    const headerValue = `Bearer ${apiKey.trim()}`;
    const success = await configureAndEnable(modalClient.key, {
      Authorization: headerValue,
    });
    setConfirmLoading(false);
    if (success) {
      setModalClient(null);
      setApiKey("");
    }
  }, [modalClient, apiKey, configureAndEnable]);

  if (loading || dismissed || pendingSetup.length === 0) {
    return null;
  }

  const description = t("builtinMcp.setupGuideDescription", {
    count: pendingSetup.length,
  });

  return (
    <>
      <Alert
        type="info"
        showIcon
        icon={<KeyRound size={16} />}
        message={t("builtinMcp.setupGuideTitle")}
        description={
          <div>
            <p style={{ marginBottom: 8 }}>{description}</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {pendingSetup.map((client) => (
                <Tag
                  key={client.key}
                  style={{ cursor: "pointer", padding: "2px 8px" }}
                  onClick={() => handleConfigure(client)}
                >
                  {client.name}
                </Tag>
              ))}
            </div>
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              {pendingSetup[0] && (
                <Button
                  type="primary"
                  size="small"
                  onClick={() => handleConfigure(pendingSetup[0])}
                >
                  {t("builtinMcp.configureNow")}
                </Button>
              )}
              <Button
                type="text"
                size="small"
                onClick={() => setDismissed(true)}
              >
                {t("builtinMcp.dismiss")}
              </Button>
            </div>
          </div>
        }
        style={{ marginBottom: 12 }}
      />
      <Modal
        title={
          modalClient
            ? t("builtinMcp.configureTitle", { name: modalClient.name })
            : ""
        }
        open={modalClient !== null}
        onCancel={() => setModalClient(null)}
        footer={
          <>
            <Button onClick={() => setModalClient(null)}>
              {t("builtinMcp.cancel")}
            </Button>
            <Button
              type="primary"
              loading={confirmLoading}
              disabled={!apiKey.trim()}
              onClick={handleSave}
            >
              {t("builtinMcp.save")}
            </Button>
          </>
        }
      >
        {modalClient && (
          <div>
            <p style={{ marginBottom: 12 }}>{modalClient.description}</p>
            {modalClient.key.startsWith("yuandian") && (
              <a
                href="https://open.chineselaw.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                {t("builtinMcp.getYuandianKey")}
                <ExternalLink size={14} />
              </a>
            )}
            {modalClient.key.startsWith("pkulaw") && (
              <a
                href="https://www.pkulaw.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                {t("builtinMcp.getPkulawKey")}
                <ExternalLink size={14} />
              </a>
            )}
            <div style={{ marginTop: 12 }}>
              <label
                style={{
                  display: "block",
                  marginBottom: 4,
                  fontSize: 13,
                  color: "rgba(0,0,0,0.65)",
                }}
              >
                {t("builtinMcp.apiKeyLabel")}
              </label>
              <Input.Password
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={t("builtinMcp.apiKeyPlaceholder")}
                autoFocus
              />
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
