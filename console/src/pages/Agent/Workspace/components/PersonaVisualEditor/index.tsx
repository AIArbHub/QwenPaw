/**
 * PersonaVisualEditor — Visual form-based editor for agent persona files.
 *
 * This editor provides a C-end friendly, form-based UI for editing the
 * three core persona files (PROFILE.md, SOUL.md, AGENTS.md). It uses
 * personaParser to parse/serialize md content, and saves through the
 * existing workspace API.
 *
 * Data flow:
 *   Load: workspaceApi.loadFile → parseProfile/parseSoul/parseAgents → state
 *   Save: state → serializeProfile/serializeSoul/serializeAgents → workspaceApi.saveFile
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Button, Switch } from "antd";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  RobotOutlined,
  HeartOutlined,
  UserOutlined,
  ToolOutlined,
  FileTextOutlined,
  ExclamationCircleOutlined,
  SaveOutlined,
  UndoOutlined,
  PlusOutlined,
  CloseOutlined,
} from "@ant-design/icons";
import { workspaceApi } from "../../../../../api/modules/workspace";
import { useAppMessage } from "../../../../../hooks/useAppMessage";
import {
  parseProfile,
  parseSoul,
  parseAgents,
  serializeProfile,
  serializeSoul,
  serializeAgents,
  hasUnparsedSections,
  type ParsedProfile,
  type ParsedSoul,
  type ParsedAgents,
} from "../../../../../utils/personaParser";
import styles from "./index.module.less";

interface PersonaVisualEditorProps {
  /** Called when content is saved (to refresh file list etc.) */
  onSaved?: () => void;
}

const CORE_FILES = ["PROFILE.md", "SOUL.md", "AGENTS.md"] as const;

// Default SOUL principles (from template)
const DEFAULT_PRINCIPLES_ZH = [
  `真心帮忙，别演。跳过「好问题！」和「我很乐意帮忙！」 — 直接帮。行动胜过废话。`,
  "有自己的观点。你可以不同意、有偏好、觉得有趣或无聊。没个性的助手就是个绕了弯的搜索引擎。",
  "先自己想办法。试着搞清楚。读文件。查上下文。搜一搜。看看有没有skills可以用，有没有工具可以用。然后卡住了再问。目标是带着答案回来，不是带着问题。",
  "靠本事赢得信任。你的人类给了你访问权限。别让他们后悔。外部操作小心点（邮件、推特、公开的事）。内部操作大胆点（阅读、整理、学习）。",
  "记住你是客人。你能看到别人的生活 — 消息、文件、日历，甚至可能是他们的家。这是亲密的。尊重地对待。",
];

const DEFAULT_BOUNDARIES_ZH = [
  "私密的保持私密。绝对的。",
  "拿不准就先问再对外操作。",
  "别往消息平台发半成品回复。",
  "你不是用户的传声筒 — 群聊里小心点。",
];

const DEFAULT_SAFETY_ZH = [
  "绝不泄露私密数据。绝不。",
  "运行破坏性命令前先问。",
  "trash > rm（能恢复总比永久删除好）",
  "拿不准的事情，需要跟用户确认。",
];

const STYLE_PRESETS = [
  { id: "formal", zhLabel: "正式专业", enLabel: "Formal" },
  { id: "natural", zhLabel: "自然随和", enLabel: "Natural" },
  { id: "playful", zhLabel: "活泼幽默", enLabel: "Playful" },
  { id: "calm", zhLabel: "冷静克制", enLabel: "Calm" },
];

