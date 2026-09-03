import { Files } from "lucide-react";
import { useTranslation } from "react-i18next";
import FilesWorkspace from "../../features/files-workspace/FilesWorkspace";
import { useAgentStore } from "../../stores/agentStore";
import workspaceStyles from "../../features/files-workspace/FilesWorkspace.module.less";
import styles from "./index.module.less";

export default function AgentFilesWorkspacePage() {
  const { t } = useTranslation();
  const { selectedAgent } = useAgentStore();

  return (
    <section className={styles.page} aria-label={t("nav.agentFilesWorkspace", "工作区文件")}>
      <header className={workspaceStyles.drawerHeader}>
        <div className={workspaceStyles.fileMark} aria-hidden="true">
          <Files size={17} />
        </div>
        <div className={workspaceStyles.drawerTitle}>
          <strong>{t("nav.agentFilesWorkspace", "工作区文件")}</strong>
        </div>
      </header>
      <div className={styles.workspace}>
        <FilesWorkspace
          scope={{ kind: "agent", agentId: selectedAgent }}
          initialSource="workspace"
          hideSourceTabs
        />
      </div>
    </section>
  );
}
