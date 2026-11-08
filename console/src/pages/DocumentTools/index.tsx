import { Suspense, lazy, useState } from "react";
import { Drawer, Tooltip } from "antd";
import { useTranslation } from "react-i18next";
import {
  SafetyCertificateOutlined,
  ScanOutlined,
  FileSearchOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import styles from "./index.module.less";

// Lazy-load panels for code splitting
const RedactionPanel = lazy(() => import("./RedactionPanel"));
const OCRConfigPanel = lazy(() => import("./OCRConfigPanel"));
const IntakePanel = lazy(() => import("./IntakePanel"));
const RestorePanel = lazy(() => import("./RestorePanel"));

const PanelFallback = () => (
  <div style={{ textAlign: "center", padding: 40 }}>
    <div className={styles.spinFallback} />
  </div>
);

export default function DocumentToolsPage() {
  const { t } = useTranslation();

  // Sub-panel visibility — controlled by drawer, not tabs
  const [ocrDrawerOpen, setOcrDrawerOpen] = useState(false);
  const [intakeDrawerOpen, setIntakeDrawerOpen] = useState(false);
  const [restoreDrawerOpen, setRestoreDrawerOpen] = useState(false);

  return (
    <section className={styles.documentToolsPage}>
      {/* Header — 大字体、清晰导航 */}
      <header className={styles.docToolsHeader}>
        <div className={styles.docToolsHeaderLeft}>
          <SafetyCertificateOutlined style={{ fontSize: 28 }} />
          <span className={styles.docToolsTitle}>
            {t("documentTools.redaction.tab", "卷宗脱敏")}
          </span>
        </div>
        <div className={styles.docToolsHeaderRight}>
          <Tooltip title={t("documentTools.restore.tab", "还原")}>
            <button
              className={styles.headerActionBtn}
              onClick={() => setRestoreDrawerOpen(true)}
            >
              <UndoOutlined />
              <span className={styles.headerActionLabel}>
                {t("documentTools.restore.tab", "还原")}
              </span>
            </button>
          </Tooltip>
          <Tooltip title={t("documentTools.intake.tab", "文档解析")}>
            <button
              className={styles.headerActionBtn}
              onClick={() => setIntakeDrawerOpen(true)}
            >
              <FileSearchOutlined />
              <span className={styles.headerActionLabel}>
                {t("documentTools.intake.tab", "文档解析")}
              </span>
            </button>
          </Tooltip>
          <Tooltip title={t("documentTools.ocr.tab", "OCR 设置")}>
            <button
              className={styles.headerActionBtn}
              onClick={() => setOcrDrawerOpen(true)}
            >
              <ScanOutlined />
              <span className={styles.headerActionLabel}>
                {t("documentTools.ocr.tab", "OCR 设置")}
              </span>
            </button>
          </Tooltip>
        </div>
      </header>

      {/* Main content — redaction panel is the primary view */}
      <div className={styles.docToolsContent}>
        <Suspense fallback={<PanelFallback />}>
          <RedactionPanel />
        </Suspense>
      </div>

      {/* Restore — in a drawer */}
      <Drawer
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16 }}>
            <UndoOutlined />
            {t("documentTools.restore.tab", "脱敏还原")}
          </div>
        }
        open={restoreDrawerOpen}
        onClose={() => setRestoreDrawerOpen(false)}
        width={720}
        styles={{
          body: { padding: 16, overflow: "auto" },
        }}
      >
        <Suspense fallback={<PanelFallback />}>
          <RestorePanel />
        </Suspense>
      </Drawer>

      {/* OCR Config — in a drawer */}
      <Drawer
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16 }}>
            <ScanOutlined />
            {t("documentTools.ocr.tab", "OCR 设置")}
          </div>
        }
        open={ocrDrawerOpen}
        onClose={() => setOcrDrawerOpen(false)}
        width={560}
        styles={{
          body: { padding: 16, overflow: "auto" },
        }}
      >
        <Suspense fallback={<PanelFallback />}>
          <OCRConfigPanel />
        </Suspense>
      </Drawer>

      {/* Intake / Document analysis — in a drawer */}
      <Drawer
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16 }}>
            <FileSearchOutlined />
            {t("documentTools.intake.tab", "文档解析")}
          </div>
        }
        open={intakeDrawerOpen}
        onClose={() => setIntakeDrawerOpen(false)}
        width={680}
        styles={{
          body: { padding: 16, overflow: "auto" },
        }}
      >
        <Suspense fallback={<PanelFallback />}>
          <IntakePanel />
        </Suspense>
      </Drawer>
    </section>
  );
}
