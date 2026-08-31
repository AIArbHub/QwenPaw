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
  Avatar,
} from "antd";
import {
  UploadOutlined,
  DeleteOutlined,
  CheckOutlined,
  RobotOutlined,
  HeartOutlined,
  ThunderboltOutlined,
  ShopOutlined,
  SettingOutlined,
  DatabaseOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { AgentSummary, AgentProfileConfig } from "@/api/types/agents";
import type { ProviderInfo } from "@/api/types/provider";
import { getAgentDisplayName } from "@/utils/agentDisplayName";
import type { PoolSkillSpec, SkillSpec } from "@/api/types/skill";
import type { MarkdownFile } from "@/api/types/workspace";
import { invalidateSkillCache, skillApi } from "@/api/modules/skill";
import { providerApi } from "@/api/modules/provider";
import { agentsApi } from "@/api/modules/agents";
import { workspaceApi } from "@/api/modules/workspace";
import { getApiUrl } from "@/api/config";
import { useAppMessage } from "@/hooks/useAppMessage";
import { providerIcon } from "../../Models/components/providerIcon";
import { ImportHubModal } from "@/pages/Agent/Skills/components";
import styles from "../index.module.less";
import { CoreConfigExpertPanel } from "./CoreConfigExpertPanel";
import { MemoryCenterPanel } from "./MemoryCenterPanel";

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

/** Resolve a backend avatar path into a full URL for <img src>. */
function resolveAvatarSrc(avatar: string | null | undefined): string {
  if (!avatar) return "";
  if (/^https?:\/\//.test(avatar)) return avatar;
  const path = avatar.replace(/^\/api/, "");
  return getApiUrl(path);
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
  const { message, modal } = useAppMessage();
  const [form] = Form.useForm();
  const [activeTab, setActiveTab] = useState("basic");
  const [poolSkills, setPoolSkills] = useState<PoolSkillSpec[]>([]);
  const [installedSkills, setInstalledSkills] = useState<string[]>([]);
  const [installedSkillDetails, setInstalledSkillDetails] = useState<SkillSpec[]>(
    [],
  );
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
  const configRef = useRef<AgentProfileConfig | null>(null);

  // Persona (expert) core config files state
  const [coreConfigFiles, setCoreConfigFiles] = useState<MarkdownFile[]>([]);
  const [enabledFiles, setEnabledFiles] = useState<string[]>([]);
  const [selectedCoreFile, setSelectedCoreFile] = useState<MarkdownFile | null>(
    null,
  );
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

  // Load core config files (SOUL.md, PROFILE.md, etc.) for the persona tab
  const loadCoreConfigFiles = useCallback(async () => {
    if (!agent) return;
    setCoreLoading(true);
    try {
      const [fileList, enabledList] = await Promise.all([
        workspaceApi.listFiles(agent.id),
        workspaceApi.getSystemPromptFiles(agent.id),
      ]);
      setCoreConfigFiles(fileList as MarkdownFile[]);
      setEnabledFiles(enabledList || []);
    } catch (err) {
      console.error("Failed to load core config files:", err);
    } finally {
      setCoreLoading(false);
    }
  }, [agent]);

  // Load agent config when drawer opens
  useEffect(() => {
    if (!open || !agent) return;

    setActiveTab(initialTab || "basic");
    setAvatarUrl(agent.avatar || null);
    configRef.current = null;
    setSelectedCoreFile(null);
    setCoreFileContent("");
    setCoreOriginalContent("");

    agentsApi
      .getAgent(agent.id)
      .then((config) => {
        configRef.current = config;
        setEnabledFiles(config.system_prompt_files ?? []);
        form.setFieldsValue({
          id: config.id,
          name: config.name,
          description: config.description,
          group: config.group ?? "",
          workspace_dir: config.workspace_dir,
          active_model_provider: config.active_model?.provider_id || undefined,
          active_model_model: config.active_model?.model || undefined,
        });
      })
      .catch((err) => {
        console.error("Failed to load agent config:", err);
        message.error(t("agent.loadConfigFailed"));
      });

    setLoadingProviders(true);
    providerApi
      .listProviders()
      .then((data) => {
        if (Array.isArray(data)) setProviders(data);
      })
      .catch((err) => console.error("Failed to load providers:", err))
      .finally(() => setLoadingProviders(false));

    setLoadingSkills(true);
    const fetchPool = skillApi.listSkillPoolSkills();
    const fetchInstalled = skillApi.listSkills(agent.id);

    Promise.all([fetchPool, fetchInstalled])
      .then(([pool, workspaceSkills]) => {
        const poolSkillNames = new Set(pool.map((skill) => skill.name));
        setInstalledSkillDetails(workspaceSkills);
        const installed = workspaceSkills
          .filter((skill) => poolSkillNames.has(skill.name))
          .map((skill) => skill.name);

        setPoolSkills(pool);
        setInstalledSkills(installed);
        installedSkillsRef.current = installed;
        setSelectedSkills(installed);
      })
      .catch((err) => console.error("Failed to load skills:", err))
      .finally(() => setLoadingSkills(false));

    void loadCoreConfigFiles();
  }, [open, agent, form, t, initialTab, message, loadCoreConfigFiles]);

  const loadCoreFileIntoEditor = useCallback(
    async (file: MarkdownFile) => {
      if (!agent) return;
      setSelectedCoreFile(file);
      setCoreLoading(true);
      try {
        const data = await workspaceApi.loadFile(file.filename, agent.id);
        setCoreFileContent(data.content);
        setCoreOriginalContent(data.content);
      } catch (err) {
        console.error("Failed to load file:", err);
        message.error(t("workspace.loadFileError"));
      } finally {
        setCoreLoading(false);
      }
    },
    [agent, message, t],
  );

  const handleCoreFileClick = (file: MarkdownFile) => {
    if (
      selectedCoreFile &&
      selectedCoreFile.filename !== file.filename &&
      coreFileContent !== coreOriginalContent
    ) {
      modal.confirm({
        title: t("workspace.unsavedChangesTitle"),
        content: t("workspace.unsavedChangesDesc"),
        okText: t("common.discard"),
        okButtonProps: { danger: true },
        cancelText: t("common.cancel"),
        onOk: () => void loadCoreFileIntoEditor(file),
      });
      return;
    }
    void loadCoreFileIntoEditor(file);
  };

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
      message.success(t("workspace.saveSuccess"));
    } catch (err) {
      console.error("Failed to save file:", err);
      message.error(t("workspace.saveFailed"));
    } finally {
      setCoreLoading(false);
    }
  };

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
      setEnabledFiles(enabledFiles);
      message.error(t("workspace.toggleFileFailed"));
    }
  };

  const handleReorderFiles = async (newOrder: string[]) => {
    if (!agent) return;
    const oldOrder = [...enabledFiles];
    setEnabledFiles(newOrder);
    try {
      await workspaceApi.setSystemPromptFiles(newOrder, agent.id);
    } catch (err) {
      console.error("Failed to reorder files:", err);
      setEnabledFiles(oldOrder);
      message.error(t("workspace.reorderFailed"));
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !agent) return;

    const allowedTypes = [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "image/svg+xml",
    ];
    if (!allowedTypes.includes(file.type)) {
      message.error(t("agent.avatarTypeInvalid"));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      message.error(t("agent.avatarTooLarge"));
      return;
    }

    setUploadingAvatar(true);
    try {
      const result = await agentsApi.uploadAvatar(agent.id, file);
      setAvatarUrl(result.avatar);
      message.success(t("agent.avatarUploadSuccess"));
    } catch (error: unknown) {
      message.error(
        error instanceof Error ? error.message : t("agent.avatarUploadFailed"),
      );
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
      message.success(t("agent.avatarDeleteSuccess"));
    } catch (error: unknown) {
      message.error(
        error instanceof Error ? error.message : t("agent.avatarDeleteFailed"),
      );
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

      const newWorkspaceDir =
        typeof values.workspace_dir === "string"
          ? values.workspace_dir.trim()
          : values.workspace_dir;

      const payload: AgentProfileConfig = {
        ...(configRef.current ?? ({} as AgentProfileConfig)),
        name: values.name,
        description: values.description ?? "",
        group: values.group ?? "",
        active_model,
        system_prompt_files: enabledFiles,
      };
      if (newWorkspaceDir) {
        payload.workspace_dir = newWorkspaceDir;
      } else {
        payload.workspace_dir = undefined;
      }

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

      const oldWorkspaceDir = agent.workspace_dir;
      if (newWorkspaceDir && oldWorkspaceDir && newWorkspaceDir !== oldWorkspaceDir) {
        const migrateFiles = values.migrate_workspace !== false;
        await agentsApi.migrateWorkspace(agent.id, {
          new_workspace_dir: newWorkspaceDir,
          migrate_files: migrateFiles,
        });
      }

      await agentsApi.updateAgent(agent.id, payload);

      if (newSkills.length > 0) {
        invalidateSkillCache({ agentId: agent.id });
      }

      message.success(t("agent.updateSuccess"));
      onUpdated();
      onClose();
    } catch (error: unknown) {
      console.error("Failed to save agent:", error);
      invalidateSkillCache({ agentId: agent.id });
      message.error(
        error instanceof Error ? error.message : t("agent.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSelectAll = () => {
    setSelectedSkills(poolSkills.map((s) => s.name));
  };

  const handleSelectBuiltin = () => {
    const builtinNames = poolSkills
      .filter((s) => s.source === "builtin")
      .map((s) => s.name);
    setSelectedSkills(Array.from(new Set([...installedSkills, ...builtinNames])));
  };

  const handleSelectNone = () => {
    setSelectedSkills(agent ? [...installedSkills] : []);
  };

  const handleNavigateToSkillsPage = () => {
    if (!agent) return;
    onClose();
    navigate(`/skills?tab=installed&agent=${encodeURIComponent(agent.id)}`);
  };

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
          throw new Error(status.error || t("skills.importFailed"));
        }
      }
      if (!completed) {
        message.warning(t("skills.importTimeout"));
      } else {
        message.success(t("skills.importSuccess"));
        invalidateSkillCache({ agentId: agent.id });
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
    } catch (error: unknown) {
      message.error(
        error instanceof Error ? error.message : t("skills.importFailed"),
      );
    } finally {
      setHubImporting(false);
    }
  };

  const handleToggleSkillEnabled = async (skillName: string) => {
    if (!agent) return;
    const skill = installedSkillDetails.find((s) => s.name === skillName);
    if (!skill) return;
    try {
      if (skill.enabled) {
        await skillApi.disableSkill(skillName, agent.id);
      } else {
        await skillApi.enableSkill(skillName, agent.id);
      }
      setInstalledSkillDetails((prev) =>
        prev.map((s) =>
          s.name === skillName ? { ...s, enabled: !s.enabled } : s,
        ),
      );
      invalidateSkillCache({ agentId: agent.id });
      message.success(t("skills.operationSuccess"));
    } catch (error: unknown) {
      message.error(
        error instanceof Error ? error.message : t("skills.operationFailed"),
      );
    }
  };

  const handleRemoveSkill = async (skillName: string) => {
    if (!agent) return;
    modal.confirm({
      title: t("skills.deleteConfirm"),
      content: t("skills.confirmDeleteDesc", { name: skillName }),
      okText: t("common.delete"),
      okButtonProps: { danger: true },
      cancelText: t("common.cancel"),
      onOk: async () => {
        try {
          await skillApi.deleteSkill(skillName, agent.id);
          setInstalledSkillDetails((prev) =>
            prev.filter((s) => s.name !== skillName),
          );
          setInstalledSkills((prev) => prev.filter((n) => n !== skillName));
          installedSkillsRef.current = installedSkillsRef.current.filter(
            (n) => n !== skillName,
          );
          setSelectedSkills((prev) => prev.filter((n) => n !== skillName));
          invalidateSkillCache({ agentId: agent.id });
          message.success(t("skills.deleteSuccess"));
        } catch (error: unknown) {
          message.error(
            error instanceof Error ? error.message : t("skills.deleteFailed"),
          );
        }
      },
    });
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
          <Form.Item
            name="group"
            label={t("agent.group", "分组")}
            extra={t("agent.groupHelp", "可选，用于在列表中分类管理智能体")}
          >
            <Input maxLength={20} placeholder={t("agent.groupPlaceholder", "如：争议解决")} />
          </Form.Item>
          <Form.Item label={t("agent.avatar")}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Avatar
                size={48}
                src={resolveAvatarSrc(avatarUrl) || undefined}
                icon={<RobotOutlined />}
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
            <Text
              type="secondary"
              style={{ fontSize: 12, marginTop: 4, display: "block" }}
            >
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
                style={{ width: "45%" }}
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
                  loadingProviders ? (
                    <Spin size="small" />
                  ) : (
                    t("agent.noConfiguredModels")
                  )
                }
              />
              <Select
                value={selectedModelId || undefined}
                onChange={(modelId) =>
                  form.setFieldsValue({ active_model_model: modelId })
                }
                placeholder={
                  selectedProviderId
                    ? t("agent.model")
                    : t("agent.modelPlaceholder")
                }
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
          <Form.Item name="workspace_dir" label={t("agent.workspace")}>
            <Input placeholder="~/.aiarb/workspaces/my-agent" />
          </Form.Item>
          <Form.Item name="migrate_workspace" valuePropName="checked">
            <Checkbox>{t("agent.migrateWorkspace")}</Checkbox>
          </Form.Item>
        </Form>
      ),
    },
    {
      key: "persona",
      label: (
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <HeartOutlined />
          {t("agent.persona")}
        </span>
      ),
      children: (
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
                  navigate(
                    `/skills?tab=market&agent=${encodeURIComponent(agent?.id ?? "")}`,
                  );
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
                  <div key={skill.name} className={styles.pickerCard}>
                    <div className={styles.pickerCardTitle}>
                      {skill.emoji} {skill.name}
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
                      {skill.emoji} {skill.name}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

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
      key: "memory",
      label: (
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <DatabaseOutlined />
          {t("agent.memory", "记忆")}
        </span>
      ),
      children: agent ? (
        <MemoryCenterPanel agentId={agent.id} />
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("agent.noAgentSelected", "未选择智能体")}
        />
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
