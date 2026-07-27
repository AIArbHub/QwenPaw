import { Collapse, Timeline, Tag, Typography } from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import type { TraceStep } from "@/api/modules/kb";

const { Text } = Typography;

/**
 * 检索调试面板 — 展示后端返回的 trace（检索路由追踪）。
 *
 * v5.0: 借鉴 StaffDeck KnowledgeSearchDebug，用 antd Collapse + Timeline 可视化多级漏斗路由。
 */
function SearchDebugPanel({ trace }: { trace: TraceStep[] | undefined }) {
  if (!trace || trace.length === 0) {
    return null;
  }

  return (
    <Collapse
      ghost
      size="small"
      style={{ marginTop: 8 }}
      items={[
        {
          key: "debug",
          label: (
            <span
              style={{
                fontSize: 12,
                color: "var(--sd-muted)",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <SearchOutlined />
              检索路由追踪（{trace.length} 步）
            </span>
          ),
          children: (
            <Timeline
              size="small"
              items={trace.map((t: TraceStep, i: number) => {
                const isFailed = t.phase?.includes("failed");
                const phaseLabel = _phaseLabel(t.phase);
                return {
                  dot: isFailed ? (
                    <CloseCircleOutlined style={{ color: "#ff4d4f" }} />
                  ) : (
                    <CheckCircleOutlined style={{ color: "#52c41a" }} />
                  ),
                  children: (
                    <div>
                      <Text
                        strong
                        style={{ fontSize: 12, color: "var(--sd-ink)" }}
                      >
                        {phaseLabel}
                      </Text>
                      {t.hit_count !== undefined && (
                        <Tag style={{ marginInlineStart: 6, fontSize: 11 }}>
                          {t.hit_count} 命中
                        </Tag>
                      )}
                      {t.candidate_count !== undefined && (
                        <Tag style={{ fontSize: 11 }}>
                          {t.candidate_count} 候选
                        </Tag>
                      )}
                      {t.result_count !== undefined && (
                        <Tag color="blue" style={{ fontSize: 11 }}>
                          {t.result_count} 结果
                        </Tag>
                      )}
                      {t.selected && t.selected.length > 0 && (
                        <Tag color="geekblue" style={{ fontSize: 11 }}>
                          选中 {t.selected.length} 文档
                        </Tag>
                      )}
                      {t.message && (
                        <div>
                          <Text
                            type="danger"
                            style={{ fontSize: 11 }}
                          >
                            {t.message}
                          </Text>
                        </div>
                      )}
                    </div>
                  ),
                };
              })}
            />
          ),
        },
      ]}
    />
  );
}

function _phaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    concept_search: "概念搜索",
    document_load: "文档加载",
    document_route_llm: "LLM 文档路由",
    document_route_llm_failed: "LLM 文档路由失败",
    document_route_lexical: "词法文档路由",
    chunk_rank: "Chunk 排序",
  };
  return labels[phase] || phase;
}

export default SearchDebugPanel;
