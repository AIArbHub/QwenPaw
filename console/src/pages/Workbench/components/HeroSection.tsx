import { useState } from "react";
import { Button, Tooltip } from "antd";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { RobotOutlined, EditOutlined } from "@ant-design/icons";
import type { AgentSummary } from "@/api/types/agents";
import { getAgentDisplayName } from "@/utils/agentDisplayName";
import styles from "./HeroSection.module.less";

interface HeroSectionProps {
  agent: AgentSummary;
}

/**
 * HeroSection — Workbench 顶部 Hero 区。
 *
 * 方案文档第 4.2 节：
 * - 大头像 136×160px（hover 显示"更换头像"遮罩）
 * - 名称 22px semibold + default 徽章
 * - 状态行：在线/离线胶囊 + 创建者 + 入职时间
 * - 描述（2 行截断）
 * - 4 个 HeroMetric（资料数 / 技能数 / SOP数 / 定时任务数）
 * - 操作按钮："去对话"（深底白字）+ "编辑资料"（描边）
 */
const HeroSection: React.FC<HeroSectionProps> = ({ agent }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [avatarError, setAvatarError] = useState(false);

  const displayName = getAgentDisplayName(agent, t);
  const isDefault = agent.id === "default";
  const hasAvatar = agent.avatar && !avatarError;

  return (
    <div className={styles.hero}>
      {/* Avatar */}
      <div className={styles.avatarWrap}>
        <div className={styles.avatar}>
          {hasAvatar ? (
            <img
              src={agent.avatar!}
              alt=""
              onError={() => setAvatarError(true)}
            />
          ) : (
            <RobotOutlined className={styles.avatarFallback} />
          )}
        </div>
      </div>

      {/* Info */}
      <div className={styles.info}>
        <div className={styles.nameRow}>
          <h1 className={styles.name}>{displayName}</h1>
          {isDefault && (
            <span className={styles.defaultBadge}>{t("agent.default")}</span>
          )}
        </div>

        <div className={styles.statusLine}>
          <span
            className={`${styles.statusDot} ${
              agent.enabled ? styles.online : styles.offline
            }`}
          />
          <span className={styles.statusText}>
            {agent.enabled ? t("agent.online") : t("agent.offline")}
          </span>
          <span className={styles.separator}>·</span>
          <span className={styles.metaText}>
            {t("workbench.creator")}: admin
          </span>
          <span className={styles.separator}>·</span>
          <span className={styles.metaText}>
            {t("workbench.joinDate")}: —
          </span>
        </div>

        {agent.description && (
          <Tooltip title={agent.description} placement="topLeft">
            <p className={styles.desc}>{agent.description}</p>
          </Tooltip>
        )}

        {/* Hero Metrics */}
        <div className={styles.metrics}>
          <div className={styles.metric}>
            <span className={styles.metricValue}>—</span>
            <span className={styles.metricLabel}>
              {t("workbench.metricDocs")}
            </span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricValue}>—</span>
            <span className={styles.metricLabel}>
              {t("workbench.metricSkills")}
            </span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricValue}>—</span>
            <span className={styles.metricLabel}>
              {t("workbench.metricSop")}
            </span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricValue}>—</span>
            <span className={styles.metricLabel}>
              {t("workbench.metricJobs")}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className={styles.actions}>
          <Button
            type="primary"
            onClick={() => navigate("/chat")}
            className={styles.chatBtn}
          >
            {t("workbench.chat")}
          </Button>
          <Button
            onClick={() => navigate("/agents")}
            icon={<EditOutlined />}
            className={styles.editBtn}
          >
            {t("workbench.editProfile")}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default HeroSection;
