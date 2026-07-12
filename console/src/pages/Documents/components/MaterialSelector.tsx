import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Modal,
  Input,
  Tree,
  Button,
  Space,
  Tag,
  Alert,
  Typography,
  Segmented,
  Empty,
  Spin,
  Tooltip,
} from "antd";
import {
  SearchOutlined,
  FileTextOutlined,
  SafetyOutlined,
  LockOutlined,
  FolderOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons";
import { knowledgeApi } from "@/api/modules/knowledge";
import { casesApi } from "@/api/modules/cases";
import type { KnowledgeDoc } from "@/api/modules/knowledge";
import type { CaseRef } from "@/api/modules/cases";

const { Text } = Typography;

interface MaterialSelectorProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (selected: SelectedMaterial[]) => void;
  /** Optional case filter */
  defaultCaseId?: string;
}

export interface SelectedMaterial {
  docId: string;
  name: string;
  version: "desensitized" | "original";
  caseId?: string;
}

type FilterMode = "all" | "verified" | "desensitized" | "pending";

export default function MaterialSelector({
  open,
  onClose,
  onConfirm,
  defaultCaseId,
}: MaterialSelectorProps) {
  const { t } = useTranslation();
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [cases, setCases] = useState<CaseRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("verified");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [versionMap, setVersionMap] = useState<
    Record<string, "desensitized" | "original">
  >({});

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [docsRes, casesRes] = await Promise.all([
        knowledgeApi.listDocs(),
        casesApi.listCases().catch(() => ({ cases: [] as CaseRef[], total: 0 })),
      ]);
      setDocs(docsRes.docs);
      setCases(casesRes.cases);
    } catch (e) {
      console.error("Failed to load materials:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadData();
      setSelectedKeys([]);
      setVersionMap({});
    }
  }, [open, loadData]);

  // Filter docs based on search and filter mode
  const filteredDocs = useMemo(() => {
    let result = docs;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.category?.toLowerCase().includes(q) ||
          d.tags?.some((tag) => tag.toLowerCase().includes(q)),
      );
    }

    switch (filterMode) {
      case "verified":
        result = result.filter((d) => d.desensitized && d.status === "ready");
        break;
      case "desensitized":
        result = result.filter((d) => d.desensitized);
        break;
      case "pending":
        result = result.filter((d) => !d.desensitized);
        break;
    }

    return result;
  }, [docs, searchQuery, filterMode]);

  // Group docs by case
  const treeData = useMemo(() => {
    // Group by category (case-like grouping)
    const groups: Record<string, KnowledgeDoc[]> = {};
    for (const doc of filteredDocs) {
      const groupKey = doc.category || t("documents.materialSelector.all");
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(doc);
    }

    return Object.entries(groups).map(([groupKey, groupDocs]) => ({
      key: `group-${groupKey}`,
      title: (
        <Space>
          <FolderOutlined />
          <span>{groupKey}</span>
          <Tag>{groupDocs.length}</Tag>
        </Space>
      ),
      selectable: false,
      children: groupDocs.map((doc) => ({
        key: doc.id,
        title: (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Space size={4}>
              {doc.desensitized ? (
                <SafetyOutlined style={{ color: "#52c41a" }} />
              ) : (
                <FileTextOutlined style={{ color: "#faad14" }} />
              )}
              <span>{doc.name}</span>
            </Space>
            <Space size={4}>
              {doc.desensitized && doc.status === "ready" && (
                <Tag color="green" style={{ fontSize: 10 }}>
                  ✓ {t("documents.materialSelector.verified")}
                </Tag>
              )}
              {doc.desensitized && doc.status !== "ready" && (
                <Tag color="blue" style={{ fontSize: 10 }}>
                  {t("documents.materialSelector.desensitized")}
                </Tag>
              )}
              {!doc.desensitized && (
                <Tag color="orange" style={{ fontSize: 10 }}>
                  {t("documents.materialSelector.pending")}
                </Tag>
              )}
              <VersionSelector
                docId={doc.id}
                desensitized={doc.desensitized}
                versionMap={versionMap}
                onChange={(v) =>
                  setVersionMap((prev) => ({ ...prev, [doc.id]: v }))
                }
              />
            </Space>
          </div>
        ),
        isLeaf: true,
      })),
    }));
  }, [filteredDocs, versionMap, t]);

  const selectedDocs = useMemo(() => {
    return selectedKeys
      .map((id) => docs.find((d) => d.id === id))
      .filter(Boolean) as KnowledgeDoc[];
  }, [selectedKeys, docs]);

  const hasOriginalSelected = selectedDocs.some(
    (d) => versionMap[d.id] === "original",
  );

  const handleConfirm = () => {
    const result: SelectedMaterial[] = selectedDocs.map((doc) => ({
      docId: doc.id,
      name: doc.name,
      version: versionMap[doc.id] || "desensitized",
      caseId: defaultCaseId,
    }));
    onConfirm(result);
    onClose();
  };

  return (
    <Modal
      title={
        <Space>
          <SearchOutlined />
          {t("documents.materialSelector.title")}
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={720}
      footer={
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Text type="secondary">
            {t("documents.materialSelector.selected", {
              count: selectedKeys.length,
            })}
          </Text>
          <Space>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              type="primary"
              disabled={selectedKeys.length === 0}
              onClick={handleConfirm}
            >
              {t("documents.materialSelector.confirm")}
            </Button>
          </Space>
        </div>
      }
    >
      {/* Search bar */}
      <Input.Search
        placeholder={t("documents.materialSelector.search")}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        style={{ marginBottom: 12 }}
        allowClear
      />

      {/* Filter mode */}
      <Segmented
        value={filterMode}
        onChange={(v) => setFilterMode(v as FilterMode)}
        options={[
          {
            label: t("documents.materialSelector.verified"),
            value: "verified",
          },
          {
            label: t("documents.materialSelector.desensitized"),
            value: "desensitized",
          },
          {
            label: t("documents.materialSelector.pending"),
            value: "pending",
          },
          {
            label: t("documents.materialSelector.all"),
            value: "all",
          },
        ]}
        style={{ marginBottom: 12 }}
      />

      {/* Original version warning */}
      {hasOriginalSelected && (
        <Alert
          type="warning"
          showIcon
          icon={<ExclamationCircleOutlined />}
          message={t("documents.materialSelector.warningOriginal")}
          style={{ marginBottom: 12 }}
        />
      )}

      {/* Document tree */}
      <Spin spinning={loading}>
        {filteredDocs.length === 0 ? (
          <Empty description="No documents found" />
        ) : (
          <div style={{ maxHeight: 400, overflowY: "auto" }}>
            <Tree
              checkable
              checkedKeys={selectedKeys}
              onCheck={(keys) =>
                setSelectedKeys((keys as string[]).filter((k) => !k.startsWith("group-")))
              }
              treeData={treeData}
              defaultExpandAll
              selectable={false}
            />
          </div>
        )}
      </Spin>
    </Modal>
  );
}

// ── Version selector sub-component ──
function VersionSelector({
  docId,
  desensitized,
  versionMap,
  onChange,
}: {
  docId: string;
  desensitized: boolean;
  versionMap: Record<string, "desensitized" | "original">;
  onChange: (v: "desensitized" | "original") => void;
}) {
  const { t } = useTranslation();
  const current = versionMap[docId] || "desensitized";

  if (!desensitized) {
    return (
      <Tooltip title={t("documents.version.originalForbidden")}>
        <Tag icon={<LockOutlined />} style={{ fontSize: 10 }}>
          {t("documents.version.original")}
        </Tag>
      </Tooltip>
    );
  }

  return (
    <Segmented
      size="small"
      value={current}
      onChange={(v) => onChange(v as "desensitized" | "original")}
      options={[
        {
          label: (
            <Tooltip title={t("documents.version.desensitized")}>
              <SafetyOutlined style={{ fontSize: 11 }} />
            </Tooltip>
          ),
          value: "desensitized",
        },
        {
          label: (
            <Tooltip title={t("documents.version.original")}>
              <LockOutlined style={{ fontSize: 11 }} />
            </Tooltip>
          ),
          value: "original",
        },
      ]}
    />
  );
}
