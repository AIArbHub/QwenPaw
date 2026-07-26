import { useState, useCallback, useEffect } from "react";
import {
  Button,
  Drawer,
  Empty,
  Input,
  Spin,
  Tag,
  Timeline,
  message,
} from "antd";
import {
  PlayCircleOutlined,
  SearchOutlined,
  CheckCircleOutlined,
  ToolOutlined,
  ArrowRightOutlined,
  MessageOutlined,
} from "@ant-design/icons";
import type { SkillCard } from "@/api/modules/sop";
import sopApi from "@/api/modules/sop";

// ── 步骤图标映射 ──────────────────────────────────────────────────────

function stepIcon(action: string) {
  switch (action) {
    case "advanced":
    case "handoff":
      return <ArrowRightOutlined style={{ color: "#615ced" }} />;
    case "tool_called":
      return <ToolOutlined style={{ color: "#ff9138" }} />;
    case "knowledge_queried":
      return <SearchOutlined style={{ color: "#13c2c2" }} />;
    case "replied":
    case "asked_user":
    case "clarified":
      return <MessageOutlined style={{ color: "#2f54eb" }} />;
    case "completed":
      return <CheckCircleOutlined style={{ color: "#22c55e" }} />;
    default:
      return <PlayCircleOutlined style={{ color: "#8c8c8c" }} />;
  }
}

function stepColor(action: string): string {
  switch (action) {
    case "completed":
      return "green";
    case "tool_called":
      return "orange";
    case "knowledge_queried":
      return "cyan";
    case "replied":
      return "blue";
    case "advanced":
    case "handoff":
      return "purple";
    default:
      return "default";
  }
}

// ── 追踪面板 ──────────────────────────────────────────────────────────

interface TraceEntry {
  action: string;
  node: string;
  reasoning: string;
  timestamp: string;
}

interface TracePanelProps {
  open: boolean;
  skill: SkillCard | null;
  onClose: () => void;
}

export default function TracePanel({
  open,
  skill,
  onClose,
}: TracePanelProps) {
  const [sessionId, setSessionId] = useState("");
  const [running, setRunning] = useState(false);
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [userInput, setUserInput] = useState("");
  const [reply, setReply] = useState("");

  // 执行一步
  const handleStep = useCallback(async () => {
    if (!skill || !sessionId) {
      message.warning("请先输入会话 ID");
      return;
    }
    if (!userInput.trim()) {
      message.warning("请输入用户消息");
      return;
    }
    setRunning(true);
    try {
      const res = await sopApi.stepRuntime({
        session_id: sessionId,
        user_message: userInput,
        state: {},
      });
      setReply(res.reply || "");
      // 从 state.context._decisions 提取追踪
      const stateData = res.state as Record<string, unknown>;
      const context = (stateData?.context ?? {}) as Record<string, unknown>;
      const decisions = (context._decisions ?? []) as TraceEntry[];
      setTrace(decisions);
      setUserInput("");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "执行失败",
      );
    } finally {
      setRunning(false);
    }
  }, [skill, sessionId, userInput]);

  // 开始会话
  const handleStart = useCallback(async () => {
    if (!skill || !sessionId) {
      message.warning("请先输入会话 ID");
      return;
    }
    setLoading(true);
    try {
      await sopApi.startRuntime({
        session_id: sessionId,
        skill_id: skill.id,
      });
      message.success("会话已启动");
      setTrace([]);
      setReply("");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "启动失败",
      );
    } finally {
      setLoading(false);
    }
  }, [skill, sessionId]);

  // 清空
  const handleClear = () => {
    setTrace([]);
    setReply("");
    setUserInput("");
  };

  useEffect(() => {
    if (!open) {
      handleClear();
    }
  }, [open]);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={640}
      title={
        <span>
          执行追踪
          {skill && (
            <Tag style={{ marginLeft: 8 }}>{skill.name}</Tag>
          )}
        </span>
      }
    >
      {!skill ? (
        <Empty description="未选择技能" />
      ) : (
        <div>
          {/* 会话控制 */}
          <div
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 16,
            }}
          >
            <Input
              placeholder="会话 ID（如：trace_demo_001）"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              disabled={running || loading}
            />
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={loading}
              onClick={handleStart}
              disabled={!sessionId}
            >
              开始
            </Button>
          </div>

          {/* 用户输入 */}
          <div
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 16,
            }}
          >
            <Input
              placeholder="输入消息..."
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onPressEnter={handleStep}
              disabled={running}
            />
            <Button
              type="primary"
              loading={running}
              onClick={handleStep}
              disabled={!sessionId}
            >
              执行
            </Button>
          </div>

          {/* 回复 */}
          {reply && (
            <div
              style={{
                padding: "12px 16px",
                marginBottom: 16,
                background: "var(--sd-accent-soft, #eeeefc)",
                borderRadius: "var(--sd-radius-md, 14px)",
                border: "1px solid var(--sd-border, #e3e7f1)",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  color: "var(--sd-muted, #757f9c)",
                  marginBottom: 4,
                }}
              >
                Agent 回复
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--sd-ink, #18181a)",
                  lineHeight: 1.6,
                }}
              >
                {reply}
              </div>
            </div>
          )}

          {/* 追踪时间线 */}
          <Spin spinning={running}>
            {trace.length === 0 ? (
              <Empty
                description="暂无执行记录"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ) : (
              <Timeline
                items={trace.map((entry, idx) => ({
                  key: idx,
                  dot: stepIcon(entry.action),
                  children: (
                    <div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 4,
                        }}
                      >
                        <Tag color={stepColor(entry.action)}>
                          {entry.action}
                        </Tag>
                        {entry.node && (
                          <code
                            style={{
                              fontSize: 12,
                              color: "var(--sd-muted, #757f9c)",
                            }}
                          >
                            {entry.node}
                          </code>
                        )}
                      </div>
                      {entry.reasoning && (
                        <div
                          style={{
                            fontSize: 12,
                            color: "var(--sd-ink-soft, #464c5e)",
                            lineHeight: 1.5,
                          }}
                        >
                          {entry.reasoning}
                        </div>
                      )}
                    </div>
                  ),
                }))}
              />
            )}
          </Spin>
        </div>
      )}
    </Drawer>
  );
}
