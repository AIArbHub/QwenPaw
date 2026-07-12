/**
 * Case list view: shown when no case is selected.
 * Displays all cases as cards with search and create button.
 */
import { useState } from "react";
import { Button, Input, Empty, Popconfirm, Tag } from "antd";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import { Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";
import {
  type CaseStage,
  type MootCaseListItem,
} from "@/api/modules/moot";
import { useMootState } from "../hooks/useMootState";
import { CreateCaseModal } from "./CaseModals";
import styles from "../index.module.less";

function getStageColor(stage: CaseStage): string {
  if (stage === "closed") return "#8c8c8c";
  if (stage === "award") return "#52c41a";
  if (stage === "hearing" || stage === "deliberation") return "#1890ff";
  if (stage === "draft") return "#d9d9d9";
  return "#722ed1";
}

function formatDate(ts: number): string {
  return dayjs(ts * 1000).format("YYYY-MM-DD HH:mm");
}

interface CaseListViewProps {
  state: ReturnType<typeof useMootState>;
}

export function CaseListView({ state }: CaseListViewProps) {
  const { t } = useTranslation();
  const {
    filteredCases,
    caseSearch,
    setCaseSearch,
    loadCase,
    handleDelete,
    caseTemplates,
    arbitrationRules,
    collaborationPresetId,
    setCollaborationPresetId,
    handleCreate,
    loading,
  } = state;

  const [createModalOpen, setCreateModalOpen] = useState(false);

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Users style={{ fontSize: 20, color: "var(--ant-color-primary)" }} />
          <span className={styles.caseName}>
            {t("moot.title", "仲裁模拟实训")}
          </span>
        </div>
        <div className={styles.headerRight}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateModalOpen(true)}
          >
            {t("moot.createCase", "新建仲裁案")}
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className={styles.body}>
        <div className={styles.caseListView}>
          {filteredCases.length === 0 && !caseSearch ? (
            <div className={styles.emptyState}>
              <Users
                style={{
                  fontSize: 48,
                  color: "var(--ant-color-text-quaternary)",
                }}
              />
              <Empty
                description={t(
                  "moot.noCases",
                  "暂无仲裁模拟案，请创建新案件开始模拟仲裁实训",
                )}
              />
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setCreateModalOpen(true)}
              >
                {t("moot.createCase", "新建仲裁案")}
              </Button>
            </div>
          ) : (
            <div className={styles.caseList}>
              <Input.Search
                placeholder="按案件名称、规则、参与者检索"
                value={caseSearch}
                onChange={(e) => setCaseSearch(e.target.value)}
                style={{ marginBottom: 12 }}
              />
              {filteredCases.length === 0 ? (
                <div
                  className={styles.emptyState}
                  style={{ minHeight: 220 }}
                >
                  <Empty description="没有匹配的模拟仲裁案" />
                </div>
              ) : (
                filteredCases.map((c: MootCaseListItem) => (
                  <div
                    key={c.case_id}
                    className={styles.caseCard}
                    onClick={() => loadCase(c.case_id)}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className={styles.caseCardTitle}>{c.case_name}</div>
                      <div className={styles.caseCardMeta}>
                        <Tag color={getStageColor(c.current_stage)}>
                          {c.current_stage_label}
                        </Tag>
                        <span className={styles.caseCardMetaItem}>
                          {c.participants.length} 位参与者
                        </span>
                        <span className={styles.caseCardMetaItem}>
                          {c.message_count} 条消息
                        </span>
                        {c.rules.length > 0 && (
                          <span className={styles.caseCardMetaItem}>
                            {c.rules.length} 条规则
                          </span>
                        )}
                        <span className={styles.caseCardMetaItem}>
                          {formatDate(c.created_at)}
                        </span>
                      </div>
                    </div>
                    <Popconfirm
                      title="确认删除此仲裁案？"
                      onConfirm={(e) => {
                        e?.stopPropagation();
                        handleDelete(c.case_id);
                      }}
                      onCancel={(e) => e?.stopPropagation()}
                    >
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Popconfirm>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Create case modal */}
      <CreateCaseModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        templates={caseTemplates}
        rules={arbitrationRules}
        collaborationPresetId={collaborationPresetId}
        onPresetChange={setCollaborationPresetId}
        onCreate={handleCreate}
        loading={loading}
      />
    </div>
  );
}
