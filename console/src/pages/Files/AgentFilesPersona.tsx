import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import FilesWorkspace from "../../features/files-workspace/FilesWorkspace";
import { useAgentStore } from "../../stores/agentStore";
import workspaceStyles from "../../features/files-workspace/FilesWorkspace.module.less";
import styles from "./index.module.less";

export default function AgentFilesPersonaPage() {
  const { t } = useTranslation();
  const { selectedAgent } = useAgentStore();

  return (
    <section className={styles.page} aria-label={t("nav.agentFilesPersona", "灵魂人设")}>
      <header className={workspaceStyles.drawerHeader}>
        <div className={workspaceStyles.fileMark} aria-hidden="true">
          <Sparkles size={17} />
        </div>
        <div className={workspaceStyles.drawerTitle}>
          <strong>{t("nav.agentFilesPersona", "灵魂人设")}</strong>
        </div>
      </header>
      <div className={styles.workspace}>
        <FilesWorkspace
          scope={{ kind: "agent", agentId: selectedAgent }}
          initialSource="profile"
          hideSourceTabs
        />
      </div>
    </section>
  );
}
