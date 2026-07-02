import { useEffect, useState, useMemo, useRef } from "react";
import {
  Modal,
  Form,
  Input,
  Button,
  Select,
  Space,
  Typography,
  Empty,
  Spin,
  Checkbox,
  message as antMessage,
} from "antd";
import { CheckOutlined, UploadOutlined, DeleteOutlined, FolderOpenOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { isTauri } from "@tauri-apps/api/core";
import type { AgentSummary } from "@/api/types/agents";
import type { ProviderInfo } from "@/api/types/provider";
import { getAgentDisplayName } from "@/utils/agentDisplayName";
import type { PoolSkillSpec } from "@/api/types/skill";
import { skillApi } from "@/api/modules/skill";
import { providerApi } from "@/api/modules/provider";
import { agentsApi } from "@/api/modules/agents";
import { providerIcon } from "../../Models/components/providerIcon";
import styles from "../index.module.less";

const DEFAULT_AVATAR = "/ai-arb-avatar.svg";

const { Text } = Typography;

interface EligibleProvider {
  id: string;
  name: string;
  models: Array<{ id: string; name: string }>;
}

interface AgentModalProps {
  open: boolean;
  editingAgent: AgentSummary | null;
  form: ReturnType<typeof Form.useForm>[0];
  selectedSkills: string[];
  onSelectedSkillsChange: (skills: string[]) => void;
  onInstalledSkillsLoaded: (skills: string[]) => void;
  onSave: () => Promise<void>;
  onCancel: () => void;
}

export function AgentModal({
  open,
  editingAgent,
  form,
  selectedSkills,
  onSelectedSkillsChange,
  onInstalledSkillsLoaded,
  onSave,
  onCancel,
}: AgentModalProps) {
  const { t } = useTranslation();
  const [poolSkills, setPoolSkills] = useState<PoolSkillSpec[]>([]);
  const [installedSkills, setInstalledSkills] = useState<string[]>([]);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (!open) return;

    setAvatarUrl(editingAgent?.avatar || null);
    setUploadingAvatar(false);

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
    const fetchInstalled = editingAgent
      ? skillApi.listSkills(editingAgent.id)
      : Promise.resolve([]);

    Promise.all([fetchPool, fetchInstalled])
      .then(([pool, workspaceSkills]) => {
        const poolSkillNames = new Set(pool.map((skill) => skill.name));
        const installedSkills = workspaceSkills
          .filter((skill) => poolSkillNames.has(skill.name))
          .map((skill) => skill.name);

        setPoolSkills(pool);
        setInstalledSkills(installedSkills);
        onInstalledSkillsLoaded(installedSkills);
        if (editingAgent) {
          onSelectedSkillsChange(installedSkills);
        } else {
          onSelectedSkillsChange([]);
        }
      })
      .finally(() => setLoadingSkills(false));
  }, [editingAgent, onInstalledSkillsLoaded, onSelectedSkillsChange, open]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editingAgent) return;

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
      const result = await agentsApi.uploadAvatar(editingAgent.id, file);
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
    if (!editingAgent) return;
    try {
      await agentsApi.deleteAvatar(editingAgent.id);
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
    const isInstalled = editingAgent && installedSkills.includes(name);
    if (isInstalled) return;

    if (selectedSkills.includes(name)) {
      onSelectedSkillsChange(selectedSkills.filter((s) => s !== name));
    } else {
      onSelectedSkillsChange([...selectedSkills, name]);
    }
  };

  const handleSelectAll = () => {
    const allNames = poolSkills.map((s) => s.name);
    onSelectedSkillsChange(allNames);
  };

  const handleSelectBuiltin = () => {
    const builtinNames = poolSkills
      .filter((s) => s.source === "builtin")
      .map((s) => s.name);
    onSelectedSkillsChange(
      Array.from(new Set([...installedSkills, ...builtinNames])),
    );
  };

  const handleSelectNone = () => {
    onSelectedSkillsChange(editingAgent ? [...installedSkills] : []);
  };

  return (
    <Modal
      title={
        editingAgent
          ? t("agent.editTitle", {
              name: getAgentDisplayName(editingAgent, t),
            })
          : t("agent.createTitle")
      }
      open={open}
      onOk={onSave}
      onCancel={onCancel}
      width={640}
      okText={t("common.save")}
      cancelText={t("common.cancel")}
    >
      <Form form={form} layout="vertical" autoComplete="off">
        <Form.Item name="active_model_provider" hidden>
          <Input />
        </Form.Item>
        <Form.Item name="active_model_model" hidden>
          <Input />
        </Form.Item>

        {editingAgent && (
          <Form.Item name="id" label={t("agent.id")}>
            <Input disabled />
          </Form.Item>
        )}
        {!editingAgent && (
          <Form.Item
            name="id"
            label={t("agent.idLabel")}
            help={t("agent.idHelp")}
            rules={[
              {
                pattern: /^[a-zA-Z0-9][a-zA-Z0-9_-]*[a-zA-Z0-9]$/,
                message: t("agent.idPattern"),
              },
            ]}
          >
            <Input placeholder={t("agent.idPlaceholder")} />
          </Form.Item>
        )}
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
        {editingAgent && (
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
        )}
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
                  ? t("models.model")
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
        <Form.Item
          name="workspace_dir"
          label={t("agent.workspace")}
          help={!editingAgent ? t("agent.workspaceHelp") : undefined}
        >
          <Space.Compact style={{ width: "100%" }}>
            <Input
              placeholder="~/.aiarb/workspaces/my-agent"
              style={{ flex: 1 }}
            />
            {isTauri() && (
              <Button
                icon={<FolderOpenOutlined />}
                onClick={async () => {
                  const selected = await open({ directory: true, multiple: false });
                  if (selected && typeof selected === "string") {
                    form.setFieldsValue({ workspace_dir: selected });
                  }
                }}
              >
                {t("agent.browseFolder")}
              </Button>
            )}
          </Space.Compact>
        </Form.Item>
        {editingAgent && (
          <Form.Item name="migrate_workspace" valuePropName="checked">
            <Checkbox>{t("agent.migrateWorkspace")}</Checkbox>
          </Form.Item>
        )}
      </Form>

      <div style={{ marginTop: 4 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <Text type="secondary" style={{ fontSize: 13 }}>
            {editingAgent
              ? t("agent.addSkillsToAgent")
              : t("agent.initialSkills")}
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
                !!editingAgent && installedSkills.includes(skill.name);
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
                    {skill.display_name || skill.name}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}