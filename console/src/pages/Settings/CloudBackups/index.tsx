import { useCallback, useEffect, useState } from "react";
import {
  Card,
  Form,
  Input,
  Select,
  Switch,
  Button,
  Spin,
  Table,
  Space,
  Popconfirm,
  message,
  Tag,
  InputNumber,
} from "antd";
import {
  CloudOutlined,
  SyncOutlined,
  DownloadOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import api from "@/api";
import { PageHeader } from "@/components/PageHeader";
import type {
  CloudBackupConfig,
  CloudBackupEntry,
  CloudProviderType,
} from "@/api/types/cloudBackup";
import styles from "./index.module.less";

const providerOptions: { value: CloudProviderType; label: string }[] = [
  { value: "s3", label: "S3 Compatible (AWS / R2 / MinIO / B2)" },
  { value: "webdav", label: "WebDAV (NextCloud / ownCloud)" },
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(isoStr: string): string {
  try {
    return new Date(isoStr).toLocaleString();
  } catch {
    return isoStr;
  }
}

export default function CloudBackupsPage() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [config, setConfig] = useState<CloudBackupConfig | null>(null);
  const [cloudEntries, setCloudEntries] = useState<CloudBackupEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [form] = Form.useForm();
  const [provider, setProvider] = useState<CloudProviderType | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const cfg = await api.getConfig();
      setConfig(cfg);
      setProvider(cfg.provider);
      form.setFieldsValue({
        enabled: cfg.enabled,
        provider: cfg.provider,
        remote_prefix: cfg.remote_prefix,
        auto_sync: cfg.auto_sync,
        sync_on_schedule: cfg.sync_on_schedule,
        sync_schedule_cron: cfg.sync_schedule_cron,
        max_cloud_backups: cfg.max_cloud_backups,
        s3_endpoint: cfg.s3?.endpoint_url ?? "",
        s3_region: cfg.s3?.region ?? "us-east-1",
        s3_bucket: cfg.s3?.bucket ?? "",
        s3_access_key: cfg.s3?.access_key_id ?? "",
        s3_secret_key: cfg.s3?.secret_access_key ?? "",
        webdav_url: cfg.webdav?.url ?? "",
        webdav_username: cfg.webdav?.username ?? "",
        webdav_password: cfg.webdav?.password ?? "",
      });
    } catch {
      message.error(t("cloudBackup.loadConfigFailed"));
    } finally {
      setLoading(false);
    }
  }, [form, t]);

  const fetchEntries = useCallback(async () => {
    setEntriesLoading(true);
    try {
      const res = await api.listCloudBackups();
      setCloudEntries(res.entries);
    } catch {
      // silently fail
    } finally {
      setEntriesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  useEffect(() => {
    if (config?.enabled) {
      fetchEntries();
    }
  }, [config?.enabled, fetchEntries]);

  const handleCheck = async () => {
    setConnecting(true);
    setConnected(null);
    try {
      const res = await api.checkConnection();
      setConnected(res.connected);
      message.success(
        res.connected
          ? t("cloudBackup.connectionSuccess")
          : t("cloudBackup.connectionFailed"),
      );
    } catch {
      setConnected(false);
      message.error(t("cloudBackup.connectionFailed"));
    } finally {
      setConnecting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const values = await form.validateFields();
      const newConfig: CloudBackupConfig = {
        provider: values.provider || null,
        enabled: values.enabled ?? false,
        remote_prefix: values.remote_prefix ?? "aiarb-backups",
        auto_sync: values.auto_sync ?? false,
        sync_on_schedule: values.sync_on_schedule ?? false,
        sync_schedule_cron: values.sync_schedule_cron ?? "0 3 * * *",
        max_cloud_backups: values.max_cloud_backups ?? 30,
        s3: {
          endpoint_url: values.s3_endpoint ?? "",
          region: values.s3_region ?? "us-east-1",
          bucket: values.s3_bucket ?? "",
          access_key_id: values.s3_access_key ?? "",
          secret_access_key: values.s3_secret_key ?? "",
        },
        webdav: {
          url: values.webdav_url ?? "",
          username: values.webdav_username ?? "",
          password: values.webdav_password ?? "",
        },
        last_sync_at: config?.last_sync_at ?? null,
        last_sync_status: config?.last_sync_status ?? null,
        last_sync_message: config?.last_sync_message ?? null,
      };
      await api.saveConfig(newConfig);
      setConfig(newConfig);
      message.success(t("cloudBackup.saveSuccess"));
    } catch {
      message.error(t("cloudBackup.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await api.syncAll();
      message.success(
        t("cloudBackup.syncSuccess", { count: res.uploaded_count }),
      );
      await fetchEntries();
      await fetchConfig();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(msg);
    } finally {
      setSyncing(false);
    }
  };

  const handleDelete = async (key: string) => {
    try {
      await api.deleteCloudBackup(key);
      message.success(t("cloudBackup.deleteSuccess"));
      await fetchEntries();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(msg);
    }
  };

  const handleDownload = async (entry: CloudBackupEntry) => {
    try {
      await api.downloadCloudBackup(entry.key, `${entry.backup_name}.zip`);
      message.success(t("cloudBackup.downloadSuccess"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(msg);
    }
  };

  const handleRestore = async (entry: CloudBackupEntry) => {
    try {
      await api.restoreFromCloud(entry.key);
      message.success(t("cloudBackup.restoreSuccess"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(msg);
    }
  };

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.centerState}>
          <Spin />
        </div>
      </div>
    );
  }

  const columns = [
    {
      title: t("cloudBackup.columnName"),
      dataIndex: "backup_name",
      key: "name",
      ellipsis: true,
    },
    {
      title: t("cloudBackup.columnSize"),
      dataIndex: "size",
      key: "size",
      width: 100,
      render: (size: number) => formatSize(size),
    },
    {
      title: t("cloudBackup.columnTime"),
      dataIndex: "last_modified",
      key: "time",
      width: 180,
      render: (time: string) => formatTime(time),
    },
    {
      title: t("cloudBackup.columnActions"),
      key: "actions",
      width: 200,
      render: (_: unknown, record: CloudBackupEntry) => (
        <div className={styles.cloudEntryActions}>
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={() => handleDownload(record)}
          >
            {t("cloudBackup.download")}
          </Button>
          <Button
            size="small"
            onClick={() => handleRestore(record)}
          >
            {t("cloudBackup.restore")}
          </Button>
          <Popconfirm
            title={t("cloudBackup.deleteConfirm")}
            onConfirm={() => handleDelete(record.key)}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </div>
      ),
    },
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        className={styles.pageHeader}
        parent={t("nav.settings")}
        current={t("cloudBackup.title")}
      />

      <Card className={styles.card} title={t("cloudBackup.config")}>
        <Form
          form={form}
          layout="vertical"
          onValuesChange={(changed) => {
            if ("provider" in changed) {
              setProvider(changed.provider);
            }
          }}
        >
          <div className={styles.configGrid}>
            <Form.Item
              name="enabled"
              label={t("cloudBackup.enable")}
              valuePropName="checked"
              className={styles.fullWidth}
            >
              <Switch />
            </Form.Item>

            <Form.Item
              name="provider"
              label={t("cloudBackup.provider")}
            >
              <Select
                allowClear
                placeholder={t("cloudBackup.selectProvider")}
                options={providerOptions}
              />
            </Form.Item>

            <Form.Item
              name="remote_prefix"
              label={t("cloudBackup.remotePrefix")}
            >
              <Input placeholder="aiarb-backups" />
            </Form.Item>

            {provider === "s3" && (
              <>
                <Form.Item
                  name="s3_endpoint"
                  label={t("cloudBackup.s3Endpoint")}
                  help={t("cloudBackup.s3EndpointHelp")}
                >
                  <Input placeholder="https://s3.us-east-1.amazonaws.com" />
                </Form.Item>
                <Form.Item
                  name="s3_region"
                  label={t("cloudBackup.s3Region")}
                >
                  <Input placeholder="us-east-1" />
                </Form.Item>
                <Form.Item
                  name="s3_bucket"
                  label={t("cloudBackup.s3Bucket")}
                  rules={[{ required: true, message: t("cloudBackup.s3BucketRequired") }]}
                >
                  <Input placeholder="my-backups" />
                </Form.Item>
                <Form.Item
                  name="s3_access_key"
                  label={t("cloudBackup.s3AccessKey")}
                  rules={[{ required: true, message: t("cloudBackup.s3AccessKeyRequired") }]}
                >
                  <Input />
                </Form.Item>
                <Form.Item
                  name="s3_secret_key"
                  label={t("cloudBackup.s3SecretKey")}
                  rules={[{ required: true, message: t("cloudBackup.s3SecretKeyRequired") }]}
                >
                  <Input.Password />
                </Form.Item>
              </>
            )}

            {provider === "webdav" && (
              <>
                <Form.Item
                  name="webdav_url"
                  label={t("cloudBackup.webdavUrl")}
                  className={styles.fullWidth}
                  rules={[{ required: true, message: t("cloudBackup.webdavUrlRequired") }]}
                >
                  <Input placeholder="https://nextcloud.example.com/remote.php/dav/files/user" />
                </Form.Item>
                <Form.Item
                  name="webdav_username"
                  label={t("cloudBackup.webdavUsername")}
                >
                  <Input />
                </Form.Item>
                <Form.Item
                  name="webdav_password"
                  label={t("cloudBackup.webdavPassword")}
                >
                  <Input.Password />
                </Form.Item>
              </>
            )}

            <Form.Item
              name="auto_sync"
              label={t("cloudBackup.autoSync")}
              valuePropName="checked"
              help={t("cloudBackup.autoSyncHelp")}
            >
              <Switch />
            </Form.Item>

            <Form.Item
              name="max_cloud_backups"
              label={t("cloudBackup.maxBackups")}
            >
              <InputNumber min={1} max={999} />
            </Form.Item>

            <Form.Item
              name="sync_on_schedule"
              label={t("cloudBackup.syncOnSchedule")}
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>

            <Form.Item
              name="sync_schedule_cron"
              label={t("cloudBackup.syncSchedule")}
              help={t("cloudBackup.syncScheduleHelp")}
            >
              <Input placeholder="0 3 * * *" />
            </Form.Item>
          </div>

          <Space>
            <Button
              type="primary"
              loading={saving}
              onClick={handleSave}
            >
              {t("cloudBackup.save")}
            </Button>
            {provider && (
              <Button
                loading={connecting}
                icon={<CloudOutlined />}
                onClick={handleCheck}
              >
                {t("cloudBackup.testConnection")}
              </Button>
            )}
            {connected !== null && (
              <Tag
                icon={
                  connected ? (
                    <CheckCircleOutlined />
                  ) : (
                    <CloseCircleOutlined />
                  )
                }
                color={connected ? "success" : "error"}
              >
                {connected
                  ? t("cloudBackup.connected")
                  : t("cloudBackup.disconnected")}
              </Tag>
            )}
          </Space>
        </Form>
      </Card>

      {config?.enabled && config?.provider && (
        <Card
          className={styles.card}
          title={t("cloudBackup.cloudStorage")}
          extra={
            <Button
              type="primary"
              icon={<SyncOutlined spin={syncing} />}
              loading={syncing}
              onClick={handleSync}
            >
              {t("cloudBackup.syncNow")}
            </Button>
          }
        >
          {config.last_sync_at && (
            <div className={styles.syncStatus}>
              <InfoCircleOutlined />{" "}
              {t("cloudBackup.lastSync")}: {formatTime(config.last_sync_at)}
              {config.last_sync_message && ` — ${config.last_sync_message}`}
            </div>
          )}

          <Table
            dataSource={cloudEntries}
            columns={columns}
            rowKey="key"
            loading={entriesLoading}
            pagination={{ pageSize: 20 }}
            locale={{ emptyText: t("cloudBackup.noCloudBackups") }}
            style={{ marginTop: 16 }}
          />
        </Card>
      )}
    </div>
  );
}
