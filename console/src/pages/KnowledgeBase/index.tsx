import { useState, useEffect, useMemo } from "react";
import { Button, Select, Tooltip } from "antd";
import { ReloadOutlined, RobotOutlined } from "@ant-design/icons";
import { BookOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAgentStore } from "../../stores/agentStore";
import FilesWorkspace from "../../features/files-workspace/FilesWorkspace";
import workspaceStyles from "../../features/files-workspace/FilesWorkspace.module.less";
import CuratorPanel from "./CuratorPanel";
import styles from "./index.module.less";

const ALL_AGENTS = "__all__" as const;

export default function KnowledgeBasePage() {
  const { t } = useTranslation();
  const { agents, selectedAgent, refreshAgents } = useAgentStore();

  // The agent that the FilesWorkspace is bound to.
  // In "all agents" mode, default to the first agent or the
  // currently selected one.
  const [editorAgentId, setEditorAgentId] = useState<string>(
    selectedAgent || (agents.length > 0 ? agents[0].id : "default"),
  );
  const [selectedAgentId, setSelectedAgentId] = useState<string>(
    selectedAgent || ALL_AGENTS,
  );
  const [refreshKey, setRefreshKey] = useState(0);
  const [curatorOpen, setCuratorOpen] = useState(false);

  useEffect(() => {
    refreshAgents();
  }, [refreshAgents]);

  useEffect(() => {
    if (selectedAgent) {
      setSelectedAgentId(selectedAgent);
      setEditorAgentId(selectedAgent);
    }
  }, [selectedAgent]);

  // When in "all agents" mode and agents load, default to first agent
  useEffect(() => {
    if (selectedAgentId === ALL_AGENTS && agents.length > 0 && !selectedAgent) {
      setEditorAgentId(agents[0].id);
    }
  }, [agents, selectedAgent, selectedAgentId]);

  const handleAgentChange = (val: string) => {
    setSelectedAgentId(val);
    if (val !== ALL_AGENTS) {
      setEditorAgentId(val);
    } else {
      // In "all agents" mode, pick the first agent for the editor
      const first = agents.find((a) => a.id !== "default") || agents[0];
      if (first) setEditorAgentId(first.id);
    }
  };

  const agentOptions = useMemo(() => {
    const opts = agents.map((a) => ({ label: a.name || a.id, value: a.id }));
    return [{ label: t("knowledge.allAgents", "全部智能体"), value: ALL_AGENTS as string }, ...opts];
  }, [agents, t]);

  return (
    <section className={styles.page} aria-label={t("nav.knowledgeBase", "知识库")}>
      <header className={workspaceStyles.drawerHeader}>
        <div className={workspaceStyles.fileMark} aria-hidden="true">
          <BookOpen size={17} />
        </div>
        <div className={workspaceStyles.drawerTitle}>
          <strong>{t("nav.knowledgeBase", "知识库")}</strong>
        </div>
        <div className={styles.headerActions}>
          <Select
            value={selectedAgentId}
            onChange={handleAgentChange}
            options={agentOptions}
            style={{ width: 180 }}
            placeholder={t("knowledge.agentFilter", "选择智能体")}
            suffixIcon={<RobotOutlined />}
            showSearch
            optionFilterProp="label"
          />
          <Tooltip title={t("knowledge.curator.title", "AI 知识整理")}>
            <Button
              icon={<RobotOutlined />}
              onClick={() => setCuratorOpen(true)}
            />
          </Tooltip>
          <Tooltip title={t("common.refresh", "刷新")}>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => setRefreshKey((k) => k + 1)}
            />
          </Tooltip>
        </div>
      </header>

      <div className={styles.workspace}>
        <FilesWorkspace
          key={`kb:${editorAgentId}:${refreshKey}`}
          scope={{ kind: "agent", agentId: editorAgentId }}
          initialSource="knowledge"
          hideSourceTabs
        />
      </div>

      <CuratorPanel
        open={curatorOpen}
        onClose={() => setCuratorOpen(false)}
        onTaskCompleted={() => setRefreshKey((k) => k + 1)}
      />
    </section>
  );
}
