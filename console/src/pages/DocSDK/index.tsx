import { useCallback, useEffect, useState } from "react";
import { Tabs, Card, Statistic, Row, Col, Spin, Tag } from "antd";
import {
  AppstoreOutlined,
  SafetyOutlined,
  FileSearchOutlined,
  CheckCircleOutlined,
  CloudOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/PageHeader";
import { docProcessingApi } from "@/api/modules/docProcessing";
import type { DocComponent, RedactionRule, EnvironmentReport } from "@/api/modules/docProcessing";
import DocSDKComponents from "./Components";
import DocSDKRedaction from "./Redaction";
import DocSDKParse from "./Parse";
import DocSDKSettings from "./Settings";
import DocSDKHistory from "./History";

export default function DocSDKPage() {
  const { t } = useTranslation();

  const [components, setComponents] = useState<DocComponent[]>([]);
  const [redactionRules, setRedactionRules] = useState<RedactionRule[]>([]);
  const [envReport, setEnvReport] = useState<EnvironmentReport | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const [compRes, rulesRes, envRes] = await Promise.allSettled([
        docProcessingApi.listComponents(),
        docProcessingApi.listRedactionRules(),
        docProcessingApi.getEnvironmentReport(),
      ]);

      if (compRes.status === "fulfilled") {
        const raw = compRes.value;
        const arr = Array.isArray(raw) ? raw : (raw as any)?.components ?? [];
        setComponents(arr);
      }
      if (rulesRes.status === "fulfilled") {
        const raw = rulesRes.value;
        const arr = Array.isArray(raw) ? raw : (raw as any)?.rules ?? [];
        setRedactionRules(arr);
      }
      if (envRes.status === "fulfilled") setEnvReport(envRes.value);
    } catch {
      // Silently ignore stats errors
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const installedCount = components.filter((c) => c.installed).length;
  const totalCount = components.length;
  const rulesCount = redactionRules.length;
  const systemStatus = envReport?.system_status ?? "unknown";

  const statusColorMap: Record<string, string> = {
    ok: "green",
    degraded: "orange",
    error: "red",
    unknown: "default",
  };

  const statusLabelMap: Record<string, string> = {
    ok: t("docSdk.systemStatusOk"),
    degraded: t("docSdk.systemStatusDegraded"),
    error: t("docSdk.systemStatusError"),
    unknown: t("common.unknown"),
  };

  const tabItems = [
    {
      key: "components",
      label: t("docSdk.tab.components"),
      children: <DocSDKComponents />,
    },
    {
      key: "redaction",
      label: t("docSdk.tab.redaction"),
      children: <DocSDKRedaction />,
    },
    {
      key: "parse",
      label: t("docSdk.tab.parse"),
      children: <DocSDKParse />,
    },
    {
      key: "settings",
      label: t("docSdk.tab.settings"),
      children: <DocSDKSettings />,
    },
    {
      key: "history",
      label: t("docSdk.tab.history"),
      children: <DocSDKHistory />,
    },
  ];

  return (
    <div style={{ padding: "0 24px 24px" }}>
      <PageHeader current={t("nav.docSdk")} />

      <Spin spinning={statsLoading}>
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title={t("docSdk.statInstalledComponents")}
                value={installedCount}
                suffix={`/ ${totalCount}`}
                prefix={<AppstoreOutlined />}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title={t("docSdk.statTotalComponents")}
                value={totalCount}
                prefix={<CloudOutlined />}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title={t("docSdk.statRedactionRules")}
                value={rulesCount}
                prefix={<SafetyOutlined />}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title={t("docSdk.statSystemStatus")}
                value={statusLabelMap[systemStatus]}
                prefix={<CheckCircleOutlined />}
                valueStyle={{
                  color: statusColorMap[systemStatus] === "green"
                    ? "#52c41a"
                    : statusColorMap[systemStatus] === "orange"
                      ? "#faad14"
                      : statusColorMap[systemStatus] === "red"
                        ? "#ff4d4f"
                        : undefined,
                }}
              />
            </Card>
          </Col>
        </Row>
      </Spin>

      <Tabs items={tabItems} />
    </div>
  );
}