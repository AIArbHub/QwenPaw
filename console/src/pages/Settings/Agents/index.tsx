import { useState, useRef, useCallback, useMemo } from "react";
import { Card, Button, Form, Input, Tabs } from "antd";
import { useAppMessage } from "../../../hooks/useAppMessage";
import {
  PlusOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { agentsApi } from "../../../api/modules/agents";
import { invalidateSkillCache, skillApi } from "../../../api/modules/skill";
import type { AgentSummary, CopyAgentRequest } from "../../../api/types/agents";
import { useAgentStore } from "../../../stores/agentStore";
import { useAgents } from "./useAgents";
import { useAgentStatsBatch } from "./hooks/useAgentStatsBatch";
import CreateGroupChatModal from "../../../components/CreateGroupChatModal";
import {
  AgentTable,
  AgentCard,
  AgentModal,
  CopyAgentModal,
  AgentDetailDrawer,
} from "./components";
import { MAIL_DOMAIN_WHITELIST } from "./components/mailDomains";
import { PageHeader } from "@/components/PageHeader";
import { UnderlineTabs } from "@/components/UnderlineTabs";
import { reorderAgents } from "./reorder";
import { isHostAgent } from "../../../utils/hostAgent";
import styles from "./index.module.less";

type FilterMode = "all" | "enabled" | "disabled";
type AgentTypeMode = "single" | "group";

export default function AgentsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
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

  // 会话统计：仅对当前正在展示的智能体批量拉取，避免无谓请求。
  const agentIds = useMemo(
    () => (agents || []).map((a) => a.id),
    [agents],
  );
  const { statsMap } = useAgentStatsBatch(agentIds);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentSummary | null>(null);
  const [copyModalVisible, setCopyModalVisible] = useState(false);
  const [copyingAgent, setCopyingAgent] = useState<AgentSummary | null>(null);
  const [copying, setCopying] = useState(false);
  const [detailAgent, setDetailAgent] = useState<AgentSummary | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [form] = Form.useForm();
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const installedSkillsRef = useRef<string[]>([]);
  const { message } = useAppMessage();

  const [viewMode, setViewMode] = useState<"card" | "list">("card");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [typeMode, setTypeMode] = useState<AgentTypeMode>(() =>
    searchParams.get("type") === "group" ? "group" : "single",
  );
  const [searchQuery, setSearchQuery] = useState("");

  // 区分单个智能体与群聊（host）智能体：默认仅展示单个智能体，
  // 群聊保持入口（typeMode 切到 "group" 后显示）。
  const singleAgents = useMemo(
    () => (agents || []).filter((a) => !isHostAgent(a)),
    [agents],
  );
  const groupAgents = useMemo(
    () => (agents || []).filter((a) => isHostAgent(a)),
    [agents],
  );
  const typeCounts = useMemo(
    () => ({ single: singleAgents.length, group: groupAgents.length }),
    [singleAgents, groupAgents],
  );

  const enabledCount = useMemo(
    () => (typeMode === "single" ? singleAgents : groupAgents).filter((a) => a.enabled).length,
    [singleAgents, groupAgents, typeMode],
  );
  const typeBaseAgents = typeMode === "single" ? singleAgents : groupAgents;
  const disabledCount = typeBaseAgents.length - enabledCount;

  const filteredAgents = useMemo(() => {
    let result = typeBaseAgents;
    if (filterMode === "enabled") {
      result = result.filter((a) => a.enabled);
    } else if (filterMode === "disabled") {
      result = result.filter((a) => !a.enabled);
    }
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
  }, [typeBaseAgents, filterMode, searchQuery]);

  const handleCreate = () => {
    setEditingAgent(null);
    form.resetFields();
    form.setFieldsValue({
      workspace_dir: "",
      active_model_provider: undefined,
      active_model_model: undefined,
      mail_mode: "none",
      mail_credential: undefined,
      mail_push: undefined,
      backend: "aiarb",
    });
    setSelectedSkills([]);
    installedSkillsRef.current = [];
    setModalVisible(true);
  };

  const handleEdit = (agent: AgentSummary) => {
    setDetailAgent(agent);
    setDetailOpen(true);
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
        values.backend === "aiarb" && providerId && modelId
          ? { provider_id: providerId, model: modelId }
          : null;

      const {
        // Destructured only to keep them out of `rest` (already read
        // above via `values.*`); underscore + disable per project style.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        active_model_provider: _active_model_provider,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        active_model_model: _active_model_model,
        mail_mode,
        mail_credential,
        mail_push,
        ...rest
      } = values;
      // 0.2.0: the rules editor UI is hidden, so `mail_push.rules` is no
      // longer a registered form field and won't appear in validateFields()
      // results. Read the form store directly to pass legacy rules through
      // unchanged (hidden-but-preserved policy).
      const storedMailPush = form.getFieldValue("mail_push") as
        | {
            mode?: string;
            rules?: Array<{
              field?: string;
              contains?: string;
              action?: string;
              param?: string;
            }>;
            poll_interval_seconds?: number;
            access_control_enabled?: boolean;
          }
        | undefined;
      const pushMode = mail_push?.mode ?? storedMailPush?.mode ?? "off";
      // Preserve existing rules as-is regardless of mode so editing an old
      // agent never wipes its rule config on the backend.
      const pushRules = (
        (mail_push?.rules ?? storedMailPush?.rules ?? []) as Array<{
          field?: string;
          contains?: string;
          action?: string;
          param?: string;
        }>
      ).map((rule) => ({
        // Never submit the legacy "subject" value.
        field: rule?.field === "subject" ? "content" : rule?.field || "from",
        contains: (rule?.contains ?? "").trim(),
        action: rule?.action || "notify",
        param: (rule?.param ?? "").trim(),
      }));
      const pollIntervalSeconds =
        mail_push?.poll_interval_seconds ??
        storedMailPush?.poll_interval_seconds;
      // Explicitly persist the access-control switch; access control is
      // opt-in, so a missing field falls back to disabled.
      const accessControlEnabled =
        mail_push?.access_control_enabled ??
        storedMailPush?.access_control_enabled ??
        false;
      const push =
        pushMode === "off" && pushRules.length === 0
          ? null
          : {
              mode: pushMode,
              rules: pushRules,
              ...(pollIntervalSeconds != null
                ? { poll_interval_seconds: pollIntervalSeconds }
                : {}),
              access_control_enabled: accessControlEnabled,
            };
      // Mail is only supported for the aiarb backend; never submit
      // mail config for third-party backends (the server rejects it).
      const mail =
        values.backend === "aiarb" &&
        (mail_mode === "personal" || mail_mode === "dedicated")
          ? {
              is_new_account: mail_mode === "dedicated",
              credential: {
                name: (mail_credential?.name ?? "").trim(),
                domain: mail_credential?.domain || "163.com",
                // Whitelisted domains must use an empty provider; custom
                // enterprise domains carry the selected provider.
                provider: MAIL_DOMAIN_WHITELIST.includes(
                  mail_credential?.domain || "163.com",
                )
                  ? ""
                  : mail_credential?.provider || "",
                auth_code: mail_credential?.auth_code || "",
              },
              ...(push ? { push } : {}),
            }
          : null;
      const payload = { ...rest, workspace_dir, active_model, mail };

      if (editingAgent) {
        const previousInstalledSkills = installedSkillsRef.current;
        const newSkills =
          values.backend === "aiarb"
            ? selectedSkills.filter(
                (skill) => !previousInstalledSkills.includes(skill),
              )
            : [];

        for (const skill of newSkills) {
          await skillApi.downloadSkillPoolSkill({
            skill_name: skill,
            targets: [{ workspace_id: editingAgent.id }],
          });
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
          skill_names: values.backend === "aiarb" ? selectedSkills : [],
        });
        message.success(`${t("agent.createSuccess")} (ID: ${result.id})`);
      }

      setModalVisible(false);
      await loadAgents();
    } catch (error: unknown) {
      console.error("Failed to save agent:", error);
      if (editingAgent) {
        invalidateSkillCache({ agentId: editingAgent.id });
      }
      message.error(
        error instanceof Error ? error.message : t("agent.saveFailed"),
      );
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

  return (
    <div className={styles.agentsPage}>
      <PageHeader
        parent={t("agent.parent")}
        current={t("agent.agents")}
        extra={
          <div className={styles.headerRight}>
            <Input
              className={styles.searchBox}
              placeholder={t("agent.searchPlaceholder")}
              prefix={
                <SearchOutlined style={{ color: "rgba(20,20,19,0.45)" }} />
              }
              allowClear
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={
                typeMode === "single" ? handleCreate : () => setCreateGroupOpen(true)
              }
              title={
                typeMode === "single"
                  ? t("agent.createTitle", "创建新智能体")
                  : t("hostModal.title", "新建群聊")
              }
            >
              {typeMode === "single"
                ? t("agent.create", "创建智能体")
                : t("hostModal.create", "创建群聊")}
            </Button>
          </div>
        }
      />

      <div className={styles.pageTabs}>
        <Tabs
          activeKey={typeMode}
          onChange={(key) => {
            const next = key as AgentTypeMode;
            setTypeMode(next);
            const params = new URLSearchParams(searchParams);
            params.set("type", next);
            setSearchParams(params, { replace: true });
          }}
          items={[
            {
              key: "single",
              label: `${t("agent.typeSingle")} (${typeCounts.single})`,
            },
            {
              key: "group",
              label: `${t("agent.typeGroup")} (${typeCounts.group})`,
            },
          ]}
        />
      </div>

      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <span className={styles.statNum}>{typeBaseAgents.length}</span>
          <span className={styles.statLbl}>{t("agent.statsTotal")}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statNum}>{enabledCount}</span>
          <span className={styles.statLbl}>{t("agent.filterEnabled")}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statNum}>{disabledCount}</span>
          <span className={styles.statLbl}>{t("agent.filterDisabled")}</span>
        </div>
      </div>

      <div className={styles.tabsRow}>
        <UnderlineTabs
          items={[
            { key: "all", label: t("agent.filterAll"), count: typeBaseAgents.length },
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
              onPin={handlePin}
              onCopy={handleOpenCopy}
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

      <CreateGroupChatModal
        open={createGroupOpen}
        onCancel={() => setCreateGroupOpen(false)}
        navigate={navigate}
        onCreated={() => {
          setCreateGroupOpen(false);
          void loadAgents();
        }}
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

      <AgentDetailDrawer
        open={detailOpen}
        agent={detailAgent}
        onClose={() => setDetailOpen(false)}
        onUpdated={loadAgents}
      />
    </div>
  );
}
