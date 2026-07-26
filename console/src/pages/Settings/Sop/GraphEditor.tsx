import { useState, useCallback, useRef } from "react";
import {
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Tag,
  message,
} from "antd";
import {
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
  ArrowRightOutlined,
} from "@ant-design/icons";
import type {
  SkillCard,
  SkillGraphNode,
  SkillGraphEdge,
  SkillNodeType,
} from "@/api/modules/sop";
import sopApi from "@/api/modules/sop";

// ── 节点类型颜色映射 ──────────────────────────────────────────────────

const NODE_COLORS: Record<SkillNodeType, string> = {
  start: "#22c55e",
  action: "#615ced",
  decision: "#722ed1",
  tool_call: "#ff9138",
  knowledge_query: "#13c2c2",
  reply: "#2f54eb",
  handoff: "#eb2f96",
  terminal: "#8c8c8c",
};

const NODE_LABELS: Record<SkillNodeType, string> = {
  start: "开始",
  action: "动作",
  decision: "决策",
  tool_call: "工具调用",
  knowledge_query: "知识查询",
  reply: "回复",
  handoff: "移交",
  terminal: "终止",
};

// ── 简单的 SVG 图编辑器 ──────────────────────────────────────────────

interface GraphEditorProps {
  open: boolean;
  skill: SkillCard | null;
  onClose: () => void;
  onSaved: () => void;
}

interface NodePosition {
  x: number;
  y: number;
}

