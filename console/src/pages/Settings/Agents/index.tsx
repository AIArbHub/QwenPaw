import { useState, useMemo } from "react";
import { Card, Button, Form, Input, Tabs } from "antd";
import {
  Plus as PlusOutlined,
  LayoutGrid as AppstoreOutlined,
  List as UnorderedListOutlined,
  Search as SearchOutlined,
} from "lucide-react";
import { useAppMessage } from "../../../hooks/useAppMessage";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { agentsApi } from "../../../api/modules/agents";
import { invalidateSkillCache } from "../../../api/modules/skill";
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
    () =>
      (typeMode === "single" ? singleAgents : groupAgents).filter(
        (a) => a.enabled,
      ).length,
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

  const handleHistory = (agentId: string) => {
    setSelectedAgent(agentId);
    sessionStorage.setItem("aiarb_pending_open_history", "1");
    navigate("/chat");
  };

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
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        active_model_provider: _active_model_provider,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        active_model_model: _active_model_model,
        mail_mode,
        mail_credential,
        mail_push,
        ...rest
      } = values;
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
      const pushRules = (
        (mail_push?.rules ?? storedMailPush?.rules ?? []) as Array<{
          field?: string;
          contains?: string;
          action?: string;
          param?: string;
        }>
      ).map((rule) => ({
        field: rule?.field === "subject" ? "content" : rule?.field || "from",
        contains: (rule?.contains ?? "").trim(),
        action: rule?.action || "notify",
        param: (rule?.param ?? "").trim(),
      }));
      const pollIntervalSeconds =
        mail_push?.poll_interval_seconds ??
        storedMailPush?.poll_interval_seconds;
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
      const mail =
        values.backend === "aiarb" &&
        (mail_mode === "personal" || mail_mode === "dedicated")
          ? {
              is_new_account: mail_mode === "dedicated",
              credential: {
                name: (mail_credential?.name ?? "").trim(),
                domain: mail_credential?.domain || "163.com",
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
        await agentsApi.updateAgent(editingAgent.id, payload);
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
        current={t("agent.agents")}
        extra={
          <div className={styles.headerRight}>
            <Input
              className={styles.searchBox}
              placeholder={t("agent.searchPlaceholder")}
              prefix={<SearchOutlined size={14} />}
              allowClear
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Button
              type="primary"
              icon={<PlusOutlined size="1em" />}
              onClick={
                typeMode === "single"
                  ? handleCreate
                  : () => setCreateGroupOpen(true)
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
            {
              key: "all",
              label: t("agent.filterAll"),
              count: typeBaseAgents.length,
            },
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
            <UnorderedListOutlined size={16} />
          </button>
          <button
            className={`${styles.viewToggleBtn} ${
              viewMode === "card" ? styles.viewToggleBtnActive : ""
            }`}
            onClick={() => setViewMode("card")}
            title={t("agent.gridView")}
          >
            <AppstoreOutlined size={16} />
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
              onHistory={handleHistory}
              onDelete={handleDelete}
              onToggle={handleToggle}
              onPin={handlePin}
              onCopy={handleOpenCopy}
              onFilterByGroup={(group) => setSearchQuery(group)}
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
