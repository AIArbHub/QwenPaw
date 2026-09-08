import { Suspense, lazy } from "react";
import { Tabs, Spin } from "antd";
import { useTranslation } from "react-i18next";
import {
  FileSearchOutlined,
  SafetyCertificateOutlined,
  UndoOutlined,
  ScanOutlined,
} from "@ant-design/icons";
import styles from "./index.module.less";

// Lazy-load panels for code splitting
const IntakePanel = lazy(() => import("./IntakePanel"));
const RedactionPanel = lazy(() => import("./RedactionPanel"));
const RestorePanel = lazy(() => import("./RestorePanel"));
const OCRConfigPanel = lazy(() => import("./OCRConfigPanel"));

const PanelFallback = () => (
  <div style={{ textAlign: "center", padding: 40 }}>
    <Spin />
  </div>
);

export default function DocumentToolsPage() {
  const { t } = useTranslation();

  return (
    <section className={styles.documentToolsPage}>
      <header className={styles.docToolsHeader}>
        <FileSearchOutlined style={{ fontSize: 20 }} />
        <span className={styles.docToolsTitle}>
          {t("nav.documentTools", "文档工具箱")}
        </span>
        <span className={styles.docToolsSubtitle}>
          {t(
            "documentTools.subtitle",
            "LDIR 文档解析 · 脱敏处理 · 脱敏还原",
          )}
        </span>
      </header>

      <Tabs
        className={styles.docToolsTabs}
        defaultActiveKey="intake"
        destroyInactiveTabPane={false}
        items={[
          {
            key: "intake",
            label: (
              <span>
                <FileSearchOutlined />
                {t("documentTools.intake.tab", "文档解析")}
              </span>
            ),
            children: (
              <Suspense fallback={<PanelFallback />}>
                <IntakePanel />
              </Suspense>
            ),
          },
          {
            key: "redaction",
            label: (
              <span>
                <SafetyCertificateOutlined />
                {t("documentTools.redaction.tab", "脱敏处理")}
              </span>
            ),
            children: (
              <Suspense fallback={<PanelFallback />}>
                <RedactionPanel />
              </Suspense>
            ),
          },
          {
            key: "restore",
            label: (
              <span>
                <UndoOutlined />
                {t("documentTools.restore.tab", "脱敏还原")}
              </span>
            ),
            children: (
              <Suspense fallback={<PanelFallback />}>
                <RestorePanel />
              </Suspense>
            ),
          },
          {
            key: "ocr-config",
            label: (
              <span>
                <ScanOutlined />
                {t("documentTools.ocr.tab", "OCR 引擎配置")}
              </span>
            ),
            children: (
              <Suspense fallback={<PanelFallback />}>
                <OCRConfigPanel />
              </Suspense>
            ),
          },
        ]}
      />
    </section>
  );
}