export default function GraphEditor({
  open,
  skill,
  onClose,
  onSaved,
}: GraphEditorProps) {
  const [nodes, setNodes] = useState<SkillGraphNode[]>([]);
  const [edges, setEdges] = useState<SkillGraphEdge[]>([]);
  const [positions, setPositions] = useState<Record<string, NodePosition>>(
    {},
  );
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [editingNode, setEditingNode] = useState<SkillGraphNode | null>(
    null,
  );
  const [addingEdge, setAddingEdge] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const [form] = Form.useForm();

  // 初始化数据
  const initData = useCallback(() => {
    if (!skill) return;
    setNodes(skill.nodes || []);
    setEdges(skill.edges || []);

    // 自动布局：圆形排列
    const pos: Record<string, NodePosition> = {};
    const cx = 400;
    const cy = 300;
    const radius = 200;
    const count = skill.nodes?.length || 0;
    (skill.nodes || []).forEach((node, i) => {
      if (node.type === "start") {
        pos[node.id] = { x: cx, y: cy - radius };
      } else if (node.type === "terminal") {
        pos[node.id] = { x: cx, y: cy + radius };
      } else {
        const angle =
          (i / Math.max(count, 1)) * Math.PI * 2 - Math.PI / 2;
        pos[node.id] = {
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
        };
      }
    });
    setPositions(pos);
    setSelectedNode(null);
    setAddingEdge(null);
  }, [skill]);

  // 打开时初始化
  const handleAfterOpenChange = (open: boolean) => {
    if (open) {
      initData();
    }
  };

  // 添加节点
  const handleAddNode = () => {
    const id = `node_${Date.now()}`;
    const newNode: SkillGraphNode = {
      id,
      type: "action",
      title: "新节点",
      description: "",
      prompt_hint: "",
      tool_name: "",
      knowledge_scope: "",
      metadata: {},
    };
    setNodes([...nodes, newNode]);
    setPositions({
      ...positions,
      [id]: {
        x: 300 + Math.random() * 200,
        y: 200 + Math.random() * 200,
      },
    });
  };

  // 删除节点
  const handleDeleteNode = (nodeId: string) => {
    setNodes(nodes.filter((n) => n.id !== nodeId));
    setEdges(edges.filter((e) => e.from_node !== nodeId && e.to_node !== nodeId));
    const newPositions = { ...positions };
    delete newPositions[nodeId];
    setPositions(newPositions);
    if (selectedNode === nodeId) setSelectedNode(null);
  };

  // 添加边
  const handleAddEdge = (from: string, to: string) => {
    if (from === to) return;
    // 避免重复边
    if (edges.some((e) => e.from_node === from && e.to_node === to)) {
      message.warning("该连接已存在");
      return;
    }
    setEdges([
      ...edges,
      {
        from_node: from,
        to_node: to,
        condition: "",
        priority: edges.filter((e) => e.from_node === from).length,
      },
    ]);
    setAddingEdge(null);
  };

  // 拖拽节点
  const handleNodeDrag = (
    nodeId: string,
    e: React.MouseEvent,
  ) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;

    const onMouseMove = (ev: MouseEvent) => {
      if (!svgRef.current) return;
      const r = svgRef.current.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      setPositions((prev) => ({
        ...prev,
        [nodeId]: { x, y },
      }));
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);

    // 防止 startX/startY 未使用警告
    void startX;
    void startY;
  };

  // 保存
  const handleSave = async () => {
    if (!skill) return;
    setSaving(true);
    try {
    const updatedSkill: SkillCard = {
        ...skill,
        nodes,
        edges,
      };
      await sopApi.saveSkill(updatedSkill);
      message.success("流程图已保存");
      onSaved();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "保存失败",
      );
    } finally {
      setSaving(false);
    }
  };

  // 编辑节点
  const handleEditNode = (node: SkillGraphNode) => {
    setEditingNode(node);
    form.setFieldsValue({
      id: node.id,
      type: node.type,
      title: node.title,
      description: node.description,
      prompt_hint: node.prompt_hint,
      tool_name: node.tool_name,
      knowledge_scope: node.knowledge_scope,
    });
  };

  const handleSaveNode = async () => {
    try {
      const values = await form.validateFields();
      setNodes(nodes.map((n) =>
        n.id === editingNode?.id
          ? {
              ...n,
              ...values,
            }
          : n
      ));
      setEditingNode(null);
      message.success("节点已更新");
    } catch {
      // 校验失败
    }
  };

  // 绘制 SVG 边
  const renderEdge = (edge: SkillGraphEdge, idx: number) => {
    const from = positions[edge.from_node];
    const to = positions[edge.to_node];
    if (!from || !to) return null;

    const dx = to.x - from.x;
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;

    // 贝塞尔曲线
    const ctrlX1 = from.x + dx * 0.5;
    const ctrlY1 = from.y;
    const ctrlX2 = to.x - dx * 0.5;
    const ctrlY2 = to.y;
    const path = `M ${from.x} ${from.y} C ${ctrlX1} ${ctrlY1}, ${ctrlX2} ${ctrlY2}, ${to.x} ${to.y}`;

    return (
      <g key={idx}>
        <path
          d={path}
          fill="none"
          stroke="var(--sd-muted-2, #858b9c)"
          strokeWidth={2}
          markerEnd="url(#arrowhead)"
        />
        {edge.condition && (
          <text
            x={midX}
            y={midY - 8}
            textAnchor="middle"
            fill="var(--sd-muted, #757f9c)"
            fontSize={11}
          >
            {edge.condition}
          </text>
        )}
      </g>
    );
  };

  // 绘制 SVG 节点
  const renderNode = (node: SkillGraphNode) => {
    const pos = positions[node.id];
    if (!pos) return null;
    const color = NODE_COLORS[node.type] || "#8c8c8c";
    const isSelected = selectedNode === node.id;
    const isAddingEdgeFrom = addingEdge === node.id;

    return (
      <g
        key={node.id}
        transform={`translate(${pos.x}, ${pos.y})`}
        style={{ cursor: "pointer" }}
        onMouseDown={(e) => handleNodeDrag(node.id, e)}
        onClick={(e) => {
          e.stopPropagation();
          if (addingEdge && addingEdge !== node.id) {
            handleAddEdge(addingEdge, node.id);
          } else {
            setSelectedNode(node.id);
          }
        }}
      >
        <circle
          r={isSelected ? 32 : 28}
          fill={isAddingEdgeFrom ? "var(--sd-accent, #615ced)" : "var(--sd-surface, #ffffff)"}
          stroke={color}
          strokeWidth={3}
          fillOpacity={isAddingEdgeFrom ? 0.2 : 1}
        />
        <text
          y={4}
          textAnchor="middle"
          fill={isAddingEdgeFrom ? "var(--sd-accent, #615ced)" : color}
          fontSize={12}
          fontWeight={600}
        >
          {NODE_LABELS[node.type]}
        </text>
        <text
          y={48}
          textAnchor="middle"
          fill="var(--sd-ink, #18181a)"
          fontSize={11}
        >
          {node.title || node.id}
        </text>
      </g>
    );
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="80%"
      title={
        <Space>
          <span>流程图编辑器</span>
          {skill && <Tag>{skill.name}</Tag>}
        </Space>
      }
      extra={
        <Space>
          <Button
            icon={<PlusOutlined />}
            onClick={handleAddNode}
            disabled={!skill}
          >
            添加节点
          </Button>
          {addingEdge ? (
            <Button
              type="primary"
              ghost
              onClick={() => setAddingEdge(null)}
            >
              取消连线
            </Button>
          ) : (
            <Button
              icon={<ArrowRightOutlined />}
              onClick={() => {
                if (selectedNode) {
                  setAddingEdge(selectedNode);
                } else {
                  message.warning("请先选择一个节点");
                }
              }}
              disabled={!skill || !selectedNode}
            >
              连线
            </Button>
          )}
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            onClick={handleSave}
            disabled={!skill}
          >
            保存
          </Button>
        </Space>
      }
      afterOpenChange={handleAfterOpenChange}
    >
      {!skill ? (
        <Empty description="未选择技能" />
      ) : (
        <div style={{ display: "flex", gap: 16, height: "100%" }}>
          {/* SVG 画布 */}
          <div
            style={{
              flex: 1,
              background: "var(--sd-bg, #f7f5ef)",
              borderRadius: "var(--sd-radius-md, 14px)",
              overflow: "hidden",
              position: "relative",
            }}
          >
            <svg
              ref={svgRef}
              width="100%"
              height="600"
              onClick={() => setSelectedNode(null)}
            >
              <defs>
                <marker
                  id="arrowhead"
                  markerWidth="10"
                  markerHeight="7"
                  refX="8"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon
                    points="0 0, 10 3.5, 0 7"
                    fill="var(--sd-muted-2, #858b9c)"
                  />
                </marker>
              </defs>
              {edges.map((edge, idx) => renderEdge(edge, idx))}
              {nodes.map((node) => renderNode(node))}
            </svg>
          </div>

          {/* 右侧属性面板 */}
          <div
            style={{
              width: 280,
              flexShrink: 0,
              padding: 16,
              background: "var(--sd-surface, #ffffff)",
              borderRadius: "var(--sd-radius-md, 14px)",
              border: "1px solid var(--sd-border, #e3e7f1)",
              overflowY: "auto",
            }}
          >
            {selectedNode ? (
              <div>
                <h3 style={{ marginBottom: 16, color: "var(--sd-ink)" }}>
                  节点属性
                </h3>
                {(() => {
                  const node = nodes.find((n) => n.id === selectedNode);
                  if (!node) return null;
                  return (
                    <Space direction="vertical" style={{ width: "100%" }} size="middle">
                      <div>
                        <Tag color={NODE_COLORS[node.type]}>
                          {NODE_LABELS[node.type]}
                        </Tag>
                      </div>
                      <div>
                        <strong>标题：</strong>
                        {node.title || "(未命名)"}
                      </div>
                      {node.description && (
                        <div style={{ fontSize: 12, color: "var(--sd-muted)" }}>
                          {node.description}
                        </div>
                      )}
                      {node.tool_name && (
                        <div>
                          <strong>工具：</strong>
                          <code>{node.tool_name}</code>
                        </div>
                      )}
                      {node.knowledge_scope && (
                        <div>
                          <strong>知识范围：</strong>
                          {node.knowledge_scope}
                        </div>
                      )}
                      {node.prompt_hint && (
                        <div style={{ fontSize: 12, background: "var(--sd-surface-muted)", padding: 8, borderRadius: 8 }}>
                          {node.prompt_hint}
                        </div>
                      )}
                      <Space>
                        <Button
                          size="small"
                          type="primary"
                          ghost
                          onClick={() => handleEditNode(node)}
                        >
                          编辑
                        </Button>
                        <Button
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => handleDeleteNode(node.id)}
                        >
                          删除
                        </Button>
                      </Space>
                    </Space>
                  );
                })()}
              </div>
            ) : (
              <Empty
                description="点击节点查看属性"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            )}
          </div>
        </div>
      )}

      {/* 节点编辑弹窗 */}
      <Modal
        open={editingNode !== null}
        title="编辑节点"
        onCancel={() => setEditingNode(null)}
        onOk={handleSaveNode}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="id" label="节点 ID">
            <Input disabled />
          </Form.Item>
          <Form.Item name="type" label="类型">
            <Select
              options={Object.entries(NODE_LABELS).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </Form.Item>
          <Form.Item name="title" label="标题">
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} />
          </Form.Item>
          <Form.Item name="prompt_hint" label="提示词">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} />
          </Form.Item>
          <Form.Item name="tool_name" label="工具名称">
            <Input />
          </Form.Item>
          <Form.Item name="knowledge_scope" label="知识范围">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </Drawer>
  );
}
