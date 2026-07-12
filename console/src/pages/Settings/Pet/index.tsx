import { useEffect, useRef, useState, useCallback } from "react";
import {
  Button,
  Card,
  message,
  Modal,
  Upload,
  Table,
  Tag,
  Spinner,
} from "@agentscope-ai/design";
import { Space } from "antd";
import { useTranslation } from "react-i18next";
import { PlusOutlined, ReloadOutlined, PlayCircleOutlined } from "@ant-design/icons";
import { PageHeader } from "@/components/PageHeader";
import styles from "./index.module.less";

const PET_API_BASE = "/api/qwenpaw-pet";

interface PetManifest {
  name?: string;
  id: string;
  version?: string;
}

interface PetEntry {
  name: string;
  folder: string;
  manifest: PetManifest;
  spritesheet?: string;
}

interface DesktopHealth {
  running: boolean;
  pid?: number;
  port?: number;
}

export default function PetPage() {
  const { t } = useTranslation();
  const [pets, setPets] = useState<PetEntry[]>([]);
  const [health, setHealth] = useState<DesktopHealth>({ running: false });
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const uploadRef = useRef<{ file: File | null; path: string }>({
    file: null,
    path: "",
  });

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${PET_API_BASE}/status`);
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
      }
    } catch {
      setHealth({ running: false });
    }
  }, []);

  const fetchPets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${PET_API_BASE}/pets`);
      if (res.ok) {
        const data = await res.json();
        setPets(data.pets || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPets();
    fetchStatus();
  }, [fetchPets, fetchStatus]);

  // Poll status every 2s
  useEffect(() => {
    const id = setInterval(fetchStatus, 2000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const handleStartDesktop = async () => {
    setStarting(true);
    try {
      const res = await fetch(`${PET_API_BASE}/desktop/start`, { method: "POST" });
      if (res.ok) {
        message.success(t("pet.desktopReady", "桌面宠物已就绪"));
        fetchStatus();
      } else {
        const data = await res.json().catch(() => ({}));
        if (data.detail === "already-running") {
          message.info(t("pet.desktopAlreadyRunning", "桌面宠物已在运行"));
        } else {
          message.error(t("pet.desktopStartFailed", "无法启动桌面宠物"));
        }
      }
    } catch {
      message.error(t("pet.desktopStartFailed", "无法启动桌面宠物"));
    } finally {
      setStarting(false);
    }
  };

  const handleSwitchPet = async (folder: string, petName: string) => {
    try {
      const res = await fetch(`${PET_API_BASE}/switch-pet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pet_dir: folder }),
      });
      if (res.ok) {
        message.success(
          t("pet.switchSuccess", `已切换至 {name}`).replace("{name}", petName),
        );
      } else {
        message.error(t("pet.switchFailed", "切换失败"));
      }
    } catch {
      message.error(t("pet.switchFailed", "切换失败"));
    }
  };

  const handleImportConfirm = async () => {
    if (!uploadRef.current.file) {
      message.warning(t("pet.importChooseFirst", "请先选择文件"));
      return;
    }
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", uploadRef.current.file);
      const res = await fetch(`${PET_API_BASE}/import-pet-upload`, {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        message.success(
          t("pet.importSuccess", "已导入").replace("{name}", data.name || ""),
        );
        setImportOpen(false);
        fetchPets();
      } else {
        const data = await res.json().catch(() => ({}));
        message.error(data.detail || t("pet.importFailed", "导入失败"));
      }
    } catch {
      message.error(t("pet.importFailed", "导入失败"));
    } finally {
      setImporting(false);
    }
  };

  const columns = [
    {
      title: t("pet.colPreview", "预览"),
      dataIndex: "spritesheet",
      key: "preview",
      width: 120,
      render: (_: unknown, record: PetEntry) => {
        if (!record.spritesheet) return <div style={{ width: 96, height: 104, background: "var(--ant-color-fill-tertiary)", borderRadius: 4 }} />;
        return (
          <img
            src={`${PET_API_BASE}/pets/${record.folder}/spritesheet`}
            alt={record.name}
            style={{
              width: 96,
              height: 104,
              objectFit: "none",
              objectPosition: "0 0",
              imageRendering: "pixelated",
              borderRadius: 4,
            }}
          />
        );
      },
    },
    {
      title: t("pet.colName", "名称"),
      dataIndex: "name",
      key: "name",
	ellipsis: true,
    },
    {
      title: t("pet.colFolder", "文件夹"),
      dataIndex: "folder",
      key: "folder",
      ellipsis: true,
      render: (v: string) => <code style={{ fontSize: 12 }}>{v}</code>,
    },
    {
      title: "pet.json id",
      dataIndex: ["manifest", "id"],
      key: "manifestId",
      ellipsis: true,
    },
    {
      title: t("pet.colAction", "操作"),
      key: "action",
      width: 120,
      render: (_: unknown, record: PetEntry) => (
        <Button
          size="small"
          type="primary"
          ghost
          onClick={() => handleSwitchPet(record.folder, record.name)}
        >
          {t("pet.switch", "切换")}
        </Button>
      ),
    },
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        current={t("pet.title", "桌面宠物")}
        subRow={<div style={{ color: "var(--ant-color-text-secondary)", fontSize: 13 }}>{t("pet.intro", "管理 QwenPaw 桌面宠物，支持启动、切换和导入。")}</div>}
      />

      <Card title={t("pet.control", "控制面板")} className={styles.card}>
        <Space>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={handleStartDesktop}
            loading={starting}
          >
            {t("pet.startDesktop", "启动桌面宠物")}
          </Button>
          <Button icon={<ReloadOutlined />} onClick={fetchPets}>
            {t("pet.refresh", "刷新")}
          </Button>
        </Space>
        <div className={styles.statusBar}>
          <span>{t("pet.desktopHealth", "桌面服务状态：")}</span>
          <Tag color={health.running ? "green" : "default"}>
            {health.running
              ? t("pet.desktopRunning", "运行中")
              : t("pet.desktopStopped", "未运行")}
          </Tag>
          {health.running && health.port && (
            <span style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)" }}>
              port {health.port}
            </span>
          )}
        </div>
      </Card>

      <Card
        title={t("pet.installedPets", "已安装宠物")}
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            size="small"
            onClick={() => setImportOpen(true)}
          >
            {t("pet.importPet", "导入宠物")}
          </Button>
        }
        className={styles.card}
      >
        {loading ? (
          <div style={{ textAlign: "center", padding: 40 }}>
            <Spinner />
          </div>
        ) : (
          <Table
            dataSource={pets}
            columns={columns}
            rowKey="folder"
            pagination={false}
            locale={{ emptyText: t("pet.tableEmpty", "未找到宠物") }}
          />
        )}
      </Card>

      <Modal
        title={t("pet.modalImportTitle", "导入宠物")}
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        onOk={handleImportConfirm}
        confirmLoading={importing}
        okText={t("pet.modalImportOk", "导入")}
      >
        <div style={{ marginBottom: 12, fontSize: 12, color: "var(--ant-color-text-tertiary)" }}>
          {t("pet.importFormatHint", "文件夹或解压后的目录需包含 pet.json 与 spritesheet.webp（1536×1872）")}
        </div>
        <Upload.Dragger
          accept=".zip"
          maxCount={1}
          beforeUpload={(file: File) => {
            uploadRef.current = { file, path: file.name };
            return false;
          }}
          onRemove={() => {
            uploadRef.current = { file: null, path: "" };
          }}
        >
          <p className="ant-upload-drag-icon">
            <PlusOutlined />
          </p>
          <p className="ant-upload-text">
            {t("pet.dropzoneTitle", "将 .zip 文件拖放到此处")}
          </p>
          <p className="ant-upload-hint">
            {t("pet.dropzoneHint", "或点击选择 .zip 文件")}
          </p>
        </Upload.Dragger>
      </Modal>
    </div>
  );
}
