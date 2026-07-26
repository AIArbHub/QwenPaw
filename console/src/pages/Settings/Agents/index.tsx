import { useState, useRef, useCallback, useMemo } from "react";
import { Card, Button, Form, Input } from "antd";
import { useAppMessage } from "../../../hooks/useAppMessage";
import {
  PlusOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { agentsApi } from "../../../api/modules/agents";
import { invalidateSkillCache, skillApi } from "../../../api/modules/skill";
import type { AgentSummary, CopyAgentRequest } from "../../../api/types/agents";
import { useAgentStore } from "../../../stores/agentStore";
import { useAgents } from "./useAgents";
import { useAgentStatsBatch } from "./hooks/useAgentStatsBatch";
import { AgentTable, AgentCard, AgentModal, CopyAgentModal, AgentDetailDrawer } from "./components";
import { PageHeader } from "@/components/PageHeader";
import { UnderlineTabs } from "@/components/UnderlineTabs";
import { reorderAgents } from "./reorder";
import styles from "./index.module.less";

type FilterMode = "all" | "enabled" | "disabled";

export default function AgentsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const {
    agents,
    loading,
    deleteAgent,
    toggleAgent,
    pinAgent,
    loadAgents,
    setAgents,
  } = useAgents();
  const { selectedAgent, setSelectedAgent } = useAgentStore();
  const { statsMap } = useAgentStatsBatch();
  const [modalVisible, setModalVisible] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentSummary | null>(null);
  const [copyModalVisible, setCopyModalVisible] = useState(false);
  const [copyingAgent, setCopyingAgent] = useState<AgentSummary | null>(null);
  const [copying, setCopying] = useState(false);
  const [drawerAgent, setDrawerAgent] = useState<AgentSummary | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState("basic");

  const [reordering, setReordering] = useState(false);
  const [form] = Form.useForm();
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const installedSkillsRef = useRef<string[]>([]);
  const { message } = useAppMessage();

  // View mode: card or list
  const [viewMode, setViewMode] = useState<"card" | "list">("card");
  // Filter + search state (Phase 3)
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // ─── Derived data ──────────────────────────────────────────────
  const enabledCount = useMemo(
    () => agents.filter((a) => a.enabled).length,
    [agents],
  );
  const disabledCount = agents.length - enabledCount;

  const filteredAgents = useMemo(() => {
    let result = agents;
    // Filter by mode
    if (filterMode === "enabled") {
      result = result.filter((a) => a.enabled);
    } else if (filterMode === "disabled") {
      result = result.filter((a) => !a.enabled);
    }
    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (a) =>
          a.name?.toLowerCase().includes(q) ||
          a.id.toLowerCase().includes(q) ||
          a.description?.toLowerCase().includes(q),
      );
    }
    return result;
  }, [agents, filterMode, searchQuery]);

  // ─── Handlers ──────────────────────────────────────────────────
  const handleCreate = () => {
    setEditingAgent(null);
    form.resetFields();
    form.setFieldsValue({
      workspace_dir: "",
      active_model_provider: undefined,
      active_model_model: undefined,
    });
    setSelectedSkills([]);
    installedSkillsRef.current = [];
    setModalVisible(true);
  };

  const handleEdit = (agent: AgentSummary) => {
    setDrawerAgent(agent);
    setDrawerTab("basic");
    setDrawerOpen(true);
  };

  const handleConfigurePersona = (agent: AgentSummary) => {
    setDrawerAgent(agent);
    setDrawerTab("persona");
    setDrawerOpen(true);
  };

  const handleDelete = async (agentId: string) => {
    try {
      await deleteAgent(agentId);

      if (selectedAgent === agentId) {
        setSelectedAgent("default");
        message.info(t("agent.switchedToDefault"));
      }
    } catch {
      message.error(t("agent.deleteFailed"));
    }
  };

  const handleOpenCopy = (agent: AgentSummary) => {
    setCopyingAgent(agent);
    setCopyModalVisible(true);
  };

  const handleCopy = async (body: CopyAgentRequest) => {
    if (!copyingAgent) {
      return;
    }

    setCopying(true);
    try {
      const result = await agentsApi.copyAgent(copyingAgent.id, body);
      message.success(`${t("agent.copySuccess")} (ID: ${result.id})`);
      setCopyModalVisible(false);
      setCopyingAgent(null);
      await loadAgents();
    } catch (error: unknown) {
      console.error("Failed to copy agent:", error);
      message.error(
        error instanceof Error ? error.message : t("agent.copyFailed"),
      );
    } finally {
      setCopying(false);
    }
  };

  const handleToggle = async (agentId: string, currentEnabled: boolean) => {
    const newEnabled = !currentEnabled;
    try {
      await toggleAgent(agentId, newEnabled);

      if (!newEnabled && selectedAgent === agentId) {
        setSelectedAgent("default");
        message.info(t("agent.switchedToDefault"));
      }
    } catch {
      // Error already handled in hook
    }
  };

  const handlePin = async (agentId: string, currentPinned: boolean) => {
    try {
      await pinAgent(agentId, !currentPinned);
    } catch {
      // Error already handled in hook
    }
  };

  const handleChat = (agentId: string) => {
    setSelectedAgent(agentId);
    navigate("/chat");
  };

  const handleInstalledSkillsLoaded = useCallback((skills: string[]) => {
    installedSkillsRef.current = skills;
  }, []);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const workspaceRaw = values.workspace_dir;
      const workspace_dir =
        typeof workspaceRaw === "string"
          ? workspaceRaw.trim() || undefined
          : workspaceRaw;

      const providerId = values.active_model_provider;
      const modelId = values.active_model_model;
      const active_model =
        providerId && modelId
          ? { provider_id: providerId, model: modelId }
          : null;

      const { active_model_provider, active_model_model, ...rest } = values;
      const payload = { ...rest, workspace_dir, active_model };

      if (editingAgent) {
        const previousInstalledSkills = installedSkillsRef.current;
        const newSkills = selectedSkills.filter(
          (skill) => !previousInstalledSkills.includes(skill),
        );

        for (const skill of newSkills) {
          await skillApi.downloadSkillPoolSkill({
            skill_name: skill,
            targets: [{ workspace_id: editingAgent.id }],
          });
        }

        const newWorkspaceDir = workspace_dir?.trim();
        const oldWorkspaceDir = editingAgent.workspace_dir;
        if (
          newWorkspaceDir &&
          oldWorkspaceDir &&
          newWorkspaceDir !== oldWorkspaceDir
        ) {
          const migrateFiles = values.migrate_workspace !== false;
          await agentsApi.migrateWorkspace(editingAgent.id, {
            new_workspace_dir: newWorkspaceDir,
            migrate_files: migrateFiles,
          });
          payload.workspace_dir = newWorkspaceDir;
        }

        await agentsApi.updateAgent(editingAgent.id, payload);
        installedSkillsRef.current = [
          ...previousInstalledSkills,
          ...newSkills.filter(
            (skill) => !previousInstalledSkills.includes(skill),
          ),
        ];
        invalidateSkillCache({ agentId: editingAgent.id });
        message.success(t("agent.updateSuccess"));
      } else {
        const result = await agentsApi.createAgent({
          ...payload,
          language: i18n.language,
          skill_names: selectedSkills,
        });
        message.success(`${t("agent.createSuccess")} (ID: ${result.id})`);
      }

      setModalVisible(false);
      await loadAgents();
    } catch (error: any) {
      console.error("Failed to save agent:", error);
      if (editingAgent) {
        invalidateSkillCache({ agentId: editingAgent.id });
      }
      message.error(error.message || t("agent.saveFailed"));
    }
  };

  const handleReorder = async (activeId: string, overId: string) => {
    const nextAgents = reorderAgents(agents, activeId, overId);
    if (nextAgents === agents) {
      return;
    }

    const previousAgents = agents;
    setAgents(nextAgents);
    setReordering(true);

    try {
      await agentsApi.reorderAgents(nextAgents.map((agent) => agent.id));
      message.success(t("agent.reorderSuccess"));
    } catch (error) {
      console.error("Failed to reorder agents:", error);
      setAgents(previousAgents);
      message.error(t("agent.reorderFailed"));
    } finally {
      setReordering(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────
  return (
    <div className={styles.agentsPage}>
      <PageHeader
        parent={t("agent.parent")}
        current={t("agent.agents")}
        extra={
          <div className={styles.headerRight}>
            {/* Search box — capsule style */}
            <Input
              className={styles.searchBox}
              placeholder={t("agent.searchPlaceholder")}
              prefix={<SearchOutlined style={{ color: "var(--sd-muted)" }} />}
              allowClear
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleCreate}
            >
              {t("agent.create")}
            </Button>
          </div>
        }
      />

      {/* ─── Stats Cards (Task 3.1) ─────────────────────────────── */}
      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <span className={styles.statNum}>{agents.length}</span>
          <span className={styles.statLbl}>{t("agent.statsTotal")}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statNum}>{enabledCount}</span>
          <span className={styles.statLbl}>{t("agent.online")}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statNum}>{disabledCount}</span>
          <span className={styles.statLbl}>{t("agent.offline")}</span>
        </div>
        <div
          className={`${styles.statCard} ${styles.statCardCreate}`}
          onClick={handleCreate}
        >
          <PlusOutlined style={{ fontSize: 20 }} />
          <span className={styles.statLbl}>{t("agent.create")}</span>
        </div>
      </div>

      {/* ─── UnderlineTabs + ViewToggle (Task 3.2 + 3.5) ────────── */}
      <div className={styles.tabsRow}>
        <UnderlineTabs
          items={[
            { key: "all", label: t("agent.filterAll"), count: agents.length },
            {
              key: "enabled",
              label: t("agent.filterEnabled"),
              count: enabledCount,
            },
            {
              key: "disabled",
              label: t("agent.filterDisabled"),
              count: disabledCount,
            },
          ]}
          active={filterMode}
          onChange={(key) => setFilterMode(key as FilterMode)}
        />
        {/* ViewToggle moved here from PageHeader extra (Task 3.5) */}
        <div className={styles.viewToggle}>
          <button
            className={`${styles.viewToggleBtn} ${
              viewMode === "list" ? styles.viewToggleBtnActive : ""
            }`}
            onClick={() => setViewMode("list")}
            title={t("agent.listView")}
          >
            <UnorderedListOutlined />
          </button>
          <button
            className={`${styles.viewToggleBtn} ${
              viewMode === "card" ? styles.viewToggleBtnActive : ""
            }`}
            onClick={() => setViewMode("card")}
            title={t("agent.gridView")}
          >
            <AppstoreOutlined />
          </button>
        </div>
      </div>

      {/* ─── Card Grid / Table ──────────────────────────────────── */}
      {viewMode === "card" ? (
        <div className={styles.agentsGrid}>
          {filteredAgents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              stats={statsMap[agent.id]}
              isSelected={selectedAgent === agent.id}
              onSelect={setSelectedAgent}
              onEdit={handleEdit}
              onChat={handleChat}
              onDelete={handleDelete}
              onToggle={handleToggle}
              onConfigurePersona={handleConfigurePersona}
            />
          ))}
        </div>
      ) : (
        <Card className={styles.tableCard}>
          <AgentTable
            agents={filteredAgents}
            loading={loading || reordering}
            reordering={reordering}
            onEdit={handleEdit}
            onCopy={handleOpenCopy}
            onDelete={handleDelete}
            onToggle={handleToggle}
            onPin={handlePin}
            onReorder={handleReorder}
          />
        </Card>
      )}

      <AgentModal
        open={modalVisible}
        editingAgent={editingAgent}
        form={form}
        selectedSkills={selectedSkills}
        onSelectedSkillsChange={setSelectedSkills}
        onInstalledSkillsLoaded={handleInstalledSkillsLoaded}
        onSave={handleSubmit}
        onCancel={() => setModalVisible(false)}
      />

      <AgentDetailDrawer
        open={drawerOpen}
        agent={drawerAgent}
        initialTab={drawerTab}
        onClose={() => setDrawerOpen(false)}
        onUpdated={loadAgents}
      />
      <CopyAgentModal
        open={copyModalVisible}
        sourceAgent={copyingAgent}
        confirmLoading={copying}
        onOk={handleCopy}
        onCancel={() => {
          setCopyModalVisible(false);
          setCopyingAgent(null);
        }}
      />

    </div>
  );
}
