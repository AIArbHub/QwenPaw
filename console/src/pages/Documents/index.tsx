import { useState, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, Spin } from "antd";
import {
  FolderOpenOutlined,
  SafetyOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { PageHeader } from "@/components/PageHeader";

// Lazy-load tab content components
const MaterialsPage = lazy(() => import("./Materials"));
const DesensitizeWorkspace = lazy(() => import("./DesensitizeWorkspace"));
const EngineSettings = lazy(() => import("./EngineSettings"));

export default function DocumentsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("materials");

  const tabItems = [
    {
      key: "materials",
      label: (
        <span>
          <FolderOpenOutlined /> {t("documents.materials", "材料库")}
        </span>
      ),
      children: (
        <Suspense fallback={<Spin style={{ display: "block", margin: "20vh auto" }} />}>
          <MaterialsPage />
        </Suspense>
      ),
    },
    {
      key: "desensitize",
      label: (
        <span>
          <SafetyOutlined /> {t("documents.desensitize", "脱敏工作台")}
        </span>
      ),
      children: (
        <Suspense fallback={<Spin style={{ display: "block", margin: "20vh auto" }} />}>
          <DesensitizeWorkspace />
        </Suspense>
      ),
    },
    {
      key: "engine",
      label: (
        <span>
          <SettingOutlined /> {t("documents.engineSettings", "引擎设置")}
        </span>
      ),
      children: (
        <Suspense fallback={<Spin style={{ display: "block", margin: "20vh auto" }} />}>
          <EngineSettings />
        </Suspense>
      ),
    },
  ];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHeader
        current={t("nav.documents", "文档中心")}
        subRow={
          <span style={{ color: "var(--ant-color-text-secondary)", fontSize: 13 }}>
            {t("documents.subtitle", "材料管理 · 智能脱敏 · 引擎配置")}
          </span>
        }
      />
      <div style={{ flex: 1, overflow: "hidden", paddingLeft: 24, paddingRight: 24 }}>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={tabItems}
          size="large"
          style={{ height: "100%" }}
          tabBarStyle={{ marginBottom: 0 }}
        />
      </div>
    </div>
  );
}
