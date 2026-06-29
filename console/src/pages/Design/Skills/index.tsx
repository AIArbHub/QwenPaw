import { useState, useEffect } from "react";
import { Tabs, Alert } from "antd";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { MermaidCodeBlock } from "../../../components/MermaidCodeBlock";
import SkillsPage from "../../Agent/Skills";
import SkillPoolPage from "../../Settings/SkillPool";
import MarketPage from "../../Settings/Market";

const HINT_STORAGE_KEY = "design-skills-hint-dismissed";

const SKILLS_FLOW_CHART = `flowchart LR
    classDef market fill:#e6f7ff,stroke:#1890ff,stroke-width:2px
    classDef pool fill:#f0fff4,stroke:#52c41a,stroke-width:2px
    classDef work fill:#fff7e6,stroke:#fa8c16,stroke-width:2px
    classDef task fill:#f5f5f5,stroke:#bfbfbf,stroke-width:1px,color:#888

    Market["🛒 技能市场<br/>线上商城｜获取各类技能"]:::market
    Pool["📦 技能池<br/>本地储物间｜离线存储备用技能"]:::pool
    Work["🖥️ 工作区技能<br/>工作台｜智能体正在使用的技能"]:::work
    Task[执行任务]:::task

    Market -- 下载存入 --> Pool
    Market -- 一键直装 --> Work
    Pool <-- 复制/同步互通 --> Work

    Work -. "调用技能" .-> Task`;

export default function DesignSkillsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "installed";

  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(HINT_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [collapsed, setCollapsed] = useState(dismissed);

  useEffect(() => {
    if (dismissed) {
      try {
        localStorage.setItem(HINT_STORAGE_KEY, "1");
      } catch {
        // storage unavailable
      }
    }
  }, [dismissed]);

  const handleDismiss = () => {
    setDismissed(true);
    setCollapsed(true);
  };

  const handleExpand = () => {
    setCollapsed(false);
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {collapsed ? (
        <Alert
          type="info"
          showIcon
          message={t("design.skillsHintCollapsed")}
          style={{ margin: "8px 16px 0", cursor: "pointer" }}
          action={
            <a onClick={handleExpand}>{t("design.skillsHintExpand")}</a>
          }
        />
      ) : (
        <Alert
          type="info"
          showIcon
          style={{ margin: "8px 16px 0" }}
          message={t("design.skillsHintTitle")}
          description={
            <div style={{ lineHeight: 1.8 }}>
              <div style={{ marginBottom: 4 }}>{t("design.skillsHintSummary")}</div>
              <div>{t("design.skillsHintInstalled")}</div>
              <div>{t("design.skillsHintPool")}</div>
              <div>{t("design.skillsHintMarket")}</div>
              <div style={{ marginTop: 8, fontWeight: 500 }}>
                {t("design.skillsHintFlow")}
              </div>
              <div style={{ marginTop: 8, overflowX: "auto" }}>
                <MermaidCodeBlock chart={SKILLS_FLOW_CHART} />
              </div>
            </div>
          }
          closable
          onClose={handleDismiss}
          action={
            <button
              onClick={handleDismiss}
              style={{
                border: "none",
                background: "rgba(75, 63, 227, 0.08)",
                color: "#4B3FE3",
                borderRadius: 6,
                padding: "2px 12px",
                cursor: "pointer",
                fontSize: 13,
                whiteSpace: "nowrap",
                alignSelf: "flex-start",
              }}
            >
              {t("design.skillsHintDismiss")}
            </button>
          }
        />
      )}
      <Tabs
        activeKey={activeTab}
        onChange={(key) => setSearchParams({ tab: key })}
        style={{ paddingLeft: 16, paddingRight: 16 }}
        items={[
          { key: "installed", label: t("nav.skills"), children: <SkillsPage /> },
          { key: "pool", label: t("nav.skillPool"), children: <SkillPoolPage /> },
          { key: "market", label: t("nav.market"), children: <MarketPage /> },
        ]}
      />
    </div>
  );
}