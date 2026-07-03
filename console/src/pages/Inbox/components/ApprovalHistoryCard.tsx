import { Card, Tag, Tooltip } from "antd";
import { Shield, Check, X, Clock, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMemo, useState, useCallback } from "react";
import { useAgentStore } from "../../../stores/agentStore";
import { getAgentDisplayName } from "../../../utils/agentDisplayName";
import type { ApprovalHistoryItem } from "../../../contexts/ApprovalContext";
import styles from "./ApprovalHistoryCard.module.less";

interface ApprovalHistoryCardProps {
  item: ApprovalHistoryItem;
}

const STATUS_CONFIG: Record<
  string,
  { color: string; icon: typeof Check; labelKey: string }
> = {
  approved: { color: "success", icon: Check, labelKey: "approval.statusApproved" },
  denied: { color: "error", icon: X, labelKey: "approval.statusDenied" },
  timeout: { color: "warning", icon: Clock, labelKey: "approval.statusTimeout" },
  cancelled: { color: "default", icon: X, labelKey: "approval.statusCancelled" },
  superseded: { color: "default", icon: Clock, labelKey: "approval.statusSuperseded" },
};

export function ApprovalHistoryCard({ item }: ApprovalHistoryCardProps) {
  const { t } = useTranslation();
  const agents = useAgentStore((state) => state.agents);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const agentsById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );

  const agentDisplayName = useMemo(() => {
    const matched = agentsById.get(item.agent_id);
    if (matched) return getAgentDisplayName(matched, t);
    return item.agent_id || t("common.unknown", "Unknown");
  }, [agentsById, item.agent_id, t]);

  const ownerAgentDisplayName = useMemo(() => {
    const ownerId = item.owner_agent_id || item.agent_id;
    const matched = agentsById.get(ownerId);
    if (matched) return getAgentDisplayName(matched, t);
    return ownerId || t("common.unknown", "Unknown");
  }, [agentsById, item.owner_agent_id, item.agent_id, t]);

  const statusConfig = STATUS_CONFIG[item.resolvedStatus] || STATUS_CONFIG.denied;
  const StatusIcon = statusConfig.icon;

  const createdDate = useMemo(
    () => new Date(item.created_at * 1000).toLocaleString(),
    [item.created_at],
  );

  const resolvedDate = useMemo(
    () =>
      item.resolvedAt
        ? new Date(item.resolvedAt * 1000).toLocaleString()
        : "-",
    [item.resolvedAt],
  );

  const handleCopy = useCallback(async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    } catch {
      /* clipboard not available */
    }
  }, []);

  const getSeverityColor = (sev: string) => {
    const s = sev.toLowerCase();
    if (s === "critical" || s === "high") return "error";
    if (s === "medium") return "warning";
    return "default";
  };

  const displayToolSource =
    item.tool_source && item.tool_source !== "builtin"
      ? item.tool_source
      : t("approval.builtinSource", "Built-in");

  return (
    <Card className={styles.historyCard} bordered={false}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <Shield size={16} className={styles.icon} />
          <span className={styles.title}>
            {item.tool_display_name || item.tool_name}
          </span>
        </div>
        <Tag
          icon={<StatusIcon size={12} />}
          color={statusConfig.color}
          className={styles.statusTag}
        >
          {t(statusConfig.labelKey, item.resolvedStatus)}
        </Tag>
      </div>

      <div className={styles.content}>
        <div className={styles.infoRow}>
          <span className={styles.label}>{t("approval.tool", "Tool")}:</span>
          <code className={styles.value}>{item.tool_name}</code>
        </div>

        <div className={styles.infoRow}>
          <span className={styles.label}>{t("approval.source", "Source")}:</span>
          <code className={styles.value}>{displayToolSource}</code>
        </div>

        <div className={styles.infoRow}>
          <span className={styles.label}>
            {t("approval.severity", "Severity")}:
          </span>
          <Tag color={getSeverityColor(item.severity)} className={styles.severityTag}>
            {item.severity.toUpperCase()}
          </Tag>
        </div>

        <div className={styles.infoRow}>
          <span className={styles.label}>
            {t("approval.ownerAgent", "Owner Agent")}:
          </span>
          <Tag color="success" className={styles.agentTag}>
            {ownerAgentDisplayName}
          </Tag>
        </div>

        {item.agent_id !== (item.owner_agent_id || item.agent_id) && (
          <div className={styles.infoRow}>
            <span className={styles.label}>
              {t("approval.executingAgent", "Executing Agent")}:
            </span>
            <Tag color="blue" className={styles.agentTag}>
              {agentDisplayName}
            </Tag>
          </div>
        )}

        {item.findings_summary && (
          <div className={styles.summaryBox}>
            <span className={styles.summaryText}>{item.findings_summary}</span>
            <button
              className={`${styles.copyButton} ${
                copiedField === "summary" ? styles.copied : ""
              }`}
              onClick={() => handleCopy(item.findings_summary, "summary")}
              title={t("common.copy", "Copy")}
            >
              <Copy size={12} />
            </button>
          </div>
        )}

        {item.tool_params && Object.keys(item.tool_params).length > 0 && (
          <details className={styles.paramsDetails}>
            <summary className={styles.paramsSummary}>
              {t("approval.parameters", "Parameters")}
            </summary>
            <div className={styles.paramsCodeWrapper}>
              <pre className={styles.paramsCode}>
                {JSON.stringify(item.tool_params, null, 2)}
              </pre>
              <button
                className={`${styles.copyButton} ${
                  copiedField === "params" ? styles.copied : ""
                }`}
                onClick={() =>
                  handleCopy(JSON.stringify(item.tool_params, null, 2), "params")
                }
                title={t("common.copy", "Copy")}
              >
                <Copy size={12} />
              </button>
            </div>
          </details>
        )}
      </div>

      <div className={styles.footer}>
        <Tooltip title={t("approval.createdAt", "Created at")}>
          <span className={styles.timeText}>{createdDate}</span>
        </Tooltip>
        <span className={styles.arrow}>→</span>
        <Tooltip title={t("approval.resolvedAt", "Resolved at")}>
          <span className={styles.timeText}>{resolvedDate}</span>
        </Tooltip>
        {item.scope && (
          <Tag className={styles.scopeTag}>
            {item.scope === "similar"
              ? t("approval.approvePattern", "Approve Pattern")
              : t("approval.approveExact", "Approve Exact")}
          </Tag>
        )}
      </div>
    </Card>
  );
}