import { useState, Suspense, lazy } from "react";
import { Empty, Skeleton } from "antd";
import { useTranslation } from "react-i18next";
import { useAgentStore } from "@/stores/agentStore";
import { UnderlineTabs } from "@/components/UnderlineTabs";
import HeroSection from "./components/HeroSection";
import styles from "./index.module.less";

// ─── Lazy-loaded Tab contents ────────────────────────────────────
const OverviewTab = lazy(() => import("./components/OverviewTab"));
const SessionListContent = lazy(
  () => import("@/pages/Control/Sessions/SessionListContent"),
);
const CronJobListContent = lazy(
  () => import("@/pages/Control/CronJobs/CronJobListContent"),
);
const MemoryExplorer = lazy(() => import("@/pages/Memory/MemoryExplorer"));
const MessageListContent = lazy(
  () => import("@/pages/Inbox/MessageListContent"),
);

type TabKey = "overview" | "sessions" | "cronjobs" | "memory" | "events";

/**
 * WorkbenchPage — 智能体聚合工作台。
 *
 * 以 Hero + Tab 方式整合现有组件，不新开发功能。
 * 方案文档第四部分。
 */
const WorkbenchPage: React.FC = () => {
  const { t } = useTranslation();
  const { selectedAgent, agents } = useAgentStore();
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  const agent = agents.find((a) => a.id === selectedAgent);

  if (!agent) {
    return (
      <div className={styles.workbench}>
        <Empty
          description={t("workbench.noAgent")}
          style={{ marginTop: 120 }}
        />
      </div>
    );
  }

  return (
    <div className={styles.workbench}>
      <HeroSection agent={agent} />

      <div className={styles.tabsRow}>
        <UnderlineTabs
          items={[
            { key: "overview", label: t("workbench.overview") },
            { key: "sessions", label: t("workbench.sessions") },
            { key: "cronjobs", label: t("workbench.cronjobs") },
            { key: "memory", label: t("workbench.memory") },
            { key: "events", label: t("workbench.events") },
          ]}
          active={activeTab}
          onChange={(key) => setActiveTab(key as TabKey)}
        />
      </div>

      <div className={styles.tabContent}>
        <Suspense
          fallback={
            <div className={styles.skeletonFallback}>
              <Skeleton active paragraph={{ rows: 6 }} />
            </div>
          }
        >
          {activeTab === "overview" && (
            <OverviewTab
              agentId={selectedAgent}
              onNavigate={(tab) => setActiveTab(tab)}
            />
          )}
          {activeTab === "sessions" && (
            <SessionListContent agentId={selectedAgent} />
          )}
          {activeTab === "cronjobs" && (
            <CronJobListContent agentId={selectedAgent} />
          )}
          {activeTab === "memory" && <MemoryExplorer agentId={selectedAgent} />}
          {activeTab === "events" && (
            <MessageListContent agentId={selectedAgent} />
          )}
        </Suspense>
      </div>
    </div>
  );
};

export default WorkbenchPage;
