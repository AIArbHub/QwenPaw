import { Tabs } from "antd";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import TokenUsagePage from "../../Settings/TokenUsage";
import AgentStatsPage from "../../Settings/AgentStats";

export default function DesignUsagePage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "tokens";

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Tabs
        activeKey={activeTab}
        onChange={(key) => setSearchParams({ tab: key })}
        style={{ paddingLeft: 16, paddingRight: 16 }}
        items={[
          {
            key: "tokens",
            label: t("nav.tokenUsage"),
            children: <TokenUsagePage />,
          },
          {
            key: "stats",
            label: t("nav.agentStats"),
            children: <AgentStatsPage />,
          },
        ]}
      />
    </div>
  );
}
