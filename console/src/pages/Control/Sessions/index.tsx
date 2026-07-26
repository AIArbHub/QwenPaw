import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/PageHeader";
import { useAgentStore } from "../../../stores/agentStore";
import SessionListContent from "./SessionListContent";
import styles from "./index.module.less";

function SessionsPage() {
  const { t } = useTranslation();
  const { selectedAgent } = useAgentStore();

  return (
    <div className={styles.sessionsPage}>
      <PageHeader
        items={[{ title: t("nav.control") }, { title: t("sessions.title") }]}
      />
      <SessionListContent agentId={selectedAgent} showHeader />
    </div>
  );
}

export default SessionsPage;
