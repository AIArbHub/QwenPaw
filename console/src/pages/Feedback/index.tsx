import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Empty,
  Input,
  Modal,
  Rate,
  Spin,
  Tag,
  message,
} from "antd";
import {
  StarOutlined,
  ReloadOutlined,
  StarFilled,
  ExperimentOutlined,
} from "@ant-design/icons";
import { PageHeader } from "@/components/PageHeader";
import feedbackApi, {
  type FeedbackSummary,
} from "@/api/modules/feedback";
import { useAgentStore } from "@/stores/agentStore";
import styles from "./index.module.less";

// ─── 评分反馈弹窗 ───────────────────────────────────────────────────────

interface FeedbackModalProps {
  open: boolean;
  agentId: string;
  onClose: () => void;
  onSubmitted: () => void;
}

function FeedbackModal({
  open,
  agentId,
  onClose,
  onSubmitted,
}: FeedbackModalProps) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (rating === 0) {
      message.warning("请选择评分");
      return;
    }
    setSubmitting(true);
    try {
      await feedbackApi.create({
        agent_id: agentId,
        rating,
        comment: comment || undefined,
      });
      message.success("评分已提交");
      setRating(0);
      setComment("");
      onSubmitted();
      onClose();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "提交失败",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title="评分反馈"
      onCancel={onClose}
      className={styles.feedbackModal}
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button
          key="submit"
          type="primary"
          loading={submitting}
          onClick={handleSubmit}
        >
          提交
        </Button>,
      ]}
    >
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
          评分
        </label>
        <Rate value={rating} onChange={setRating} count={5} />
      </div>
      <div>
        <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
          评论（可选）
        </label>
        <Input.TextArea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          autoSize={{ minRows: 3, maxRows: 6 }}
          placeholder="说说你的体验..."
        />
      </div>
    </Modal>
  );
}

// ── 归因分类标签映射 ──

const BUCKET_LABELS: Record<string, string> = {
  model_issue: "模型问题",
  skill_issue: "技能问题",
  tool_or_system_issue: "工具/系统问题",
  user_random_or_unclear: "用户随意或上下文不足",
  positive_or_resolved: "正向反馈",
  needs_model_analysis: "待模型分析",
  unknown: "未知",
};

const BUCKET_COLORS: Record<string, string> = {
  model_issue: "#722ed1",
  skill_issue: "#1677ff",
  tool_or_system_issue: "#fa8c16",
  user_random_or_unclear: "#8c8c8c",
  positive_or_resolved: "#52c41a",
  needs_model_analysis: "#faad14",
  unknown: "#d9d9d9",
};

// ─── 主页面 ──────────────────────────────────────────────────────────────

