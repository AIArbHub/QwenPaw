/**
 * Cloud backup list table — shows backups stored in remote cloud storage
 * with download / restore / delete actions.
 */
import { useMemo, useState } from "react";
import {
  Button,
  Card,
  Empty,
  Popconfirm,
  Table,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import {
  CloudOutlined,
  DownloadOutlined,
  RollbackOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import api from "@/api";
import { useAppMessage } from "@/hooks/useAppMessage";
import type { CloudBackupEntry } from "@/api/types/cloudBackup";
import styles from "./CloudBackupTable.module.less";

dayjs.extend(relativeTime);

interface Props {
  entries: CloudBackupEntry[];
  onRefresh: () => void;
}

export default function CloudBackupTable({ entries, onRefresh }: Props) {
  const { t } = useTranslation();
  const { message } = useAppMessage();
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [restoringKey, setRestoringKey] = useState<string | null>(null);

  const sortedEntries = useMemo(() => {
    return [...entries].sort(
      (a, b) => dayjs(b.last_modified).unix() - dayjs(a.last_modified).unix(),
    );
  }, [entries]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleDownload = async (entry: CloudBackupEntry) => {
    try {
      setDownloadingKey(entry.key);
      const blob = await api.downloadFromCloud(entry.key);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = entry.backup_name
        ? `${entry.backup_name}.zip`
        : "cloud-backup.zip";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      message.error(t("cloudBackup.download"));
    } finally {
      setDownloadingKey(null);
    }
  };

  const handleRestore = async (entry: CloudBackupEntry) => {
    try {
      setRestoringKey(entry.key);
      await api.restoreFromCloud(entry.key);
      message.success(t("cloudBackup.restoreSuccess"));
      onRefresh();
    } catch {
      message.error(t("cloudBackup.restoreFailed"));
    } finally {
      setRestoringKey(null);
    }
  };

  const handleDelete = async (entry: CloudBackupEntry) => {
    try {
      await api.deleteCloudBackup(entry.key);
      message.success(t("cloudBackup.deleteSuccess"));
      onRefresh();
    } catch {
      message.error(t("cloudBackup.deleteFailed"));
    }
  };

  const columns: ColumnsType<CloudBackupEntry> = [
    {
      title: t("cloudBackup.backupName"),
      dataIndex: "backup_name",
      key: "backup_name",
      ellipsis: true,
      render: (name: string) => (
        <span className={styles.nameCell}>
          <CloudOutlined className={styles.cloudIcon} />
          <Typography.Text ellipsis={{ tooltip: name }}>{name}</Typography.Text>
        </span>
      ),
    },
    {
      title: t("cloudBackup.size"),
      dataIndex: "size",
      key: "size",
      width: 100,
      render: (size: number) => formatSize(size),
    },
    {
      title: t("cloudBackup.lastModified"),
      dataIndex: "last_modified",
      key: "last_modified",
      width: 160,
      render: (val: string) => (
        <Tooltip title={dayjs(val).format("YYYY-MM-DD HH:mm:ss")}>
          {dayjs(val).fromNow()}
        </Tooltip>
      ),
      sorter: (a, b) =>
        dayjs(a.last_modified).unix() - dayjs(b.last_modified).unix(),
      defaultSortOrder: "descend",
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 220,
      render: (_, record) => (
        <span className={styles.actions}>
          <Button
            type="link"
            size="small"
            loading={downloadingKey === record.key}
            onClick={() => handleDownload(record)}
            icon={<DownloadOutlined />}
          >
            {t("cloudBackup.download")}
          </Button>
          <Button
            type="link"
            size="small"
            loading={restoringKey === record.key}
            onClick={() => handleRestore(record)}
            icon={<RollbackOutlined />}
          >
            {t("cloudBackup.restore")}
          </Button>
          <Popconfirm
            title={t("cloudBackup.deleteConfirm")}
            onConfirm={() => handleDelete(record)}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              {t("cloudBackup.delete")}
            </Button>
          </Popconfirm>
        </span>
      ),
    },
  ];

  if (entries.length === 0) {
    return (
      <Card className={styles.tableCard}>
        <Empty
          description={t("cloudBackup.noCloudBackups")}
          style={{ padding: "40px 0" }}
        />
      </Card>
    );
  }

  return (
    <Card className={styles.tableCard}>
      <Table<CloudBackupEntry>
        rowKey="key"
        dataSource={sortedEntries}
        columns={columns}
        size="middle"
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          showTotal: (total) => t("backup.total", { count: total }),
          pageSizeOptions: ["10", "20", "50"],
        }}
      />
    </Card>
  );
}
