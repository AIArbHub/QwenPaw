/**
 * Cloud backup configuration modal — configure S3 or WebDAV provider settings.
 */
import { useEffect, useState } from "react";
import {
  Button,
  Form,
  Input,
  Modal,
  InputNumber,
  Select,
  Switch,
  Space,
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import api from "@/api";
import { useAppMessage } from "@/hooks/useAppMessage";
import type { CloudBackupConfig } from "@/api/types/cloudBackup";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export default function CloudBackupConfigModal({
  open,
  onClose,
  onSaved,
}: Props) {
  const { t } = useTranslation();
  const { message } = useAppMessage();
  const [form] = Form.useForm<CloudBackupConfig>();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api
      .getConfig()
      .then((config) => {
        form.setFieldsValue(config);
      })
      .catch(() => {
        message.error(t("cloudBackup.loadFailed"));
      })
      .finally(() => setLoading(false));
  }, [open, form, message, t]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      // Ensure all required fields are present — Ant Design's
      // validateFields can return undefined for fields that were
      // never rendered (e.g. S3 fields when provider=webdav).
      const fullConfig: CloudBackupConfig = {
        provider: values.provider ?? null,
        enabled: values.enabled ?? false,
        remote_prefix: values.remote_prefix ?? "aiarb-backups",
        auto_sync: values.auto_sync ?? false,
        sync_on_schedule: values.sync_on_schedule ?? false,
        sync_schedule_cron: values.sync_schedule_cron ?? "0 3 * * *",
        max_cloud_backups: values.max_cloud_backups ?? 30,
        s3: {
          endpoint_url: values.s3?.endpoint_url ?? "",
          region: values.s3?.region ?? "us-east-1",
          bucket: values.s3?.bucket ?? "",
          access_key_id: values.s3?.access_key_id ?? "",
          secret_access_key: values.s3?.secret_access_key ?? "",
          force_path_style: values.s3?.force_path_style ?? true,
        },
        webdav: {
          url: values.webdav?.url ?? "",
          username: values.webdav?.username ?? "",
          password: values.webdav?.password ?? "",
        },
        last_sync_at: values.last_sync_at ?? null,
        last_sync_status: values.last_sync_status ?? null,
        last_sync_message: values.last_sync_message ?? null,
      };
      await api.saveConfig(fullConfig);
      message.success(t("cloudBackup.configSaved"));
      onSaved?.();
      onClose();
    } catch {
      message.error(t("cloudBackup.configSaveFailed"));
    }
  };

  const handleCheck = async () => {
    try {
      const values = await form.validateFields();
      // Same normalisation as handleSave — ensure all fields are present.
      const fullConfig: CloudBackupConfig = {
        provider: values.provider ?? null,
        enabled: values.enabled ?? false,
        remote_prefix: values.remote_prefix ?? "aiarb-backups",
        auto_sync: values.auto_sync ?? false,
        sync_on_schedule: values.sync_on_schedule ?? false,
        sync_schedule_cron: values.sync_schedule_cron ?? "0 3 * * *",
        max_cloud_backups: values.max_cloud_backups ?? 30,
        s3: {
          endpoint_url: values.s3?.endpoint_url ?? "",
          region: values.s3?.region ?? "us-east-1",
          bucket: values.s3?.bucket ?? "",
          access_key_id: values.s3?.access_key_id ?? "",
          secret_access_key: values.s3?.secret_access_key ?? "",
          force_path_style: values.s3?.force_path_style ?? true,
        },
        webdav: {
          url: values.webdav?.url ?? "",
          username: values.webdav?.username ?? "",
          password: values.webdav?.password ?? "",
        },
        last_sync_at: values.last_sync_at ?? null,
        last_sync_status: values.last_sync_status ?? null,
        last_sync_message: values.last_sync_message ?? null,
      };
      await api.saveConfig(fullConfig);
      setChecking(true);
      const res = await api.checkConnection();
      if (res.connected) {
        message.success(t("cloudBackup.checkSuccess"));
      } else {
        const errMsg = res.error || t("cloudBackup.checkFailed");
        // If there's detail (server response body), show it in a modal
        // so the user can see the full error and copy it.
        if (res.detail) {
          Modal.error({
            title: t("cloudBackup.checkFailed"),
            content: (
              <div>
                <Typography.Paragraph strong style={{ marginBottom: 8 }}>
                  {errMsg}
                </Typography.Paragraph>
                {res.status_code && (
                  <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
                    HTTP {res.status_code}
                  </Typography.Text>
                )}
                <Typography.Paragraph
                  type="secondary"
                  style={{
                    fontSize: 12,
                    maxHeight: 200,
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                  }}
                >
                  {res.detail}
                </Typography.Paragraph>
              </div>
            ),
          });
        } else {
          message.error(errMsg);
        }
      }
    } catch {
      message.error(t("cloudBackup.checkFailed"));
    } finally {
      setChecking(false);
    }
  };

  const provider = Form.useWatch("provider", form);

  return (
    <Modal
      title={t("cloudBackup.configTitle")}
      open={open}
      onCancel={onClose}
      width={600}
      footer={
        <Space>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button loading={checking} onClick={handleCheck}>
            {t("cloudBackup.check")}
          </Button>
          <Button type="primary" loading={loading} onClick={handleSave}>
            {t("cloudBackup.save")}
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" preserve={true}>
        <Form.Item name="provider" label={t("cloudBackup.provider")}>
          <Select>
            <Select.Option value={null}>
              {t("cloudBackup.providerNone")}
            </Select.Option>
            <Select.Option value="s3">
              {t("cloudBackup.providerS3")}
            </Select.Option>
            <Select.Option value="webdav">
              {t("cloudBackup.providerWebDAV")}
            </Select.Option>
          </Select>
        </Form.Item>

        <Form.Item
          name="enabled"
          label={t("cloudBackup.enabled")}
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>

        <Form.Item
          name="remote_prefix"
          label={t("cloudBackup.remotePrefix")}
        >
          <Input placeholder={t("cloudBackup.remotePrefixPlaceholder")} />
        </Form.Item>

        {provider === "s3" && (
          <>
            <Form.Item name={["s3", "endpoint_url"]} label={t("cloudBackup.s3Endpoint")}>
              <Input placeholder={t("cloudBackup.s3EndpointPlaceholder")} />
            </Form.Item>
            <Form.Item name={["s3", "region"]} label={t("cloudBackup.s3Region")}>
              <Input placeholder="us-east-1" />
            </Form.Item>
            <Form.Item name={["s3", "bucket"]} label={t("cloudBackup.s3Bucket")}>
              <Input />
            </Form.Item>
            <Form.Item name={["s3", "access_key_id"]} label={t("cloudBackup.s3AccessKey")}>
              <Input />
            </Form.Item>
            <Form.Item name={["s3", "secret_access_key"]} label={t("cloudBackup.s3SecretKey")}>
              <Input.Password />
            </Form.Item>
            <Form.Item
              name={["s3", "force_path_style"]}
              label={t("cloudBackup.s3ForcePathStyle")}
              valuePropName="checked"
              tooltip={t("cloudBackup.s3ForcePathStyleTooltip")}
            >
              <Switch />
            </Form.Item>
          </>
        )}

        {provider === "webdav" && (
          <>
            <Form.Item name={["webdav", "url"]} label={t("cloudBackup.webdavUrl")}>
              <Input placeholder={t("cloudBackup.webdavUrlPlaceholder")} />
            </Form.Item>
            <Form.Item name={["webdav", "username"]} label={t("cloudBackup.webdavUsername")}>
              <Input />
            </Form.Item>
            <Form.Item name={["webdav", "password"]} label={t("cloudBackup.webdavPassword")}>
              <Input.Password />
            </Form.Item>
          </>
        )}

        <Form.Item
          name="auto_sync"
          label={t("cloudBackup.autoSync")}
          valuePropName="checked"
        >
          <Switch />
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
          label={t("cloudBackup.syncScheduleCron")}
        >
          <Input placeholder={t("cloudBackup.syncScheduleCronPlaceholder")} />
        </Form.Item>

        <Form.Item
          name="max_cloud_backups"
          label={t("cloudBackup.maxCloudBackups")}
        >
          <InputNumber min={1} max={999} style={{ width: "100%" }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
