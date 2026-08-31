import { Brain } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAgentStore } from "../../stores/agentStore";
import { MemoryCenterPanel } from "../Settings/Agents/components/MemoryCenterPanel";
import styles from "./index.module.less";

export default function MemoryPage() {
  const { t } = useTranslation();
  const { selectedAgent } = useAgentStore();

  return (
    <section className={styles.page} aria-label={t("agent.memory", "记忆")}>
      <header className={styles.header}>
        <div className={styles.headerIcon} aria-hidden="true">
          <Brain size={17} />
        </div>
        <div className={styles.headerTitle}>
          <strong>{t("agent.memory", "记忆中心")}</strong>
        </div>
      </header>
      <div className={styles.content}>
        <MemoryCenterPanel agentId={selectedAgent} />
      </div>
    </section>
  );
}
