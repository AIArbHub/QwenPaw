/**
 * Visual stage progression bar for the Moot case.
 * Shows 16 arbitration stages with visited/current/disabled states.
 */
import { CASE_STAGE_LABELS, type CaseStage } from "@/api/modules/moot";
import styles from "../index.module.less";

const ALL_STAGES: CaseStage[] = [
  "draft", "filing", "service", "defense",
  "arbitrator_selection", "tribunal_formation", "jurisdiction_objection",
  "challenge", "appraisal", "merger", "pre_hearing", "hearing",
  "deliberation", "award", "enforcement", "closed",
];

interface StageBarProps {
  currentStage: CaseStage;
  visitedStages: Set<CaseStage>;
  isStageEnabled: (stage: CaseStage) => boolean;
  isClosed: boolean;
  onStageClick: (stage: CaseStage) => void;
}

export function StageBar({
  currentStage,
  visitedStages,
  isStageEnabled,
  isClosed,
  onStageClick,
}: StageBarProps) {
  return (
    <div className={styles.stageBar}>
      {ALL_STAGES.map((stage) => {
        const isCurrent = stage === currentStage;
        const isVisited = visitedStages.has(stage) && !isCurrent;
        const enabled = isStageEnabled(stage);
        const isDisabled = !enabled && !isCurrent;

        return (
          <div
            key={stage}
            className={`${styles.stageBarItem} ${
              isCurrent ? styles.stageBarActive : isVisited ? styles.stageBarDone : ""
            } ${isDisabled ? styles.stageBarDisabled : ""}`}
            style={
              isDisabled ? { cursor: "not-allowed", opacity: 0.4 } : undefined
            }
            title={isDisabled ? "开发中，敬请期待" : CASE_STAGE_LABELS[stage]}
            onClick={() => {
              if (isDisabled || isClosed) return;
              if (stage !== currentStage) onStageClick(stage);
            }}
          >
            <div className={styles.stageBarDot}>
              {isVisited ? "✓" : isCurrent ? "●" : "○"}
            </div>
            <span className={styles.stageBarLabel}>
              {CASE_STAGE_LABELS[stage]}
            </span>
          </div>
        );
      })}
    </div>
  );
}
