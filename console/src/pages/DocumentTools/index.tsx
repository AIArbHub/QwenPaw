import { Suspense, lazy, useState } from "react";
import { Drawer, Tooltip } from "antd";
import { useTranslation } from "react-i18next";
import {
  SafetyCertificateOutlined,
  ScanOutlined,
  FileSearchOutlined,
} from "@ant-design/icons";
import styles from "./index.module.less";

// Lazy-load panels for code splitting
const RedactionPanel = lazy(() => import("./RedactionPanel"));
const OCRConfigPanel = lazy(() => import("./OCRConfigPanel"));
const IntakePanel = lazy(() => import("./IntakePanel"));

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

  return (
    <section className={styles.documentToolsPage}>
      {/* Header — minimal, legalwork-inspired */}
      <header className={styles.docToolsHeader}>
        <div className={styles.docToolsHeaderLeft}>
          <SafetyCertificateOutlined style={{ fontSize: 22 }} />
          <span className={styles.docToolsTitle}>
            {t("documentTools.redaction.tab", "脱敏处理")}
          </span>
        </div>
        <div className={styles.docToolsHeaderRight}>
          <Tooltip title={t("documentTools.intake.tab", "文档解析")}>
            <button
              className={styles.headerActionBtn}
              onClick={() => setIntakeDrawerOpen(true)}
            >
              <FileSearchOutlined />
            </button>
          </Tooltip>
          <Tooltip title={t("documentTools.ocr.tab", "OCR 引擎配置")}>
            <button
              className={styles.headerActionBtn}
              onClick={() => setOcrDrawerOpen(true)}
            >
              <ScanOutlined />
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

      {/* OCR Config — in a drawer, not a tab */}
      <Drawer
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ScanOutlined />
            {t("documentTools.ocr.tab", "OCR 引擎配置")}
          </div>
        }
        open={ocrDrawerOpen}
        onClose={() => setOcrDrawerOpen(false)}
        width={520}
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
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <FileSearchOutlined />
            {t("documentTools.intake.tab", "文档解析")}
          </div>
        }
        open={intakeDrawerOpen}
        onClose={() => setIntakeDrawerOpen(false)}
        width={640}
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
