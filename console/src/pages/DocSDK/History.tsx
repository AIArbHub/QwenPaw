import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  Table,
  Tag,
  Modal,
  Button,
  Select,
  Input,
  Space,
  Spin,
  Empty,
  Popconfirm,
  Statistic,
  Row,
  Col,
  message,
} from "antd";
import {
  SearchOutlined,
  EyeOutlined,
  DownloadOutlined,
  DeleteOutlined,
  ExportOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  FieldTimeOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { docProcessingApi } from "@/api/modules/docProcessing";
import type { HistoryItem } from "@/api/modules/docProcessing";
import { MarkdownCopy } from "@/components/MarkdownCopy/MarkdownCopy";

/* ── Status display config ─────────────────────────────────────────── */

const STATUS_COLOR_MAP: Record<string, string> = {
  completed: "green",
  success: "green",
  failed: "red",
  processing: "blue",
  cancelled: "orange",
};

/* ── Component ─────────────────────────────────────────────────────── */

export default function DocSDKHistory() {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [statistics, setStatistics] = useState({
    total: 0,
    success: 0,
    failed: 0,
    today_count: 0,
  });

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [fileTypeFilter, setFileTypeFilter] = useState<string>("all");
  const [searchText, setSearchText] = useState("");

  const [detailVisible, setDetailVisible] = useState(false);
  const [detailItem, setDetailItem] = useState<HistoryItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  /* ── Fetch history ───────────────────────────────────────────────── */

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const data: any = await docProcessingApi.listHistory();
      // API may return { items, statistics }, { records, stats }, or a bare array
      const list = Array.isArray(data) ? data : (data?.items ?? data?.records ?? []);
      const stats = Array.isArray(data) ? {} : (data?.statistics ?? data?.stats ?? {});
      setItems(list);
      setStatistics({
        total: stats.total ?? list.length,
        success: stats.success ?? list.filter((i: any) => i.status === "completed").length,
        failed: stats.failed ?? list.filter((i: any) => i.status === "failed").length,
        today_count: stats.today_count ?? 0,
      });
    } catch (err) {
      message.error(t("docSdk.history.loadFailed"));
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  /* ── Derived values ─────────────────────────────────────────────── */

  const successRate = useMemo(() => {
    if (statistics.total === 0) return 0;
    return Math.round((statistics.success / statistics.total) * 100);
  }, [statistics]);

  const avgProcessingTime = useMemo(() => {
    const completed = items.filter(
      (item) => item.status === "completed" && item.processing_time != null,
    );
    if (completed.length === 0) return 0;
    const sum = completed.reduce((acc, item) => acc + (item.processing_time ?? 0), 0);
    return Math.round(sum / completed.length);
  }, [items]);

  /* ── Extract file extension ─────────────────────────────────────── */

  function getFileExtension(fileName: string): string {
    const idx = fileName.lastIndexOf(".");
    return idx > 0 ? fileName.slice(idx + 1).toLowerCase() : "";
  }

  const fileTypeOptions = useMemo(() => {
    const exts = new Set(items.map((item) => getFileExtension(item.file_name)));
    return [
      { value: "all", label: t("docSdk.history.allTypes") },
      ...Array.from(exts)
        .sort()
        .map((ext) => ({ value: ext, label: ext.toUpperCase() })),
    ];
  }, [items, t]);

  /* ── Filtered items ─────────────────────────────────────────────── */

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (fileTypeFilter !== "all") {
        const ext = getFileExtension(item.file_name);
        if (ext !== fileTypeFilter) return false;
      }
      if (searchText.trim()) {
        const keyword = searchText.trim().toLowerCase();
        return (
          item.file_name.toLowerCase().includes(keyword) ||
          item.engine.toLowerCase().includes(keyword)
        );
      }
      return true;
    });
  }, [items, statusFilter, fileTypeFilter, searchText]);

  /* ── View detail ────────────────────────────────────────────────── */

  const handleViewDetail = useCallback(
    async (record: HistoryItem) => {
      setDetailItem(record);
      setDetailVisible(true);
      setDetailLoading(true);
      try {
        const detail = await docProcessingApi.getHistoryDetail(record.task_id);
        setDetailItem(detail);
      } catch (err) {
        console.error(err);
        // Keep the original record on error
      } finally {
        setDetailLoading(false);
      }
    },
    [],
  );

  /* ── Download ──────────────────────────────────────────────────── */

  const handleDownload = useCallback(
    (taskId: string) => {
      window.open(`/api/doc/download/${encodeURIComponent(taskId)}/text`, "_blank");
    },
    [],
  );

  /* ── Delete ─────────────────────────────────────────────────────── */

  const handleDelete = useCallback(
    async (taskId: string) => {
      setDeletingId(taskId);
      try {
        await docProcessingApi.deleteHistory(taskId);
        message.success(t("docSdk.history.deleteSuccess"));
        fetchHistory();
      } catch (err) {
        message.error(t("docSdk.history.deleteFailed"));
        console.error(err);
      } finally {
        setDeletingId(null);
      }
    },
    [t, fetchHistory],
  );

  /* ── Export ─────────────────────────────────────────────────────── */

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const result = await docProcessingApi.exportHistory("json");
      const blob = new Blob([result.data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `doc_history_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      message.success(t("docSdk.history.exportSuccess"));
    } catch (err) {
      message.error(t("docSdk.history.exportFailed"));
      console.error(err);
    } finally {
      setExporting(false);
    }
  }, [t]);

  /* ── Format processing time ──────────────────────────────────────── */

  function formatTime(seconds: number): string {
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const min = Math.floor(seconds / 60);
    const sec = (seconds % 60).toFixed(0);
    return `${min}m ${sec}s`;
  }

  /* ── Format date ────────────────────────────────────────────────── */

  function formatDate(dateStr: string): string {
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return dateStr;
    }
  }

  /* ── Format file size ──────────────────────────────────────────── */

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /* ── Table columns ───────────────────────────────────────────────── */

  const columns = [
    {
      title: t("docSdk.history.colFileName"),
      dataIndex: "file_name",
      key: "file_name",
      ellipsis: true,
      width: 220,
    },
    {
      title: t("docSdk.history.colStatus"),
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (status: string) => (
        <Tag color={STATUS_COLOR_MAP[status] ?? "default"}>
          {t(`docSdk.history.status.${status}`)}
        </Tag>
      ),
    },
    {
      title: t("docSdk.history.colEngine"),
      dataIndex: "engine",
      key: "engine",
      width: 120,
    },
    {
      title: t("docSdk.history.colProcessingTime"),
      key: "processing_time",
      width: 120,
      render: (_: any, record: HistoryItem) =>
        record.processing_time != null ? formatTime(record.processing_time) : "-",
    },
    {
      title: t("docSdk.history.colCreatedAt"),
      dataIndex: "created_at",
      key: "created_at",
      width: 180,
      render: (val: string) => formatDate(val),
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 180,
      render: (_: any, record: HistoryItem) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handleViewDetail(record)}
          >
            {t("common.view")}
          </Button>
          {record.status === "completed" && (
            <Button
              type="link"
              size="small"
              icon={<DownloadOutlined />}
              onClick={() => handleDownload(record.task_id)}
            >
              {t("common.download")}
            </Button>
          )}
          <Popconfirm
            title={t("docSdk.history.confirmDelete")}
            onConfirm={() => handleDelete(record.task_id)}
            okText={t("common.confirm")}
            cancelText={t("common.cancel")}
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              loading={deletingId === record.task_id}
            >
              {t("common.delete")}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  /* ── Loading state ──────────────────────────────────────────────── */

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 64 }}>
        <Spin size="large" />
      </div>
    );
  }

  /* ── Render ────────────────────────────────────────────────────── */

  return (
    <div>
      {/* Statistics cards */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title={t("docSdk.history.statTotalDocs")}
              value={statistics.total}
              prefix={<FileTextOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title={t("docSdk.history.statSuccessRate")}
              value={successRate}
              suffix="%"
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: successRate >= 80 ? "#52c41a" : "#faad14" }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title={t("docSdk.history.statTodayCount")}
              value={statistics.today_count}
              prefix={<ClockCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title={t("docSdk.history.statAvgTime")}
              value={avgProcessingTime}
              suffix="s"
              prefix={<FieldTimeOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {/* Filters & actions */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            style={{ width: 140 }}
            options={[
              { value: "all", label: t("docSdk.history.allStatuses") },
              { value: "completed", label: t("docSdk.history.status.completed") },
              { value: "failed", label: t("docSdk.history.status.failed") },
              { value: "processing", label: t("docSdk.history.status.processing") },
              { value: "cancelled", label: t("docSdk.history.status.cancelled") },
            ]}
          />
          <Select
            value={fileTypeFilter}
            onChange={setFileTypeFilter}
            style={{ width: 120 }}
            options={fileTypeOptions}
          />
          <Input
            prefix={<SearchOutlined />}
            placeholder={t("docSdk.history.searchPlaceholder")}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 220 }}
            allowClear
          />
          <div style={{ flex: 1 }} />
          <Button
            icon={<ExportOutlined />}
            loading={exporting}
            onClick={handleExport}
          >
            {t("docSdk.history.export")}
          </Button>
        </Space>
      </Card>

      {/* Table */}
      <Card size="small">
        {filteredItems.length === 0 ? (
          <Empty description={t("docSdk.history.noHistory")} />
        ) : (
          <Table
            rowKey="task_id"
            columns={columns}
            dataSource={filteredItems}
            size="small"
            pagination={{
              pageSize: 10,
              showSizeChanger: true,
              showTotal: (total) =>
                t("docSdk.history.totalItems", { count: total }),
            }}
          />
        )}
      </Card>

      {/* Detail Modal */}
      <Modal
        title={t("docSdk.history.detailTitle")}
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={[
          <Button key="close" onClick={() => setDetailVisible(false)}>
            {t("common.close")}
          </Button>,
          ...(detailItem?.status === "completed"
            ? [
                <Button
                  key="download"
                  type="primary"
                  icon={<DownloadOutlined />}
                  onClick={() =>
                    detailItem && handleDownload(detailItem.task_id)
                  }
                >
                  {t("common.download")}
                </Button>,
              ]
            : []),
        ]}
        width={720}
      >
        {detailLoading ? (
          <div style={{ textAlign: "center", padding: 32 }}>
            <Spin />
          </div>
        ) : detailItem ? (
          <div>
            {/* Metadata */}
            <Card size="small" style={{ marginBottom: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <span style={{ color: "#888" }}>{t("docSdk.history.colFileName")}:</span>{" "}
                  <span style={{ fontWeight: 500 }}>{detailItem.file_name}</span>
                </div>
                <div>
                  <span style={{ color: "#888" }}>{t("docSdk.history.colStatus")}:</span>{" "}
                  <Tag color={STATUS_COLOR_MAP[detailItem.status]}>
                    {t(`docSdk.history.status.${detailItem.status}`)}
                  </Tag>
                </div>
                <div>
                  <span style={{ color: "#888" }}>{t("docSdk.history.colEngine")}:</span>{" "}
                  <span>{detailItem.engine}</span>
                </div>
                <div>
                  <span style={{ color: "#888" }}>{t("docSdk.history.colProcessingTime")}:</span>{" "}
                  <span>
                    {detailItem.processing_time != null
                      ? formatTime(detailItem.processing_time)
                      : "-"}
                  </span>
                </div>
                <div>
                  <span style={{ color: "#888" }}>{t("docSdk.history.colCreatedAt")}:</span>{" "}
                  <span>{formatDate(detailItem.created_at)}</span>
                </div>
                <div>
                  <span style={{ color: "#888" }}>File Size:</span>{" "}
                  <span>{formatFileSize(detailItem.file_size)}</span>
                </div>
              </div>
            </Card>

            {/* Markdown content */}
            {detailItem.result?.markdown && (
              <Card
                size="small"
                title={t("docSdk.markdownPreview")}
                style={{ marginBottom: 12 }}
              >
                <MarkdownCopy content={detailItem.result.markdown} />
              </Card>
            )}

            {/* Text content (fallback when no markdown) */}
            {detailItem.result?.text && !detailItem.result?.markdown && (
              <Card size="small" title={t("docSdk.textContent")}>
                <div
                  style={{
                    maxHeight: 400,
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    background: "#fafafa",
                    padding: 12,
                    borderRadius: 4,
                    fontSize: 13,
                    lineHeight: 1.6,
                  }}
                >
                  {detailItem.result.text}
                </div>
              </Card>
            )}

            {/* Error */}
            {detailItem.error && (
              <Card size="small">
                <div style={{ color: "#ff4d4f" }}>{detailItem.error}</div>
              </Card>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
