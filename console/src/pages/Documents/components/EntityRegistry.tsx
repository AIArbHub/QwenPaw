import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Space,
  Tag,
  message,
  Tooltip,
  Popconfirm,
  Alert,
  Typography,
  Divider,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  MergeCellsOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  TeamOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { knowledgeApi } from "@/api/modules/knowledge";
import type { CodenameEntry } from "@/api/modules/knowledge";

const { Text } = Typography;

interface EntityRegistryProps {
  /** Optional case ID to filter entities by case */
  caseId?: string;
  /** Codename map ID if known */
  mapId?: string;
}

export default function EntityRegistry({
  caseId,
  mapId: initialMapId,
}: EntityRegistryProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<CodenameEntry[]>([]);
  const [mapId, setMapId] = useState<string | undefined>(initialMapId);
  const [strategy, setStrategy] = useState<"global" | "doc_level">("global");
  const [loading, setLoading] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<CodenameEntry | null>(null);
  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [mergeSource, setMergeSource] = useState<CodenameEntry[]>([]);
  const [form] = Form.useForm();
  const [mergeForm] = Form.useForm();

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await knowledgeApi.getCodenameMap(mapId);
      setEntries(res.entries);
      setMapId(res.map_id);
      setStrategy(res.strategy);
    } catch (e) {
      console.error("Failed to load codename map:", e);
      // If no map exists, entries will be empty
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [mapId]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const handleAdd = () => {
    setEditingEntry(null);
    form.resetFields();
    form.setFieldsValue({
      codename: `当事人${entries.length + 1}`,
      entity_type: "natural_person",
      aliases: [],
      context: "",
    });
    setEditModalOpen(true);
  };

  const handleEdit = (entry: CodenameEntry) => {
    setEditingEntry(entry);
    form.setFieldsValue(entry);
    setEditModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      let updated: CodenameEntry[];

      if (editingEntry) {
        updated = entries.map((e) =>
          e.original === editingEntry.original
            ? { ...e, ...values }
            : e,
        );
      } else {
        const newEntry: CodenameEntry = {
          original: values.original || values.codename,
          codename: values.codename,
          entity_type: values.entity_type || "",
          context: values.context || "",
          doc_ids: [],
          aliases: values.aliases || [],
        };
        updated = [...entries, newEntry];
      }

      if (mapId) {
        await knowledgeApi.updateCodenameMap(mapId, {
          entries: updated,
        });
      } else {
        const res = await knowledgeApi.createCodenameMap({
          strategy,
          entries: updated,
        });
        setMapId(res.map_id);
      }

      setEntries(updated);
      setEditModalOpen(false);
      message.success(t("documents.security.levelSaved"));
    } catch (e) {
      console.error("Failed to save entity:", e);
    }
  };

  const handleDelete = async (original: string) => {
    const updated = entries.filter((e) => e.original !== original);
    setEntries(updated);
    if (mapId) {
      try {
        await knowledgeApi.updateCodenameMap(mapId, { entries: updated });
      } catch (e) {
        console.error("Failed to delete entity:", e);
      }
    }
  };

  const handleMerge = async () => {
    if (!mapId || mergeSource.length < 2) return;
    try {
      const values = await mergeForm.validateFields();
      const res = await knowledgeApi.mergeCodenameEntries({
        map_id: mapId,
        source_entries: mergeSource.map((e) => ({
          original: e.original,
          codename: e.codename,
          context: e.context,
        })),
        merge_strategy: values.strategy || "prefer_existing",
      });

      setEntries(res.merged_entries);
      setMergeModalOpen(false);
      setMergeSource([]);
      mergeForm.resetFields();

      if (res.conflicts.length > 0) {
        message.warning(
          `${res.conflicts.length} conflicts detected — please review manually`,
        );
      } else {
        message.success("Aliases merged successfully");
      }
    } catch (e) {
      console.error("Merge failed:", e);
    }
  };

  const entityTypeColors: Record<string, string> = {
    natural_person: "blue",
    legal_entity: "purple",
    other: "default",
  };

  const statusIcons: Record<string, React.ReactNode> = {
    confirmed: <CheckCircleOutlined style={{ color: "#52c41a" }} />,
    pending: <WarningOutlined style={{ color: "#faad14" }} />,
      auto_merged: <MergeCellsOutlined style={{ color: "#1677ff" }} />,
  };

  const columns = [
    {
      title: t("documents.entityRegistry.entityId"),
      dataIndex: "original",
      width: 120,
      render: (v: string) => <Text code>{v}</Text>,
    },
    {
      title: t("documents.entityRegistry.codename"),
      dataIndex: "codename",
      width: 120,
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: t("documents.entityRegistry.entityType"),
      dataIndex: "entity_type",
      width: 100,
      render: (v: string) => (
        <Tag color={entityTypeColors[v] || "default"}>
          {t(`documents.entityRegistry.${v || "other"}`)}
        </Tag>
      ),
    },
    {
      title: t("documents.entityRegistry.aliases"),
      dataIndex: "aliases",
      render: (v: string[]) =>
        v && v.length > 0 ? (
          <Space size={4} wrap>
            {v.map((a, i) => (
              <Tag key={i} style={{ fontSize: 11 }}>
                {a}
              </Tag>
            ))}
          </Space>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: t("documents.entityRegistry.roleContexts"),
      dataIndex: "context",
      width: 150,
      render: (v: string) =>
        v ? <Text type="secondary">{v}</Text> : <Text type="secondary">-</Text>,
    },
    {
      title: t("documents.entityRegistry.documents"),
      dataIndex: "doc_ids",
      width: 80,
      render: (v: string[]) =>
        v && v.length > 0 ? (
          <Tooltip title={v.join(", ")}>
            <Tag>{v.length}</Tag>
          </Tooltip>
        ) : (
          <Text type="secondary">0</Text>
        ),
    },
    {
      title: t("documents.entityRegistry.actions"),
      width: 120,
      render: (_: unknown, record: CodenameEntry) => (
        <Space size="small">
          <Tooltip title={t("documents.rule.editRule")}>
            <Button
              size="small"
              type="text"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record)}
            />
          </Tooltip>
          <Popconfirm
            title="Delete this entity?"
            onConfirm={() => handleDelete(record.original)}
          >
            <Button
              size="small"
              type="text"
              danger
              icon={<DeleteOutlined />}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <Space>
          <TeamOutlined />
          <Text strong>
            {t("documents.entityRegistry.title", "实体注册表")}
          </Text>
          <Tag>{entries.length} entities</Tag>
          {caseId && <Tag color="blue">Case: {caseId}</Tag>}
        </Space>
        <Space>
          <Tooltip title={t("documents.entityRegistry.merge")}>
            <Button
              icon={<MergeCellsOutlined />}
              disabled={entries.length < 2}
              onClick={() => {
                setMergeSource(entries);
                mergeForm.setFieldsValue({ strategy: "prefer_existing" });
                setMergeModalOpen(true);
              }}
            >
              {t("documents.entityRegistry.merge")}
            </Button>
          </Tooltip>
          <Button icon={<ReloadOutlined />} onClick={loadEntries}>
            {t("documents.entityRegistry.conflictCheck")}
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleAdd}
          >
            {t("documents.entityRegistry.addEntity")}
          </Button>
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        message={t("documents.entityRegistry.relativeNaming")}
        description={t("documents.entityRegistry.roleAsAttribute")}
        style={{ marginBottom: 12 }}
      />

      <Table
        dataSource={entries}
        columns={columns}
        rowKey="original"
        size="small"
        loading={loading}
        pagination={{ pageSize: 10, showSizeChanger: false }}
        scroll={{ x: 800 }}
      />

      {/* ── Edit/Add Entity Modal ── */}
      <Modal
        title={
          editingEntry
            ? t("documents.rule.editRule")
            : t("documents.entityRegistry.addEntity")
        }
        open={editModalOpen}
        onOk={handleSave}
        onCancel={() => setEditModalOpen(false)}
        width={600}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="codename"
            label={t("documents.entityRegistry.codename")}
            rules={[{ required: true }]}
          >
            <Input placeholder="e.g. 当事人一" />
          </Form.Item>
          <Form.Item
            name="original"
            label={t("documents.entityRegistry.realName")}
          >
            <Input placeholder="真实姓名（加密存储）" />
          </Form.Item>
          <Form.Item
            name="entity_type"
            label={t("documents.entityRegistry.entityType")}
          >
            <Select
              options={[
                {
                  label: t("documents.entityRegistry.naturalPerson"),
                  value: "natural_person",
                },
                {
                  label: t("documents.entityRegistry.legalEntity"),
                  value: "legal_entity",
                },
                {
                  label: t("documents.entityRegistry.other"),
                  value: "other",
                },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="aliases"
            label={t("documents.entityRegistry.aliases")}
          >
            <Select
              mode="tags"
              placeholder="输入别名后回车，如：申请人、原告、张某"
            />
          </Form.Item>
          <Form.Item
            name="context"
            label={t("documents.entityRegistry.roleContexts")}
          >
            <Input.TextArea
              rows={2}
              placeholder='e.g. {"本请求": "申请人", "反请求": "被申请人"}'
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Merge Modal ── */}
      <Modal
        title={t("documents.entityRegistry.mergeAlias")}
        open={mergeModalOpen}
        onOk={handleMerge}
        onCancel={() => setMergeModalOpen(false)}
        width={500}
      >
        <Alert
          type="info"
          message={`Select ${mergeSource.length} entities to merge. Choose merge strategy:`}
          style={{ marginBottom: 12 }}
        />
        <Form form={mergeForm} layout="vertical">
          <Form.Item
            name="strategy"
            label={t("documents.entityRegistry.mergeStrategy")}
          >
            <Select
              options={[
                {
                  label: t("documents.entityRegistry.preferExisting"),
                  value: "prefer_existing",
                },
                {
                  label: t("documents.entityRegistry.preferNew"),
                  value: "prefer_new",
                },
                {
                  label: t("documents.entityRegistry.manual"),
                  value: "manual",
                },
              ]}
            />
          </Form.Item>
        </Form>
        <Divider />
        <div style={{ maxHeight: 300, overflowY: "auto" }}>
          {mergeSource.map((e) => (
            <div
              key={e.original}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "4px 0",
                borderBottom: "1px solid var(--ant-color-border-secondary)",
              }}
            >
              <Space>
                <Tag color="blue">{e.codename}</Tag>
                <Text type="secondary">{e.original}</Text>
              </Space>
              <Tag>{e.entity_type}</Tag>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
