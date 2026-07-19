/**
 * DocSDK IframeView — 方案A：嵌入后端独立HTML前端
 *
 * 通过 iframe 加载 /api/doc/ui/* 下的静态 HTML 页面。
 * 提供组件管理、脱敏规则、系统设置、历史记录的 iframe 嵌入视图。
 */
import { useState } from "react";
import { Tabs, Spin } from "antd";
import {
  SettingOutlined,
  BoxPlotOutlined,
  SafetyCertificateOutlined,
  HistoryOutlined,
  FileSearchOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { getApiUrl } from "@/api/config";

const TABS = [
  { key: "home", path: "/doc/ui/", icon: FileSearchOutlined },
  { key: "components", path: "/doc/ui/components", icon: BoxPlotOutlined },
  { key: "redaction", path: "/doc/ui/redaction", icon: SafetyCertificateOutlined },
  { key: "settings", path: "/doc/ui/settings", icon: SettingOutlined },
  { key: "history", path: "/doc/ui/history", icon: HistoryOutlined },
] as const;

export default function DocSDKIframeView() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("home");
  const [loading, setLoading] = useState(false);

  const handleTabChange = (key: string) => {
    setLoading(true);
    setActiveTab(key);
    // Reset loading after a short delay to allow iframe to start loading
    setTimeout(() => setLoading(false), 300);
  };

  const currentTab = TABS.find((tab) => tab.key === activeTab);
  const iframeSrc = currentTab ? getApiUrl(currentTab.path) : "";

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--ant-color-bg-container)",
      }}
    >
      <Tabs
        activeKey={activeTab}
        onChange={handleTabChange}
        style={{ padding: "0 16px", marginBottom: 0 }}
        items={TABS.map((tab) => ({
          key: tab.key,
          label: (
            <span>
              <tab.icon style={{ marginRight: 6 }} />
              {t(`docSdk.tab.${tab.key}`, {
                home: "首页",
                components: "组件管理",
                redaction: "脱敏规则",
                settings: "系统设置",
                history: "历史记录",
              }[tab.key])}
            </span>
          ),
        }))}
      />
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {loading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(255,255,255,0.6)",
              zIndex: 1,
            }}
          >
            <Spin />
          </div>
        )}
        <iframe
          key={iframeSrc}
          src={iframeSrc}
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            flex: 1,
          }}
          title="DocSDK"
          onLoad={() => setLoading(false)}
        />
      </div>
    </div>
  );
}