export const PersonaVisualEditor: React.FC<PersonaVisualEditorProps> = ({
  onSaved,
}) => {
  const { t } = useTranslation();
  const { message } = useAppMessage();

  const [profile, setProfile] = useState<ParsedProfile | null>(null);
  const [soul, setSoul] = useState<ParsedSoul | null>(null);
  const [agents, setAgents] = useState<ParsedAgents | null>(null);
  const [originalData, setOriginalData] = useState<{
    profile: string;
    soul: string;
    agents: string;
  }>({ profile: "", soul: "", agents: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // File management state
  const [fileList, setFileList] = useState<
    Array<{ filename: string; size: number; modified_time: string }>
  >([]);
  const [enabledFiles, setEnabledFiles] = useState<string[]>([]);

  const showWarning = useMemo(() => {
    if (!profile || !soul || !agents) return false;
    return hasUnparsedSections({ profile, soul, agents });
  }, [profile, soul, agents]);

  // Load all persona files
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [files, enabled] = await Promise.all([
        workspaceApi.listFiles(),
        workspaceApi.getSystemPromptFiles(),
      ]);
      setFileList(files);
      setEnabledFiles(enabled);

      // Load core file contents
      const loadPromises = CORE_FILES.map((name) => {
        const file = files.find((f) => f.filename === name);
        if (!file) return Promise.resolve({ name, content: "" });
        return workspaceApi
          .loadFile(name)
          .then((data) => ({ name, content: data.content }))
          .catch(() => ({ name, content: "" }));
      });

      const results = await Promise.all(loadPromises);
      const profileContent = results.find((r) => r.name === "PROFILE.md")?.content || "";
      const soulContent = results.find((r) => r.name === "SOUL.md")?.content || "";
      const agentsContent = results.find((r) => r.name === "AGENTS.md")?.content || "";

      setProfile(parseProfile(profileContent));
      setSoul(parseSoul(soulContent));
      setAgents(parseAgents(agentsContent));
      setOriginalData({
        profile: profileContent,
        soul: soulContent,
        agents: agentsContent,
      });
      setHasChanges(false);
    } catch (error) {
      console.error("Failed to load persona files:", error);
      message.error(t("persona.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t, message]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Track changes
  useEffect(() => {
    if (!profile || !soul || !agents) return;
    const newProfileMd = serializeProfile(profile);
    const newSoulMd = serializeSoul(soul);
    const newAgentsMd = serializeAgents(agents);
    setHasChanges(
      newProfileMd !== originalData.profile ||
        newSoulMd !== originalData.soul ||
        newAgentsMd !== originalData.agents,
    );
  }, [profile, soul, agents, originalData]);

  const handleSave = async () => {
    if (!profile || !soul || !agents) return;
    setSaving(true);
    try {
      const newProfileMd = serializeProfile(profile);
      const newSoulMd = serializeSoul(soul);
      const newAgentsMd = serializeAgents(agents);

      const saves: Promise<unknown>[] = [];
      if (newProfileMd !== originalData.profile) {
        saves.push(workspaceApi.saveFile("PROFILE.md", newProfileMd));
      }
      if (newSoulMd !== originalData.soul) {
        saves.push(workspaceApi.saveFile("SOUL.md", newSoulMd));
      }
      if (newAgentsMd !== originalData.agents) {
        saves.push(workspaceApi.saveFile("AGENTS.md", newAgentsMd));
      }

      await Promise.all(saves);
      setOriginalData({
        profile: newProfileMd,
        soul: newSoulMd,
        agents: newAgentsMd,
      });
      setHasChanges(false);
      message.success(t("persona.saveSuccess"));
      onSaved?.();
    } catch (error) {
      console.error("Failed to save persona:", error);
      message.error(t("persona.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    void loadAll();
  };

  const handleToggleFileEnabled = async (filename: string) => {
    const newEnabled = enabledFiles.includes(filename)
      ? enabledFiles.filter((f) => f !== filename)
      : [...enabledFiles, filename];
    try {
      await workspaceApi.setSystemPromptFiles(newEnabled);
      setEnabledFiles(newEnabled);
    } catch (error) {
      console.error("Failed to toggle file:", error);
      message.error(t("workspace.configUpdateFailed"));
    }
  };

  if (loading || !profile || !soul || !agents) {
    return (
      <div className={styles.loadingState}>
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className={styles.visualEditor}>
      {showWarning && (
        <div className={styles.warningBanner}>
          <ExclamationCircleOutlined />
          <span>{t("persona.unparsedWarning")}</span>
        </div>
      )}

      {/* ─── Identity Card ─── */}
      <IdentityCardSection
        profile={profile}
        onChange={setProfile}
        t={t}
      />

      {/* ─── User Profile ─── */}
      <UserProfileSection
        profile={profile}
        onChange={setProfile}
        t={t}
      />

      {/* ─── Soul & Personality ─── */}
      <SoulSection
        soul={soul}
        onChange={setSoul}
        t={t}
      />

      {/* ─── Work Guidelines ─── */}
      <WorkGuidelinesSection
        agents={agents}
        onChange={setAgents}
        t={t}
      />

      {/* ─── File Management ─── */}
      <FileManagementSection
        files={fileList}
        enabledFiles={enabledFiles}
        onToggleEnabled={handleToggleFileEnabled}
        t={t}
      />

      {/* ─── Save Bar ─── */}
      <div className={styles.saveBar}>
        <span className={styles.saveStatus}>
          {saving
            ? t("workspace.saving")
            : hasChanges
            ? t("workspace.unsaved")
            : t("workspace.saved")}
        </span>
        <Button
          size="small"
          icon={<UndoOutlined />}
          onClick={handleReset}
          disabled={!hasChanges || saving}
        >
          {t("common.reset")}
        </Button>
        <Button
          type="primary"
          size="small"
          icon={<SaveOutlined />}
          onClick={handleSave}
          disabled={!hasChanges}
          loading={saving}
        >
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
};

// ─── Identity Card Section ───────────────────────────────────────────────────

interface IdentityCardProps {
  profile: ParsedProfile;
  onChange: (p: ParsedProfile) => void;
  t: TFunction;
}

const IdentityCardSection: React.FC<IdentityCardProps> = ({ profile, onChange, t }) => {
  const [styleInput, setStyleInput] = useState("");
  const styleTags = profile.agent.style
    ? profile.agent.style
        .split(/[,，、\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const updateField = (field: keyof ParsedProfile["agent"], value: string) => {
    onChange({ ...profile, agent: { ...profile.agent, [field]: value } });
  };

  const addStyleTag = () => {
    const tag = styleInput.trim();
    if (!tag) return;
    const current = styleTags;
    if (current.includes(tag)) return;
    const newStyle = [...current, tag].join("，");
    updateField("style", newStyle);
    setStyleInput("");
  };

  const removeStyleTag = (tag: string) => {
    const newTags = styleTags.filter((t) => t !== tag);
    updateField("style", newTags.join("，"));
  };

  return (
    <div className={styles.sectionCard}>
      <div className={styles.sectionHeader}>
        <RobotOutlined className={styles.sectionIcon} />
        {t("persona.identityTitle")}
      </div>
      <div className={styles.sectionBody}>
        <div className={styles.identityRow}>
          <div className={styles.avatarSection}>
            <div className={styles.avatarWrapper}>
              <RobotOutlined className={styles.avatarPlaceholder} />
            </div>
          </div>
          <div className={styles.identityFields}>
            <div className={styles.fieldRow}>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>{t("persona.agentName")}</label>
                <input
                  className={styles.textInput}
                  value={profile.agent.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  placeholder={t("persona.agentNamePlaceholder")}
                />
              </div>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>{t("persona.agentRole")}</label>
                <select
                  className={styles.selectInput}
                  value={profile.agent.role}
                  onChange={(e) => updateField("role", e.target.value)}
                >
                  <option value="">{t("persona.roleSelectDefault")}</option>
                  <option value="AI助手">AI助手</option>
                  <option value="机器人">机器人</option>
                  <option value="使魔">使魔</option>
                  <option value="机器里的幽灵">机器里的幽灵</option>
                  <option value="custom">{t("persona.roleCustom")}</option>
                </select>
              </div>
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>{t("persona.agentStyle")}</label>
              <div className={styles.styleTags}>
                {styleTags.map((tag) => (
                  <span key={tag} className={styles.styleTag}>
                    {tag}
                    <CloseOutlined
                      className={styles.styleTagRemove}
                      onClick={() => removeStyleTag(tag)}
                    />
                  </span>
                ))}
                <span className={styles.styleTag}>
                  <input
                    className={styles.styleTagInput}
                    value={styleInput}
                    onChange={(e) => setStyleInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addStyleTag();
                      }
                    }}
                    onBlur={addStyleTag}
                    placeholder={t("persona.styleTagPlaceholder")}
                  />
                </span>
              </div>
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>{t("persona.agentOther")}</label>
              <input
                className={styles.textInput}
                value={profile.agent.other}
                onChange={(e) => updateField("other", e.target.value)}
                placeholder={t("persona.agentOtherPlaceholder")}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── User Profile Section ────────────────────────────────────────────────────

interface UserProfileProps {
  profile: ParsedProfile;
  onChange: (p: ParsedProfile) => void;
  t: TFunction;
}

const UserProfileSection: React.FC<UserProfileProps> = ({ profile, onChange, t }) => {
  const updateField = (field: keyof ParsedProfile["user"], value: string) => {
    onChange({ ...profile, user: { ...profile.user, [field]: value } });
  };

  return (
    <div className={styles.sectionCard}>
      <div className={styles.sectionHeader}>
        <UserOutlined className={styles.sectionIcon} />
        {t("persona.userProfileTitle")}
      </div>
      <div className={styles.sectionBody}>
        <div className={styles.fieldRow}>
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>{t("persona.userName")}</label>
            <input
              className={styles.textInput}
              value={profile.user.name}
              onChange={(e) => updateField("name", e.target.value)}
              placeholder={t("persona.userNamePlaceholder")}
            />
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>{t("persona.userAddressAs")}</label>
            <input
              className={styles.textInput}
              value={profile.user.addressAs}
              onChange={(e) => updateField("addressAs", e.target.value)}
              placeholder={t("persona.userAddressAsPlaceholder")}
            />
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>{t("persona.userPronouns")}</label>
            <input
              className={styles.textInput}
              value={profile.user.pronouns}
              onChange={(e) => updateField("pronouns", e.target.value)}
              placeholder={t("persona.userPronounsPlaceholder")}
            />
          </div>
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>{t("persona.userNotes")}</label>
          <textarea
            className={styles.textArea}
            value={profile.user.notes}
            onChange={(e) => updateField("notes", e.target.value)}
            placeholder={t("persona.userNotesPlaceholder")}
            rows={2}
          />
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>{t("persona.userBackground")}</label>
          <textarea
            className={styles.textArea}
            value={profile.user.background}
            onChange={(e) => updateField("background", e.target.value)}
            placeholder={t("persona.userBackgroundPlaceholder")}
            rows={3}
          />
        </div>
      </div>
    </div>
  );
};

// ─── Soul Section ────────────────────────────────────────────────────────────

interface SoulSectionProps {
  soul: ParsedSoul;
  onChange: (s: ParsedSoul) => void;
  t: TFunction;
}

const SoulSection: React.FC<SoulSectionProps> = ({ soul, onChange, t }) => {
  const [newPrinciple, setNewPrinciple] = useState("");
  const [newBoundary, setNewBoundary] = useState("");

  const stylePreset = useMemo(() => {
    const styleLower = soul.style.toLowerCase();
    if (/正式|专业|formal/i.test(styleLower)) return "formal";
    if (/随意|自然|natural|casual/i.test(styleLower)) return "natural";
    if (/活泼|幽默|playful|funny/i.test(styleLower)) return "playful";
    if (/冷静|克制|calm/i.test(styleLower)) return "calm";
    return "";
  }, [soul.style]);

  const setStylePreset = (presetId: string) => {
    const preset = STYLE_PRESETS.find((p) => p.id === presetId);
    if (preset) {
      onChange({ ...soul, style: preset.zhLabel });
    }
  };

  const addPrinciple = () => {
    const text = newPrinciple.trim();
    if (!text) return;
    onChange({ ...soul, corePrinciples: [...soul.corePrinciples, text] });
    setNewPrinciple("");
  };

  const removePrinciple = (index: number) => {
    onChange({
      ...soul,
      corePrinciples: soul.corePrinciples.filter((_, i) => i !== index),
    });
  };

  const addBoundary = () => {
    const text = newBoundary.trim();
    if (!text) return;
    onChange({ ...soul, boundaries: [...soul.boundaries, text] });
    setNewBoundary("");
  };

  const removeBoundary = (index: number) => {
    onChange({
      ...soul,
      boundaries: soul.boundaries.filter((_, i) => i !== index),
    });
  };

  // If no principles loaded, show defaults as suggestions
  const displayPrinciples =
    soul.corePrinciples.length > 0 ? soul.corePrinciples : DEFAULT_PRINCIPLES_ZH;
  const displayBoundaries =
    soul.boundaries.length > 0 ? soul.boundaries : DEFAULT_BOUNDARIES_ZH;

  return (
    <div className={styles.sectionCard}>
      <div className={styles.sectionHeader}>
        <HeartOutlined className={styles.sectionIcon} />
        {t("persona.soulTitle")}
      </div>
      <div className={styles.sectionBody}>
        {/* Core Principles */}
        <div className={styles.subSectionLabel}>{t("persona.corePrinciples")}</div>
        {displayPrinciples.map((principle, index) => (
          <div key={index} className={styles.principleItem}>
            <input
              type="checkbox"
              className={styles.principleCheckbox}
              defaultChecked
              onChange={(e) => {
                if (!e.target.checked) {
                  removePrinciple(
                    soul.corePrinciples.indexOf(principle) >= 0
                      ? soul.corePrinciples.indexOf(principle)
                      : index,
                  );
                }
              }}
            />
            <span className={styles.principleText}>{principle}</span>
            <CloseOutlined
              className={styles.principleRemove}
              onClick={() => {
                const realIndex = soul.corePrinciples.indexOf(principle);
                if (realIndex >= 0) {
                  removePrinciple(realIndex);
                }
              }}
            />
          </div>
        ))}
        <button
          className={styles.addItemBtn}
          onClick={() => {
            if (newPrinciple.trim()) {
              addPrinciple();
            } else {
              const input = document.querySelector<HTMLInputElement>(
                `input[data-principle-input="true"]`
              );
              input?.focus();
            }
          }}
        >
          <PlusOutlined />
          {t("persona.addPrinciple")}
        </button>
        <input
          className={styles.textInput}
          style={{ marginTop: 8 }}
          data-principle-input="true"
          value={newPrinciple}
          onChange={(e) => setNewPrinciple(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addPrinciple();
            }
          }}
          placeholder={t("persona.principlePlaceholder")}
        />

        {/* Boundaries */}
        <div className={styles.subSectionLabel} style={{ marginTop: 16 }}>
          {t("persona.boundaries")}
        </div>
        {displayBoundaries.map((boundary, index) => (
          <div key={index} className={styles.principleItem}>
            <input
              type="checkbox"
              className={styles.principleCheckbox}
              defaultChecked
              onChange={(e) => {
                if (!e.target.checked) {
                  removeBoundary(
                    soul.boundaries.indexOf(boundary) >= 0
                      ? soul.boundaries.indexOf(boundary)
                      : index,
                  );
                }
              }}
            />
            <span className={styles.principleText}>{boundary}</span>
            <CloseOutlined
              className={styles.principleRemove}
              onClick={() => {
                const realIndex = soul.boundaries.indexOf(boundary);
                if (realIndex >= 0) {
                  removeBoundary(realIndex);
                }
              }}
            />
          </div>
        ))}
        <button
          className={styles.addItemBtn}
          onClick={() => {
            if (newBoundary.trim()) {
              addBoundary();
            }
          }}
        >
          <PlusOutlined />
          {t("persona.addBoundary")}
        </button>
        <input
          className={styles.textInput}
          style={{ marginTop: 8 }}
          value={newBoundary}
          onChange={(e) => setNewBoundary(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addBoundary();
            }
          }}
          placeholder={t("persona.boundaryPlaceholder")}
        />

        {/* Style & Tone */}
        <div className={styles.subSectionLabel} style={{ marginTop: 16 }}>
          {t("persona.styleAndTone")}
        </div>
        <div className={styles.stylePresetRow}>
          {STYLE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              className={`${styles.stylePresetBtn} ${
                stylePreset === preset.id ? styles.stylePresetActive : ""
              }`}
              onClick={() => setStylePreset(preset.id)}
            >
              {preset.zhLabel}
            </button>
          ))}
        </div>
        <textarea
          className={styles.textArea}
          value={soul.style}
          onChange={(e) => onChange({ ...soul, style: e.target.value })}
          placeholder={t("persona.stylePlaceholder")}
          rows={2}
        />
      </div>
    </div>
  );
};

// ─── Work Guidelines Section ─────────────────────────────────────────────────

interface WorkGuidelinesProps {
  agents: ParsedAgents;
  onChange: (a: ParsedAgents) => void;
  t: TFunction;
}

const WorkGuidelinesSection: React.FC<WorkGuidelinesProps> = ({ agents, onChange, t }) => {
  const displaySafety =
    agents.safety.length > 0 ? agents.safety : DEFAULT_SAFETY_ZH;

  return (
    <div className={styles.sectionCard}>
      <div className={styles.sectionHeader}>
        <ToolOutlined className={styles.sectionIcon} />
        {t("persona.workGuidelinesTitle")}
      </div>
      <div className={styles.sectionBody}>
        {/* Safety Rules */}
        <div className={styles.subSectionLabel}>{t("persona.safetyRules")}</div>
        {displaySafety.map((rule, index) => (
          <div key={index} className={styles.principleItem}>
            <input type="checkbox" className={styles.principleCheckbox} defaultChecked />
            <span className={styles.principleText}>{rule}</span>
          </div>
        ))}

        {/* Heartbeat */}
        <div className={styles.subSectionLabel} style={{ marginTop: 16 }}>
          {t("persona.heartbeat")}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Switch
            size="small"
            checked={agents.heartbeatEnabled}
            onChange={(checked) =>
              onChange({ ...agents, heartbeatEnabled: checked })
            }
          />
          <span style={{ fontSize: 13, color: "rgba(20,20,19,0.55)" }}>
            {t("persona.heartbeatEnable")}
          </span>
          {agents.heartbeatEnabled && (
            <input
              className={styles.textInput}
              style={{ width: 80 }}
              type="number"
              value={agents.heartbeatInterval}
              onChange={(e) =>
                onChange({ ...agents, heartbeatInterval: e.target.value })
              }
              placeholder="30"
            />
          )}
          {agents.heartbeatEnabled && (
            <span style={{ fontSize: 12, color: "rgba(20,20,19,0.45)" }}>
              {t("persona.heartbeatIntervalUnit")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── File Management Section ─────────────────────────────────────────────────

interface FileManagementProps {
  files: Array<{ filename: string; size: number; modified_time: string }>;
  enabledFiles: string[];
  onToggleEnabled: (filename: string) => void;
  t: TFunction;
}

const FileManagementSection: React.FC<FileManagementProps> = ({
  files,
  enabledFiles,
  onToggleEnabled,
  t,
}) => {
  const sortedFiles = useMemo(() => {
    return [...files].sort((a, b) => {
      const aIdx = enabledFiles.indexOf(a.filename);
      const bIdx = enabledFiles.indexOf(b.filename);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.filename.localeCompare(b.filename);
    });
  }, [files, enabledFiles]);

  return (
    <div className={styles.sectionCard}>
      <div className={styles.sectionHeader}>
        <FileTextOutlined className={styles.sectionIcon} />
        {t("persona.fileManagementTitle")}
      </div>
      <div className={styles.sectionBody}>
        {sortedFiles.map((file) => {
          const isEnabled = enabledFiles.includes(file.filename);
          const order = enabledFiles.indexOf(file.filename);
          return (
            <div key={file.filename} className={styles.fileMgmtRow}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {isEnabled && <span className={styles.orderBadge}>{order + 1}</span>}
                <div>
                  <div className={styles.fileMgmtName}>{file.filename}</div>
                  <div className={styles.fileMgmtMeta}>
                    {(file.size / 1024).toFixed(1)} KB
                  </div>
                </div>
              </div>
              <div className={styles.fileMgmtActions}>
                <Switch
                  size="small"
                  checked={isEnabled}
                  onChange={() => onToggleEnabled(file.filename)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
