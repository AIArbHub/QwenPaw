import { BookOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import FilesWorkspace from "../../features/files-workspace/FilesWorkspace";
import { useAgentStore } from "../../stores/agentStore";
import workspaceStyles from "../../features/files-workspace/FilesWorkspace.module.less";
import styles from "./index.module.less";

export default function AgentFilesKBPage() {
  const { t } = useTranslation();
  const { selectedAgent } = useAgentStore();

  return (
    <section className={styles.page} aria-label={t("nav.agentFilesSpecificKB", "专属知识库")}>
      <header className={workspaceStyles.drawerHeader}>
        <div className={workspaceStyles.fileMark} aria-hidden="true">
          <BookOpen size={17} />
        </div>
        <div className={workspaceStyles.drawerTitle}>
          <strong>{t("nav.agentFilesSpecificKB", "专属知识库")}</strong>
        </div>
      </header>
      <div className={styles.workspace}>
        <FilesWorkspace
          scope={{ kind: "agent", agentId: selectedAgent }}
          initialSource="digest"
          hideSourceTabs
        />
      </div>
    </section>
  );
}
