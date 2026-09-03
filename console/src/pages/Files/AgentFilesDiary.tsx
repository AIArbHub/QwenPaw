import { NotebookPen } from "lucide-react";
import { useTranslation } from "react-i18next";
import FilesWorkspace from "../../features/files-workspace/FilesWorkspace";
import { useAgentStore } from "../../stores/agentStore";
import workspaceStyles from "../../features/files-workspace/FilesWorkspace.module.less";
import styles from "./index.module.less";

export default function AgentFilesDiaryPage() {
  const { t } = useTranslation();
  const { selectedAgent } = useAgentStore();

  return (
    <section className={styles.page} aria-label={t("nav.agentFilesDiary", "日记")}>
      <header className={workspaceStyles.drawerHeader}>
        <div className={workspaceStyles.fileMark} aria-hidden="true">
          <NotebookPen size={17} />
        </div>
        <div className={workspaceStyles.drawerTitle}>
          <strong>{t("nav.agentFilesDiary", "日记")}</strong>
        </div>
      </header>
      <div className={styles.workspace}>
        <FilesWorkspace
          scope={{ kind: "agent", agentId: selectedAgent }}
          initialSource="daily"
          hideSourceTabs
        />
      </div>
    </section>
  );
}