export default function FeedbackPage() {
  const { agents } = useAgentStore();
  const [summaries, setSummaries] = useState<FeedbackSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalAgentId, setModalAgentId] = useState("");

  const fetchSummaries = useCallback(async () => {
    if (!agents || agents.length === 0) return;
    setLoading(true);
    try {
      const results = await Promise.all(
        agents.map((agent) =>
          feedbackApi.getSummary(agent.id).catch(() => null),
        ),
      );
      setSummaries(
        results.filter(
          (r): r is FeedbackSummary => r !== null,
        ),
      );
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "加载评分数据失败",
      );
    } finally {
      setLoading(false);
    }
  }, [agents]);

  useEffect(() => {
    fetchSummaries();
  }, [fetchSummaries]);

  const handleAddFeedback = (agentId: string) => {
    setModalAgentId(agentId);
    setModalOpen(true);
  };

  // 找到 agent name
  const getAgentName = (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    return agent?.name || agentId;
  };

  return (
    <div className={styles.feedbackPage}>
      <PageHeader
        current="评分反馈"
        subRow={
          <div style={{ color: "var(--sd-muted)", fontSize: 13 }}>
            查看各智能体的用户评分汇总，提交新的评分反馈。
          </div>
        }
      />

      <div style={{ marginBottom: 16, display: "flex", justifyContent: "flex-end" }}>
        <Button
          icon={<ReloadOutlined />}
          onClick={fetchSummaries}
          loading={loading}
        >
          刷新
        </Button>
      </div>

      <Spin spinning={loading}>
        {summaries.length === 0 ? (
          <Empty description="暂无评分数据" />
        ) : (
          <div className={styles.ratingCards}>
            {summaries.map((summary) => {
              const total = summary.total_feedback || 1;
              return (
                <div key={summary.agent_id} className={styles.ratingCard}>
                  <div className={styles.ratingHeader}>
                    <span className={styles.agentName}>
                      {getAgentName(summary.agent_id)}
                    </span>
                    <span className={styles.avgRating}>
                      {summary.avg_rating.toFixed(1)}
                    </span>
                  </div>
                  <div className={styles.ratingBody}>
                    <div style={{ fontSize: 12, color: "var(--sd-muted)", marginBottom: 8 }}>
                      共 {summary.total_feedback} 条评分
                    </div>
                    {Object.entries(summary.rating_distribution)
                      .sort((a, b) => Number(b[0]) - Number(a[0]))
                      .map(([star, count]) => (
                        <div key={star} className={styles.ratingBar}>
                          <span className={styles.ratingBarLabel}>
                            {star}★
                          </span>
                          <div className={styles.ratingBarBar}>
                            <div
                              className={styles.ratingBarFill}
                              style={{
                                width: `${(count / total) * 100}%`,
                              }}
                            />
                          </div>
                          <span className={styles.ratingBarCount}>
                            {count}
                          </span>
                        </div>
                      ))}
                  </div>
                  {summary.recent_comments.length > 0 && (
                    <div className={styles.ratingFooter}>
                      {summary.recent_comments.slice(0, 3).map((c) => (
                        <div key={c.id} className={styles.commentItem}>
                          <div className={styles.commentText}>
                            {c.comment}
                          </div>
                          <div className={styles.commentMeta}>
                            <StarFilled style={{ color: "#ff9138", fontSize: 10 }} />
                            {c.rating}
                            <span>·</span>
                            {new Date(c.created_at).toLocaleDateString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                {summary.buckets && Object.keys(summary.buckets).length > 0 && (
                  <div className={styles.attributionSection}>
                    <div className={styles.attributionTitle}>
                      <ExperimentOutlined />
                      归因分布
                    </div>
                    {Object.entries(summary.buckets)
                      .sort((a, b) => b[1] - a[1])
                      .map(([bucket, count]) => {
                        const total = summary.total_feedback || 1;
                        const pct = ((count / total) * 100).toFixed(0);
                        return (
                          <div key={bucket} className={styles.attributionItem}>
                            <span
                              className={styles.attributionLabel}
                              style={{ color: BUCKET_COLORS[bucket] || "var(--sd-muted)" }}
                            >
                              {BUCKET_LABELS[bucket] || bucket}
                            </span>
                            <div className={styles.attributionBar}>
                              <div
                                className={styles.attributionBarFill}
                                style={{
                                  width: `${pct}%`,
                                  background: BUCKET_COLORS[bucket] || "var(--sd-accent)",
                                }}
                              />
                            </div>
                            <span className={styles.attributionCount}>
                              {count} ({pct}%)
                            </span>
                          </div>
                        );
                      })}
                  </div>
                )}
                {summary.top_down_summaries && summary.top_down_summaries.length > 0 && (
                  <div className={styles.downSummaries}>
                    <div className={styles.attributionTitle}>
                      <StarFilled style={{ color: "var(--sd-danger)" }} />
                      点踩摘要 (Top 5)
                    </div>
                    {summary.top_down_summaries.map((item, idx) => (
                      <div key={idx} className={styles.downSummaryItem}>
                        <Tag
                          color={BUCKET_COLORS[item.bucket] || "default"}
                          style={{ margin: 0, fontSize: 11 }}
                        >
                          {BUCKET_LABELS[item.bucket] || item.bucket}
                        </Tag>
                        <span className={styles.downSummaryText}>
                          {item.summary}
                        </span>
                        <span className={styles.downSummaryRating}>
                          {item.rating}★
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {summary.summary_text && (
                  <div className={styles.summaryText}>
                    {summary.summary_text}
                  </div>
                )}
                  <div className={styles.ratingFooter}>
                    <Button
                      size="small"
                      type="primary"
                      ghost
                      icon={<StarOutlined />}
                      onClick={() => handleAddFeedback(summary.agent_id)}
                    >
                      评分
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Spin>

      <FeedbackModal
        open={modalOpen}
        agentId={modalAgentId}
        onClose={() => setModalOpen(false)}
        onSubmitted={fetchSummaries}
      />
    </div>
  );
}
