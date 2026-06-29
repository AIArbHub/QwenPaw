import { Tabs } from "antd";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import AgentsPage from "../../Settings/Agents";
import AgentConfigPage from "../../Agent/Config";
import AgentStatsPage from "../../Settings/AgentStats";

export default function DesignAgentPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "manage";

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Tabs
        activeKey={activeTab}
        onChange={(key) => setSearchParams({ tab: key })}
        style={{ paddingLeft: 16, paddingRight: 16 }}
        items={[
          { key: "manage", label: t("nav.agents"), children: <AgentsPage /> },
          { key: "config", label: t("nav.agentConfig"), children: <AgentConfigPage /> },
          { key: "stats", label: t("nav.agentStats"), children: <AgentStatsPage /> },
        ]}
      />
    </div>
  );
}