/**
 * Cloud backup section — container that composes the cloud config modal,
 * toolbar (sync / settings), and the cloud backup table.
 *
 * Lives below the local backup section in the Backups page to clearly
 * separate "Local Backups" from "Cloud Storage Backups".
 */
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Space, Tag, Typography } from "antd";
import {
  CloudOutlined,
  SettingOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import api from "@/api";
import { useAppMessage } from "@/hooks/useAppMessage";
import type {
  CloudBackupConfig,
  CloudBackupEntry,
} from "@/api/types/cloudBackup";
import CloudBackupTable from "./CloudBackupTable";
import CloudBackupConfigModal from "./CloudBackupConfigModal";
import styles from "./CloudBackupSection.module.less";

dayjs.extend(relativeTime);

export default function CloudBackupSection() {
  const { t } = useTranslation();
  const { message } = useAppMessage();
  const [entries, setEntries] = useState<CloudBackupEntry[]>([]);
  const [config, setConfig] = useState<CloudBackupConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [entriesRes, configRes] = await Promise.all([
        api.listCloudBackups(),
        api.getConfig(),
      ]);
      setEntries(entriesRes.entries);
      setConfig(configRes);
    } catch {
      message.error(t("cloudBackup.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [message, t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSyncAll = async () => {
    try {
      setSyncing(true);
      const res = await api.syncAll();
      message.success(t("cloudBackup.syncSuccess", { count: res.uploaded_count }));
      fetchData();
    } catch {
      message.error(t("cloudBackup.syncFailed"));
    } finally {
      setSyncing(false);
    }
  };

  const isConfigured = config?.enabled && !!config?.provider;
  const lastSyncText = config?.last_sync_at
    ? dayjs(config.last_sync_at).fromNow()
    : t("cloudBackup.never");

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <CloudOutlined className={styles.cloudIcon} />
          <Typography.Text strong className={styles.title}>
            {t("cloudBackup.sectionCloud")}
          </Typography.Text>
          {isConfigured ? (
            <Tag color="green">{config?.provider?.toUpperCase()}</Tag>
          ) : (
            <Tag color="default">{t("cloudBackup.providerNone")}</Tag>
          )}
        </div>
        <Space>
          <Button
            icon={<SyncOutlined spin={syncing} />}
            onClick={handleSyncAll}
            loading={syncing}
            disabled={!isConfigured}
          >
            {t("cloudBackup.syncAll")}
          </Button>
          <Button
            icon={<SettingOutlined />}
            onClick={() => setConfigOpen(true)}
          >
            {t("cloudBackup.config")}
          </Button>
        </Space>
      </div>

      {config?.last_sync_at && (
        <div className={styles.syncInfo}>
          <Typography.Text type="secondary" className={styles.syncText}>
            {t("cloudBackup.lastSync")}: {lastSyncText}
            {config.last_sync_status &&
              ` · ${config.last_sync_status}`}
          </Typography.Text>
        </div>
      )}

      <CloudBackupTable entries={entries} onRefresh={fetchData} />

      <CloudBackupConfigModal
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        onSaved={fetchData}
      />
    </div>
  );
}
