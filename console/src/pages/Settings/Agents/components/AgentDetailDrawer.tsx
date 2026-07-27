/**
 * AgentDetailDrawer — Full-width drawer for detailed agent configuration.
 *
 * Replaces the simple AgentModal for "edit" flows. Provides tabs for:
 * - Basic info (name, description, avatar, model, workspace)
 * - Persona config (embedded PersonaVisualEditor)
 * - Skills (skill picker)
 * - SOP (流程引擎/状态机 SkillCard list + navigation)
 * - Knowledge Base (文档列表 + navigation)
 *
 * The original AgentModal is kept for quick-create flows.
 */
import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Drawer,
  Tabs,
  Form,
  Input,
  Button,
  Select,
  Space,
  Typography,
  Empty,
  Spin,
  Checkbox,
  Switch,
  Modal,
  message as antMessage,
} from "antd";
import {
  UploadOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  CheckOutlined,
  RobotOutlined,
  HeartOutlined,
  ThunderboltOutlined,
  FolderViewOutlined,
  ShopOutlined,
  SettingOutlined,
  ApartmentOutlined,
  BookOutlined,
  ArrowRightOutlined,
  PlayCircleOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { browseFolder } from "@/utils/browseFolder";
import type { AgentSummary } from "@/api/types/agents";
import type { ProviderInfo } from "@/api/types/provider";
import { getAgentDisplayName } from "@/utils/agentDisplayName";
import type { PoolSkillSpec, SkillSpec } from "@/api/types/skill";
import type { WorkDirConfig, MarkdownFile } from "@/api/types/workspace";
import { invalidateSkillCache, skillApi } from "@/api/modules/skill";
import { providerApi } from "@/api/modules/provider";
import { agentsApi } from "@/api/modules/agents";
import { workspaceApi } from "@/api/modules/workspace";
import sopApi, { type SkillCard as SopSkillCard } from "@/api/modules/sop";
import kbApi, { type KnowledgeDocumentSummary } from "@/api/modules/kb";
import { providerIcon } from "../../Models/components/providerIcon";
import { PersonaVisualEditor } from "@/pages/Agent/Workspace/components/PersonaVisualEditor";
import { ImportHubModal } from "@/pages/Agent/Skills/components";
import {
  ModeSwitcher,
  getStoredEditMode,
  storeEditMode,
  type EditMode,
} from "@/pages/Agent/Workspace/components/ModeSwitcher";
import styles from "../index.module.less";
import { CoreConfigExpertPanel } from "./CoreConfigExpertPanel";

const DEFAULT_AVATAR = "/aiarb-avatar.svg";
const { Text } = Typography;

interface EligibleProvider {
  id: string;
  name: string;
  models: Array<{ id: string; name: string }>;
}

interface AgentDetailDrawerProps {
  open: boolean;
  agent: AgentSummary | null;
  initialTab?: string;
  onClose: () => void;
  onUpdated: () => void;
}

export function AgentDetailDrawer({
  open,
  agent,
  initialTab,
  onClose,
  onUpdated,
}: AgentDetailDrawerProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [activeTab, setActiveTab] = useState("basic");
  const [poolSkills, setPoolSkills] = useState<PoolSkillSpec[]>([]);
  const [installedSkills, setInstalledSkills] = useState<string[]>([]);
  const [installedSkillDetails, setInstalledSkillDetails] = useState<SkillSpec[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [hubImportOpen, setHubImportOpen] = useState(false);
  const [hubImporting, setHubImporting] = useState(false);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [saving, setSaving] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const installedSkillsRef = useRef<string[]>([]);

  // Work directory state
  const [workDirConfig, setWorkDirConfig] = useState<WorkDirConfig | null>(null);
  const [workDirSaving, setWorkDirSaving] = useState(false);

  // SOP state
  const [sopSkills, setSopSkills] = useState<SopSkillCard[]>([]);
  const [sopLoading, setSopLoading] = useState(false);

  // Knowledge base state
  const [kbDocuments, setKbDocuments] = useState<KnowledgeDocumentSummary[]>([]);
  const [kbLoading, setKbLoading] = useState(false);

  // Persona edit mode (visual / expert) and core config files state
  const [personaMode, setPersonaMode] = useState<EditMode>(getStoredEditMode());
  const [coreConfigFiles, setCoreConfigFiles] = useState<MarkdownFile[]>([]);
  const [enabledFiles, setEnabledFiles] = useState<string[]>([]);
  const [selectedCoreFile, setSelectedCoreFile] = useState<MarkdownFile | null>(null);
  const [coreFileContent, setCoreFileContent] = useState("");
  const [coreOriginalContent, setCoreOriginalContent] = useState("");
  const [coreLoading, setCoreLoading] = useState(false);

  const selectedProviderId = Form.useWatch("active_model_provider", form);
  const selectedModelId = Form.useWatch("active_model_model", form);

  const eligibleProviders: EligibleProvider[] = useMemo(() => {
    return providers
      .filter((p) => {
        const hasModels =
          (p.models?.length ?? 0) + (p.extra_models?.length ?? 0) > 0;
        if (!hasModels) return false;
        if (p.require_api_key === false) return !!p.base_url;
        if (p.is_custom) return !!p.base_url;
        if (p.require_api_key ?? true) return !!p.api_key;
        return true;
      })
      .map((p) => ({
        id: p.id,
        name: p.name,
        models: [...(p.models ?? []), ...(p.extra_models ?? [])],
      }));
  }, [providers]);

  const availableModels = useMemo(() => {
    if (!selectedProviderId) return [];
    const provider = eligibleProviders.find((p) => p.id === selectedProviderId);
    return provider?.models ?? [];
  }, [selectedProviderId, eligibleProviders]);

  // Load agent config when drawer opens
  useEffect(() => {
    if (!open || !agent) return;

    setActiveTab(initialTab || "basic");
    setAvatarUrl(agent.avatar || null);

    // Load agent config
    agentsApi
      .getAgent(agent.id)
      .then((config) => {
        form.setFieldsValue({
          ...config,
          active_model_provider: config.active_model?.provider_id || undefined,
          active_model_model: config.active_model?.model || undefined,
        });
      })
      .catch((err) => {
        console.error("Failed to load agent config:", err);
        antMessage.error(t("agent.loadConfigFailed"));
      });

    // Load providers
    setLoadingProviders(true);
    providerApi
      .listProviders()
      .then((data) => {
        if (Array.isArray(data)) setProviders(data);
      })
      .catch((err) => console.error("Failed to load providers:", err))
      .finally(() => setLoadingProviders(false));

    // Load skills
    setLoadingSkills(true);
    const fetchPool = skillApi.listSkillPoolSkills();
    const fetchInstalled = skillApi.listSkills(agent.id);

    Promise.all([fetchPool, fetchInstalled])
      .then(([pool, workspaceSkills]) => {
        const poolSkillNames = new Set(pool.map((skill) => skill.name));
        // Store ALL installed skills (including those from hub/market, not just pool)
        setInstalledSkillDetails(workspaceSkills);
        const installed = workspaceSkills
          .filter((skill) => poolSkillNames.has(skill.name))
          .map((skill) => skill.name);

        setPoolSkills(pool);
        setInstalledSkills(installed);
        installedSkillsRef.current = installed;
        setSelectedSkills(installed);
      })
      .finally(() => setLoadingSkills(false));

    // Load work dir config
    workspaceApi
      .getWorkDirConfig(agent.id)
      .then((config) => setWorkDirConfig(config))
      .catch((err) =>
        console.error("Failed to load work dir config:", err),
      );

    // Load core config files
    loadCoreConfigFiles();

    // Load SOP skills
    setSopLoading(true);
    sopApi
      .listSkills()
      .then((res) => setSopSkills(res.skills || []))
      .catch((err) => console.error("Failed to load SOP skills:", err))
      .finally(() => setSopLoading(false));

    // Load KB documents
    setKbLoading(true);
    kbApi
      .listDocuments()
      .then((res) => setKbDocuments(res.documents || []))
      .catch((err) => console.error("Failed to load KB documents:", err))
      .finally(() => setKbLoading(false));
  }, [open, agent, form, t, initialTab]);

  // Load core config files (SOUL.md, PROFILE.md, etc.) for expert mode
  const loadCoreConfigFiles = async () => {
    if (!agent) return;
    setCoreLoading(true);
    try {
      const [fileList, enabledList] = await Promise.all([
        workspaceApi.listCoreConfigFiles(agent.id),
        workspaceApi.getSystemPromptFiles(agent.id),
      ]);
      setCoreConfigFiles(fileList as unknown as MarkdownFile[]);
      setEnabledFiles(enabledList || []);
    } catch (err) {
      console.error("Failed to load core config files:", err);
    } finally {
      setCoreLoading(false);
    }
  };

  // Handle clicking a core config file in expert mode
  const handleCoreFileClick = async (file: MarkdownFile) => {
    if (!agent) return;
    setSelectedCoreFile(file);
    setCoreLoading(true);
    try {
      const data = await workspaceApi.loadFile(file.filename, agent.id);
      setCoreFileContent(data.content);
      setCoreOriginalContent(data.content);
    } catch (err) {
      console.error("Failed to load file:", err);
      antMessage.error(t("workspace.loadFileError"));
    } finally {
      setCoreLoading(false);
    }
  };

  // Save core config file
  const handleCoreFileSave = async () => {
    if (!selectedCoreFile || !agent) return;
    setCoreLoading(true);
    try {
      await workspaceApi.saveFile(
        selectedCoreFile.filename,
        coreFileContent,
        agent.id,
      );
      setCoreOriginalContent(coreFileContent);
      antMessage.success(t("common.saveSuccess"));
    } catch (err) {
      console.error("Failed to save file:", err);
      antMessage.error(t("common.saveFailed"));
    } finally {
      setCoreLoading(false);
    }
  };

  // Toggle file enabled/disabled in system prompt
  const handleToggleFileEnabled = async (filename: string) => {
    if (!agent) return;
    const newEnabled = enabledFiles.includes(filename)
      ? enabledFiles.filter((f) => f !== filename)
      : [...enabledFiles, filename];
    setEnabledFiles(newEnabled);
    try {
      await workspaceApi.setSystemPromptFiles(newEnabled, agent.id);
    } catch (err) {
      console.error("Failed to toggle file:", err);
      // Revert on failure
      setEnabledFiles(enabledFiles);
      antMessage.error(t("workspace.toggleFileFailed"));
    }
  };

  // Reorder files via drag-and-drop
  const handleReorderFiles = async (newOrder: string[]) => {
    if (!agent) return;
    const oldOrder = [...enabledFiles];
    setEnabledFiles(newOrder);
    try {
      await workspaceApi.setSystemPromptFiles(newOrder, agent.id);
    } catch (err) {
      console.error("Failed to reorder files:", err);
      setEnabledFiles(oldOrder);
      antMessage.error(t("workspace.reorderFailed"));
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !agent) return;

    const allowedTypes = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];
    if (!allowedTypes.includes(file.type)) {
      antMessage.error(t("agent.avatarTypeInvalid"));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      antMessage.error(t("agent.avatarTooLarge"));
      return;
    }

    setUploadingAvatar(true);
    try {
      const result = await agentsApi.uploadAvatar(agent.id, file);
      setAvatarUrl(result.avatar);
      antMessage.success(t("agent.avatarUploadSuccess"));
    } catch (error: any) {
      antMessage.error(error.message || t("agent.avatarUploadFailed"));
    } finally {
      setUploadingAvatar(false);
      if (avatarInputRef.current) {
        avatarInputRef.current.value = "";
      }
    }
  };

  const handleAvatarDelete = async () => {
    if (!agent) return;
    try {
      await agentsApi.deleteAvatar(agent.id);
      setAvatarUrl(null);
      antMessage.success(t("agent.avatarDeleteSuccess"));
    } catch (error: any) {
      antMessage.error(error.message || t("agent.avatarDeleteFailed"));
    }
  };

  const handleProviderChange = (providerId: string) => {
    form.setFieldsValue({
      active_model_provider: providerId,
      active_model_model: undefined,
    });
  };

  const handleClearModel = () => {
    form.setFieldsValue({
      active_model_provider: undefined,
      active_model_model: undefined,
    });
  };

  const toggleSkill = (name: string) => {
    const isInstalled = agent && installedSkills.includes(name);
    if (isInstalled) return;

    if (selectedSkills.includes(name)) {
      setSelectedSkills(selectedSkills.filter((s) => s !== name));
    } else {
      setSelectedSkills([...selectedSkills, name]);
    }
  };

  const handleSave = async () => {
    if (!agent) return;
    setSaving(true);
    try {
      const values = await form.validateFields();
      const providerId = values.active_model_provider;
      const modelId = values.active_model_model;
      const active_model =
        providerId && modelId ? { provider_id: providerId, model: modelId } : null;
      const { active_model_provider, active_model_model, ...rest } = values;
      const payload = { ...rest, active_model };

      // Handle new skills
      const previousInstalledSkills = installedSkillsRef.current;
      const newSkills = selectedSkills.filter(
        (skill) => !previousInstalledSkills.includes(skill),
      );

      for (const skill of newSkills) {
        await skillApi.downloadSkillPoolSkill({
          skill_name: skill,
          targets: [{ workspace_id: agent.id }],
        });
      }

      // Handle workspace dir migration
      const newWorkspaceDir = values.workspace_dir?.trim();
      const oldWorkspaceDir = agent.workspace_dir;
      if (
        newWorkspaceDir &&
        oldWorkspaceDir &&
        newWorkspaceDir !== oldWorkspaceDir
      ) {
        const migrateFiles = values.migrate_workspace !== false;
        await agentsApi.migrateWorkspace(agent.id, {
          new_workspace_dir: newWorkspaceDir,
          migrate_files: migrateFiles,
        });
        payload.workspace_dir = newWorkspaceDir;
      }

      await agentsApi.updateAgent(agent.id, payload);

      // Invalidate skill cache so the installed skills reflect correctly on re-open
      if (newSkills.length > 0) {
        invalidateSkillCache({ agentId: agent.id });
      }

      antMessage.success(t("agent.updateSuccess"));
      onUpdated();
      onClose();
    } catch (error: any) {
      console.error("Failed to save agent:", error);
      // Invalidate cache on error too, in case partial installs occurred
      invalidateSkillCache({ agentId: agent.id });
      antMessage.error(error.message || t("agent.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleSelectAll = () => {
    onSelectedSkillsChange(poolSkills.map((s) => s.name));
  };

  const handleSelectBuiltin = () => {
    const builtinNames = poolSkills
      .filter((s) => s.source === "builtin")
      .map((s) => s.name);
    setSelectedSkills(
      Array.from(new Set([...installedSkills, ...builtinNames])),
    );
  };

  const handleSelectNone = () => {
    setSelectedSkills(agent ? [...installedSkills] : []);
  };

  const onSelectedSkillsChange = useCallback((skills: string[]) => {
    setSelectedSkills(skills);
  }, []);

  // Navigate to the full Agent Skills page for advanced management
  const handleNavigateToSkillsPage = () => {
    if (!agent) return;
    onClose();
    navigate(`/skills?tab=installed&agent=${encodeURIComponent(agent.id)}`);
  };

  // Install a skill from the hub/market to this agent
  const handleHubImport = async (url: string, targetName?: string) => {
    if (!agent) return;
    setHubImporting(true);
    try {
      const task = await skillApi.startHubSkillInstall(
        {
          bundle_url: url,
          enable: true,
          target_name: targetName,
        },
        agent.id,
      );
      // Poll for completion
      let completed = false;
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const status = await skillApi.getHubSkillInstallStatus(
          task.task_id,
          agent.id,
        );
        if (status.status === "completed") {
          completed = true;
          break;
        }
        if (status.status === "failed" || status.status === "cancelled") {
          throw new Error(
            status.error || t("skills.importFailed"),
          );
        }
      }
      if (!completed) {
        antMessage.warning(t("skills.importTimeout"));
      } else {
        antMessage.success(t("skills.importSuccess"));
        // Refresh installed skills
        const workspaceSkills = await skillApi.listSkills(agent.id);
        setInstalledSkillDetails(workspaceSkills);
        const poolSkillNames = new Set(poolSkills.map((s) => s.name));
        const installed = workspaceSkills
          .filter((s) => poolSkillNames.has(s.name))
          .map((s) => s.name);
        setInstalledSkills(installed);
        installedSkillsRef.current = installed;
        setSelectedSkills(installed);
      }
      setHubImportOpen(false);
    } catch (error: any) {
      antMessage.error(error.message || t("skills.importFailed"));
    } finally {
      setHubImporting(false);
    }
  };

  // Toggle an installed skill's enabled state
  const handleToggleSkillEnabled = async (skillName: string) => {
    if (!agent) return;
    const skill = installedSkillDetails.find((s) => s.name === skillName);
    if (!skill) return;
    try {
      if (skill.enabled) {
        await skillApi.disableSkill(skillName);
      } else {
        await skillApi.enableSkill(skillName);
      }
      // Update local state
      setInstalledSkillDetails((prev) =>
        prev.map((s) =>
          s.name === skillName ? { ...s, enabled: !s.enabled } : s,
        ),
      );
      antMessage.success(t("common.operationSuccess"));
    } catch (error: any) {
      antMessage.error(error.message || t("common.operationFailed"));
    }
  };

  // Remove a skill from the agent's workspace
  const handleRemoveSkill = async (skillName: string) => {
    if (!agent) return;
    Modal.confirm({
      title: t("skills.confirmDelete"),
      content: t("skills.confirmDeleteDesc", { name: skillName }),
      okText: t("common.delete"),
      okButtonProps: { danger: true },
      cancelText: t("common.cancel"),
      onOk: async () => {
        try {
          await skillApi.deleteSkill(skillName);
          setInstalledSkillDetails((prev) =>
            prev.filter((s) => s.name !== skillName),
          );
          setInstalledSkills((prev) => prev.filter((n) => n !== skillName));
          installedSkillsRef.current = installedSkillsRef.current.filter(
            (n) => n !== skillName,
          );
          setSelectedSkills((prev) => prev.filter((n) => n !== skillName));
          antMessage.success(t("skills.deleteSuccess"));
        } catch (error: any) {
          antMessage.error(error.message || t("skills.deleteFailed"));
        }
      },
    });
  };

  const handleWorkDirToggle = async (enabled: boolean) => {
    if (!agent) return;
    setWorkDirSaving(true);
    try {
      const updated = await workspaceApi.updateWorkDirConfig(
        { enabled },
        agent.id,
      );
      setWorkDirConfig(updated);
      antMessage.success(
        enabled
          ? t("agent.workDirEnabled")
          : t("agent.workDirDisabled"),
      );
    } catch (err: any) {
      antMessage.error(err.message || t("agent.workDirSaveFailed"));
    } finally {
      setWorkDirSaving(false);
    }
  };

  const handleWorkDirBaseDirSelect = async () => {
    if (!agent) return;
    const result = await browseFolder(workDirConfig?.base_dir || undefined);
    if (result.path) {
      setWorkDirSaving(true);
      try {
        const updated = await workspaceApi.updateWorkDirConfig(
          { base_dir: result.path },
          agent.id,
        );
        setWorkDirConfig(updated);
        antMessage.success(t("agent.workDirBaseDirUpdated"));
      } catch (err: any) {
        antMessage.error(err.message || t("agent.workDirSaveFailed"));
      } finally {
        setWorkDirSaving(false);
      }
    }
  };

  const handleWorkDirConfigChange = async (
    field: "session_isolation" | "subfolder_pattern",
    value: boolean | string,
  ) => {
    if (!agent) return;
    setWorkDirSaving(true);
    try {
      const updated = await workspaceApi.updateWorkDirConfig(
        { [field]: value } as Partial<WorkDirConfig>,
        agent.id,
      );
      setWorkDirConfig(updated);
    } catch (err: any) {
      antMessage.error(err.message || t("agent.workDirSaveFailed"));
    } finally {
      setWorkDirSaving(false);
    }
  };

  const tabs = [
    {
      key: "basic",
      label: (
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <RobotOutlined />
          {t("agent.basicInfo")}
        </span>
      ),
      children: (
        <Form form={form} layout="vertical" autoComplete="off">
          <Form.Item name="id" label={t("agent.id")}>
            <Input disabled />
          </Form.Item>
          <Form.Item
            name="name"
            label={t("agent.name")}
            rules={[{ required: true, message: t("agent.nameRequired") }]}
          >
            <Input placeholder={t("agent.namePlaceholder")} />
          </Form.Item>
          <Form.Item name="description" label={t("agent.description")}>
            <Input.TextArea
              placeholder={t("agent.descriptionPlaceholder")}
              rows={3}
            />
          </Form.Item>
          <Form.Item label={t("agent.avatar")}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <img
                src={avatarUrl || DEFAULT_AVATAR}
                alt=""
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  objectFit: "cover",
                  border: "1px solid #d9d9d9",
                }}
              />
              <Space>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                  style={{ display: "none" }}
                  onChange={handleAvatarUpload}
                />
                <Button
                  icon={<UploadOutlined />}
                  loading={uploadingAvatar}
                  onClick={() => avatarInputRef.current?.click()}
                  size="small"
                >
                  {t("agent.avatarUpload")}
                </Button>
                {avatarUrl && (
                  <Button
                    icon={<DeleteOutlined />}
                    onClick={handleAvatarDelete}
                    size="small"
                    danger
                  >
                    {t("agent.avatarDelete")}
                  </Button>
                )}
              </Space>
            </div>
            <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: "block" }}>
              {t("agent.avatarHelp")}
            </Text>
          </Form.Item>
          <Form.Item name="active_model_provider" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="active_model_model" hidden>
            <Input />
          </Form.Item>
          <Form.Item label={t("agent.model")} help={t("agent.modelHelp")}>
            <Space.Compact style={{ width: "100%" }}>
              <Select
                value={selectedProviderId || undefined}
                onChange={handleProviderChange}
                placeholder={t("agent.modelPlaceholder")}
                allowClear
                onClear={handleClearModel}
                loading={loadingProviders}
                style={{ width: "45%", gap: "8px" }}
                showSearch
                optionFilterProp="label"
                options={eligibleProviders.map((p) => ({
                  value: p.id,
                  label: p.name,
                }))}
                optionRender={({ value }) => {
                  const p = eligibleProviders.find((ep) => ep.id === value);
                  if (!p) return value;
                  return (
                    <Space size={6}>
                      <img
                        src={providerIcon(p.id)}
                        alt=""
                        style={{ width: 16, height: 16 }}
                      />
                      <span>{p.name}</span>
                    </Space>
                  );
                }}
                notFoundContent={
                  loadingProviders ? <Spin size="small" /> : t("agent.noConfiguredModels")
                }
              />
              <Select
                value={selectedModelId || undefined}
                onChange={(modelId) =>
                  form.setFieldsValue({ active_model_model: modelId })
                }
                placeholder={selectedProviderId ? t("models.model") : t("agent.modelPlaceholder")}
                disabled={!selectedProviderId}
                style={{ width: "55%" }}
                showSearch
                optionFilterProp="label"
                options={availableModels.map((m) => ({
                  value: m.id,
                  label: m.name || m.id,
                }))}
              />
            </Space.Compact>
          </Form.Item>
          <Form.Item
            name="workspace_dir"
            label={t("agent.workspace")}
          >
            <Space.Compact style={{ width: "100%" }}>
              <Input placeholder="~/.aiarb/workspaces/my-agent" style={{ flex: 1 }} />
              <Button
                icon={<FolderOpenOutlined />}
                onClick={async () => {
                  const result = await browseFolder();
                  if (result.path) {
                    form.setFieldsValue({ workspace_dir: result.path });
                  }
                }}
              >
                {t("agent.browseFolder")}
              </Button>
            </Space.Compact>
          </Form.Item>
          <Form.Item name="migrate_workspace" valuePropName="checked">
            <Checkbox>{t("agent.migrateWorkspace")}</Checkbox>
          </Form.Item>

          {/* Work Directory Configuration */}
          <div
            style={{
              marginTop: 16,
              padding: "16px",
              border: "1px solid #f0f0f0",
              borderRadius: 8,
              background: "#fafafa",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <Space>
                <FolderViewOutlined />
                <Text strong>{t("agent.workDirTitle")}</Text>
              </Space>
              <Switch
                checked={workDirConfig?.enabled ?? false}
                loading={workDirSaving}
                onChange={handleWorkDirToggle}
                size="small"
              />
            </div>
            <Text
              type="secondary"
              style={{ fontSize: 12, display: "block", marginBottom: 12 }}
            >
              {t("agent.workDirDescription")}
            </Text>
            {workDirConfig?.enabled && (
              <>
                <Form.Item
                  label={t("agent.workDirBaseDir")}
                  style={{ marginBottom: 8 }}
                >
                  <Space.Compact style={{ width: "100%" }}>
                    <Input
                      value={workDirConfig.base_dir || ""}
                      placeholder={t("agent.workDirBaseDirPlaceholder")}
                      readOnly
                      style={{ flex: 1 }}
                    />
                    <Button
                      icon={<FolderOpenOutlined />}
                      onClick={handleWorkDirBaseDirSelect}
                      loading={workDirSaving}
                    >
                      {t("agent.browseFolder")}
                    </Button>
                  </Space.Compact>
                </Form.Item>
                <Form.Item
                  label={t("agent.workDirSubfolderPattern")}
                  style={{ marginBottom: 8 }}
                >
                  <Input
                    value={workDirConfig.subfolder_pattern}
                    placeholder="{agent_name}_{date}"
                    onChange={(e) =>
                      setWorkDirConfig({
                        ...workDirConfig,
                        subfolder_pattern: e.target.value,
                      })
                    }
                    onBlur={(e) =>
                      handleWorkDirConfigChange(
                        "subfolder_pattern",
                        e.target.value,
                      )
                    }
                  />
                  <Text
                    type="secondary"
                    style={{ fontSize: 11, display: "block" }}
                  >
                    {t("agent.workDirPatternHelp")}
                  </Text>
                </Form.Item>
                <Form.Item
                  label={t("agent.workDirSessionIsolation")}
                  style={{ marginBottom: 0 }}
                >
                  <Switch
                    checked={workDirConfig.session_isolation}
                    onChange={(v) =>
                      handleWorkDirConfigChange("session_isolation", v)
                    }
                    size="small"
                  />
                  <Text
                    type="secondary"
                    style={{ fontSize: 12, marginLeft: 8 }}
                  >
                    {t("agent.workDirSessionIsolationHelp")}
                  </Text>
                </Form.Item>
                {workDirConfig.resolved_preview && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: "8px 12px",
                      background: "#f6ffed",
                      border: "1px solid #b7eb8f",
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  >
                    <Text type="secondary">
                      {t("agent.workDirResolvedPreview")}:
                    </Text>{" "}
                    <Text code style={{ fontSize: 11 }}>
                      {workDirConfig.resolved_preview}
                    </Text>
                  </div>
                )}
              </>
            )}
          </div>
        </Form>
      ),
    },
    {
      key: "persona",
      label: (
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <HeartOutlined />
          {t("persona.soulTitle")}
        </span>
      ),
      children: (
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginBottom: 12,
            }}
          >
            <ModeSwitcher
              mode={personaMode}
              onChange={(m) => {
                setPersonaMode(m);
                storeEditMode(m);
              }}
            />
          </div>
          {personaMode === "visual" ? (
            <PersonaVisualEditor onSaved={() => void loadCoreConfigFiles()} />
          ) : (
            <CoreConfigExpertPanel
              files={coreConfigFiles}
              enabledFiles={enabledFiles}
              selectedFile={selectedCoreFile}
              fileContent={coreFileContent}
              hasChanges={coreFileContent !== coreOriginalContent}
              loading={coreLoading}
              onFileClick={handleCoreFileClick}
              onContentChange={setCoreFileContent}
              onSave={handleCoreFileSave}
              onReset={() => setCoreFileContent(coreOriginalContent)}
              onToggleEnabled={handleToggleFileEnabled}
              onReorder={handleReorderFiles}
              onRefresh={() => void loadCoreConfigFiles()}
            />
          )}
        </div>
      ),
    },
    {
      key: "skills",
      label: (
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <ThunderboltOutlined />
          {t("nav.skills")}
        </span>
      ),
      children: (
        <div>
          {/* Action buttons */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <Text type="secondary" style={{ fontSize: 13 }}>
              {t("agent.skillsManagementHint")}
            </Text>
            <Space size={4}>
              <Button
                size="small"
                icon={<ShopOutlined />}
                onClick={() => setHubImportOpen(true)}
              >
                {t("agent.importFromMarket")}
              </Button>
              <Button
                size="small"
                type="default"
                onClick={() => {
                  onClose();
                  navigate(`/skills?tab=market&agent=${encodeURIComponent(agent.id)}`);
                }}
              >
                {t("agent.goToMarket")}
              </Button>
              <Button
                size="small"
                icon={<SettingOutlined />}
                onClick={handleNavigateToSkillsPage}
              >
                {t("agent.fullSkillsManagement")}
              </Button>
            </Space>
          </div>

          {/* Installed skills section */}
          {installedSkillDetails.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 8,
                  color: "rgba(20,20,19,0.85)",
                }}
              >
                {t("agent.installedSkills")} ({installedSkillDetails.length})
              </div>
              <div className={styles.pickerGrid}>
                {installedSkillDetails.map((skill) => (
                  <div
                    key={skill.name}
                    className={`${styles.pickerCard} ${styles.pickerCardInstalled}`}
                  >
                    <div className={styles.pickerCardTitle}>
                      {skill.emoji} {skill.display_name || skill.name}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        marginTop: 4,
                      }}
                    >
                      <Switch
                        size="small"
                        checked={skill.enabled !== false}
                        onChange={() => handleToggleSkillEnabled(skill.name)}
                      />
                      <DeleteOutlined
                        style={{
                          fontSize: 13,
                          color: "rgba(20,20,19,0.45)",
                          cursor: "pointer",
                        }}
                        onClick={() => handleRemoveSkill(skill.name)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pool skills section */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <Text type="secondary" style={{ fontSize: 13 }}>
              {t("agent.addSkillsFromPool")}
            </Text>
            <Space size={4}>
              <Button size="small" type="primary" onClick={handleSelectAll}>
                {t("agent.selectAll")}
              </Button>
              <Button size="small" type="default" onClick={handleSelectBuiltin}>
                {t("agent.selectBuiltin")}
              </Button>
              <Button size="small" type="default" onClick={handleSelectNone}>
                {t("agent.selectNone")}
              </Button>
            </Space>
          </div>
          {loadingSkills ? (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <Spin size="small" />
            </div>
          ) : poolSkills.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("agent.noPoolSkills")}
            />
          ) : (
            <div className={styles.pickerGrid}>
              {poolSkills.map((skill) => {
                const selected = selectedSkills.includes(skill.name);
                const isInstalled =
                  !!agent && installedSkills.includes(skill.name);
                return (
                  <div
                    key={skill.name}
                    className={`${styles.pickerCard} ${
                      selected ? styles.pickerCardSelected : ""
                    } ${isInstalled ? styles.pickerCardDisabled : ""}`}
                    onClick={() => toggleSkill(skill.name)}
                  >
                    {selected && (
                      <span className={styles.pickerCheck}>
                        <CheckOutlined />
                      </span>
                    )}
                    <div className={styles.pickerCardTitle}>
                      {skill.emoji} {skill.display_name || skill.name}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Hub import modal */}
          <ImportHubModal
            open={hubImportOpen}
            importing={hubImporting}
            onCancel={() => setHubImportOpen(false)}
            onConfirm={handleHubImport}
          />
        </div>
      ),
    },
    {
      key: "sop",
      label: (
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <ApartmentOutlined />
          {t("agent.sopTab")}
        </span>
      ),
      children: (
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <Text type="secondary" style={{ fontSize: 13 }}>
              {t("agent.sopHint")}
            </Text>
            <Button
              size="small"
              icon={<ArrowRightOutlined />}
              onClick={() => {
                onClose();
                navigate("/sop");
              }}
            >
              {t("agent.goToSop")}
            </Button>
          </div>
          {sopLoading ? (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <Spin size="small" />
            </div>
          ) : sopSkills.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("agent.noSopSkills")}
            />
          ) : (
            <div className={styles.pickerGrid}>
              {sopSkills.map((skill) => (
                <div
                  key={skill.id}
                  className={`${styles.pickerCard} ${styles.pickerCardInstalled}`}
                >
                  <div className={styles.pickerCardTitle}>
                    <PlayCircleOutlined style={{ marginRight: 4, color: "#52c41a" }} />
                    {skill.name}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "rgba(20,20,19,0.45)",
                      marginTop: 4,
                    }}
                  >
                    {skill.status === "active"
                      ? t("agent.sopStatusActive")
                      : skill.status === "draft"
                        ? t("agent.sopStatusDraft")
                        : t("agent.sopStatusArchived")}
                    {" · "}
                    {skill.nodes?.length || 0} {t("agent.sopNodes")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "kb",
      label: (
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <BookOutlined />
          {t("agent.kbTab")}
        </span>
      ),
      children: (
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <Text type="secondary" style={{ fontSize: 13 }}>
              {t("agent.kbHint")}
            </Text>
            <Button
              size="small"
              icon={<ArrowRightOutlined />}
              onClick={() => {
                onClose();
                navigate("/kb");
              }}
            >
              {t("agent.goToKb")}
            </Button>
          </div>
          {kbLoading ? (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <Spin size="small" />
            </div>
          ) : kbDocuments.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("agent.noKbDocs")}
            />
          ) : (
            <div className={styles.pickerGrid}>
              {kbDocuments.slice(0, 12).map((doc) => (
                <div
                  key={doc.id}
                  className={`${styles.pickerCard} ${styles.pickerCardInstalled}`}
                >
                  <div className={styles.pickerCardTitle}>
                    <FileTextOutlined style={{ marginRight: 4, color: "#1677ff" }} />
                    {doc.title || doc.id}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "rgba(20,20,19,0.45)",
                      marginTop: 4,
                    }}
                  >
                    {doc.chunk_count ?? 0} {t("agent.kbChunks")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <Drawer
      title={
        agent
          ? t("agent.editTitle", { name: getAgentDisplayName(agent, t) })
          : ""
      }
      open={open}
      onClose={onClose}
      width={720}
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="primary" onClick={handleSave} loading={saving}>
            {t("common.save")}
          </Button>
        </Space>
      }
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabs}
        destroyOnHidden={false}
      />
    </Drawer>
  );
}