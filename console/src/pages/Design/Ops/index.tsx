import { Tabs } from "antd";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import BackupsPage from "../../Settings/Backups";
import DebugPage from "../../Settings/Debug";
import VoiceTranscriptionPage from "../../Settings/VoiceTranscription";
import PluginManagerPage from "../../Settings/PluginManager";

export default function DesignOpsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "backups";

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Tabs
        activeKey={activeTab}
        onChange={(key) => setSearchParams({ tab: key })}
        style={{ paddingLeft: 16, paddingRight: 16 }}
        items={[
          {
            key: "backups",
            label: t("nav.backups"),
            children: <BackupsPage />,
          },
          { key: "debug", label: t("nav.debug"), children: <DebugPage /> },
          {
            key: "voice",
            label: t("nav.voiceTranscription"),
            children: <VoiceTranscriptionPage />,
          },
          {
            key: "plugins",
            label: t("nav.pluginManager"),
            children: <PluginManagerPage />,
          },
        ]}
      />
    </div>
  );
}
