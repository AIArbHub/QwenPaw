import { useTranslation } from "react-i18next";
import { Steps, Tag, Tooltip, Space } from "antd";
import {
  UploadOutlined,
  FileSearchOutlined,
  SafetyOutlined,
  CheckCircleOutlined,
  FileDoneOutlined,
  LoadingOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";

export type PipelineStage =
  | "uploaded"
  | "parsing"
  | "parsed"
  | "desensitizing"
  | "desensitized"
  | "validating"
  | "validated"
  | "ready"
  | "failed";

interface PipelineStatusProps {
  /** Current status from the document */
  status: string;
  /** Whether the document has been desensitized */
  desensitized: boolean;
  /** Whether the document has been validated */
  validated?: boolean;
  /** Security level tag */
  securityLevel?: "T1" | "T2" | "T3";
  /** Engine used for parsing */
  parseEngine?: string;
  /** Engine used for desensitization */
  desensEngine?: string;
  /** Compact mode for card display */
  compact?: boolean;
}

/**
 * Maps document status + desensitized flag to pipeline stage.
 */
function getPipelineStage(
  status: string,
  desensitized: boolean,
  validated?: boolean,
): PipelineStage {
  if (status === "failed") return "failed";
  if (status === "parsing") return "parsing";
  if (status === "desensitizing" || status === "processing")
    return "desensitizing";
  if (validated) return "ready";
  if (desensitized) return "desensitized";
  if (status === "ready" || status === "parsed") return "parsed";
  return "uploaded";
}

const stageOrder: PipelineStage[] = [
  "uploaded",
  "parsed",
  "desensitized",
  "ready",
];

const stageIcons: Record<string, React.ReactNode> = {
  uploaded: <UploadOutlined />,
  parsing: <LoadingOutlined />,
  parsed: <FileSearchOutlined />,
  desensitizing: <LoadingOutlined />,
  desensitized: <SafetyOutlined />,
  validating: <LoadingOutlined />,
  validated: <CheckCircleOutlined />,
  ready: <FileDoneOutlined />,
  failed: <CloseCircleOutlined />,
};

export default function PipelineStatus({
  status,
  desensitized,
  validated,
  securityLevel,
  parseEngine,
  desensEngine,
  compact = false,
}: PipelineStatusProps) {
  const { t } = useTranslation();
  const currentStage = getPipelineStage(status, desensitized, validated);
  const failed = currentStage === "failed";

  // Find current step index
  const currentStep = failed
    ? stageOrder.indexOf("desensitized") // Show failure at the current processing stage
    : stageOrder.indexOf(currentStage);

  if (compact) {
    // Compact mode: show as inline tags
    const stages = [
      { key: "uploaded", label: t("documents.pipeline.uploaded") },
      { key: "parsed", label: t("documents.pipeline.parsed") },
      { key: "desensitized", label: t("documents.pipeline.desensitized") },
      { key: "ready", label: t("documents.pipeline.ready") },
    ];

    return (
      <Space size={4} wrap>
        {stages.map((s, idx) => {
          const stage = s.key as PipelineStage;
          const done = !failed && idx < currentStep;
          const active = !failed && idx === currentStep;
          const isFailed = failed && idx === currentStep;

          let color = "default";
          let icon = <ClockCircleOutlined />;

          if (done) {
            color = "success";
            icon = <CheckCircleOutlined />;
          } else if (active) {
            color = "processing";
            icon = <LoadingOutlined />;
          } else if (isFailed) {
            color = "error";
            icon = <CloseCircleOutlined />;
          }

          return (
            <Tag key={s.key} color={color} icon={icon} style={{ fontSize: 11 }}>
              {s.label}
            </Tag>
          );
        })}
        {securityLevel && (
          <Tag
            color={
              securityLevel === "T1"
                ? "green"
                : securityLevel === "T2"
                  ? "blue"
                  : "orange"
            }
            style={{ fontSize: 11 }}
          >
            {securityLevel === "T1" && "🔒"}
            {securityLevel === "T2" && "⚖️"}
            {securityLevel === "T3" && "☁️"} {securityLevel}
          </Tag>
        )}
      </Space>
    );
  }

  // Full mode: Steps component
  return (
    <div>
      <Steps
        size="small"
        current={failed ? currentStep : currentStep}
        status={failed ? "error" : "process"}
        items={[
          {
            title: t("documents.pipeline.uploaded"),
            icon: stageIcons.uploaded,
          },
          {
            title: t("documents.pipeline.parsed"),
            icon: currentStage === "parsing" ? stageIcons.parsing : undefined,
            description: parseEngine && (
              <Tag style={{ fontSize: 11 }}>{parseEngine}</Tag>
            ),
          },
          {
            title: t("documents.pipeline.desensitized"),
            icon:
              currentStage === "desensitizing"
                ? stageIcons.desensitizing
                : undefined,
            description: desensEngine && (
              <Tag style={{ fontSize: 11 }}>{desensEngine}</Tag>
            ),
          },
          {
            title: t("documents.pipeline.ready"),
            icon:
              currentStage === "validating"
                ? stageIcons.validating
                : undefined,
          },
        ]}
      />
      {securityLevel && (
        <div style={{ marginTop: 8 }}>
          <Tag
            color={
              securityLevel === "T1"
                ? "green"
                : securityLevel === "T2"
                  ? "blue"
                  : "orange"
            }
          >
            {securityLevel === "T1" && "🔒"}
            {securityLevel === "T2" && "⚖️"}
            {securityLevel === "T3" && "☁️"} {securityLevel} —{" "}
            {t(`documents.security.${securityLevel.toLowerCase()}`)}
          </Tag>
        </div>
      )}
    </div>
  );
}
