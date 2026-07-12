/**
 * Case detail view: the main workspace when a case is selected.
 * Contains header, stage bar, message panel, sidebar, and all modals.
 */
import { useState, useMemo } from "react";
import { Button, Tag, Dropdown, Tooltip, Segmented, Select, Space } from "antd";
import type { MenuProps } from "antd";
import {
  ThunderboltOutlined,
  AppstoreOutlined,
  ExpandAltOutlined,
  CompressOutlined,
  UsergroupAddOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  TeamOutlined,
  SwapOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";
import {
  mootApi,
  CASE_STAGE_LABELS,
  type CaseStage,
  type EventType,
  type FileVisibility,
} from "@/api/modules/moot";
import { useMootState } from "../hooks/useMootState";
import { StageBar } from "./StageBar";
import { MessagePanel } from "./MessagePanel";
import { SidebarPanel } from "./SidebarPanel";
import {
  CreateCaseModal,
  AddParticipantModal,
  AddPartyModal,
  ProcAppModal,
  ChangeRulesModal,
  ChangeTribunalModal,
  ChangeClaimsModal,
  DocGenModal,
  ScoreModal,
} from "./CaseModals";
import { getCaseGuidanceSteps, getCaseProgressSummary } from "../utils";
import styles from "../index.module.less";

function getStageColor(stage: CaseStage): string {
  if (stage === "closed") return "#8c8c8c";
  if (stage === "award") return "#52c41a";
  if (stage === "hearing" || stage === "deliberation") return "#1890ff";
  if (stage === "draft") return "#d9d9d9";
  return "#722ed1";
}

interface CaseDetailViewProps {
  state: ReturnType<typeof useMootState>;
}

export function CaseDetailView({ state }: CaseDetailViewProps) {
  const { t } = useTranslation();
  const {
    currentCase,
    messages,
    caseFiles,
    loading,
    selectedParticipant,
    setSelectedParticipant,
    inputText,
    setInputText,
    viewMode,
    setViewMode,
    currentRoleParticipantId,
    setCurrentRoleParticipantId,
    activeParticipants,
    visitedStages,
    previousStage,
    isStageEnabled,
    isFullScreen,
    setIsFullScreen,
    sidebarCollapsed,
    setSidebarCollapsed,
    isSelectionMode,
    setIsSelectionMode,
    selectedMessageIds,
    toggleMessageSelection,
    selectAllMessages,
    clearSelection,
    caseTemplates,
    arbitrationRules,
    docTemplates,
    availableAgents,
    collaborationPresetId,
    setCollaborationPresetId,
    handleCreate,
    handleDelete,
    handleSpeak,
    handleAutoSpeak,
    requestStageChange,
    handleUndoStage,
    handleBack,
    handleUpdateCollabMode,
    handleRemoveParticipant,
    handleAddParticipant,
    handleUploadFile,
    handleDeleteFile,
    handleShareFile,
    handleGenerateDocument,
    handleScoreParticipant,
  } = state;

  // ── Modal states ──
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [addParticipantOpen, setAddParticipantOpen] = useState(false);
  const [addPartyOpen, setAddPartyOpen] = useState(false);
  const [procAppOpen, setProcAppOpen] = useState(false);
  const [changeRulesOpen, setChangeRulesOpen] = useState(false);
  const [changeTribunalOpen, setChangeTribunalOpen] = useState(false);
  const [changeClaimsOpen, setChangeClaimsOpen] = useState(false);
  const [docGenOpen, setDocGenOpen] = useState(false);
  const [scoreOpen, setScoreOpen] = useState(false);

  if (!currentCase) return null;

  // ── Derived ──
  const guidanceSteps = useMemo(
    () => getCaseGuidanceSteps(currentCase),
    [currentCase],
  );
  const progressSummary = useMemo(
    () => getCaseProgressSummary(guidanceSteps),
    [guidanceSteps],
  );

  const currentSpeakerName =
    activeParticipants.find(
      (p) => p.participant_id === currentCase.current_speaker,
    )?.display_name || currentCase.current_speaker || "";

  // ── Stage menu items ──
  const stageMenuItems: MenuProps["items"] = useMemo(
    () =>
      (Object.keys(CASE_STAGE_LABELS) as CaseStage[]).map((stage) => ({
        key: stage,
        label: `${CASE_STAGE_LABELS[stage]}${
          stage === currentCase.current_stage ? " (当前)" : ""
        }`,
        disabled: stage === currentCase.current_stage,
        onClick: () => requestStageChange(stage),
      })),
    [currentCase.current_stage, requestStageChange],
  );

  // ── Case change menu ──
  const caseChangeMenuItems: MenuProps["items"] = [
    {
      key: "add_party",
      label: "新增当事人",
      icon: <UsergroupAddOutlined />,
      onClick: () => setAddPartyOpen(true),
    },
    {
      key: "proc_app",
      label: "提交程序申请",
      icon: <ExperimentOutlined />,
      onClick: () => setProcAppOpen(true),
    },
    { type: "divider" },
    {
      key: "change_rules",
      label: "变更仲裁规则",
      icon: <FileTextOutlined />,
      onClick: () => setChangeRulesOpen(true),
    },
    {
      key: "change_tribunal",
      label: "变更仲裁庭",
      icon: <TeamOutlined />,
      onClick: () => setChangeTribunalOpen(true),
    },
    {
      key: "change_claims",
      label: "变更仲裁请求",
      icon: <SwapOutlined />,
      onClick: () => setChangeClaimsOpen(true),
    },
  ];

  // ── Handle case change submissions ──
  const handleChangeRules = async (rules?: string[], description?: string) => {
    if (!currentCase) return;
    try {
      await mootApi.changeProcedure(currentCase.case_id, rules, description);
      await state.loadCase(currentCase.case_id);
    } catch {
      // error handled by API
    }
  };

  const handleChangeTribunal = async (
    description: string,
    data?: Record<string, unknown>,
  ) => {
    if (!currentCase) return;
    try {
      await mootApi.changeTribunal(currentCase.case_id, description, data);
      await state.loadCase(currentCase.case_id);
    } catch {
      // error handled
    }
  };

  const handleChangeClaims = async (
    description: string,
    actorParticipantId?: string,
  ) => {
    if (!currentCase) return;
    try {
      await mootApi.changeClaims(
        currentCase.case_id,
        description,
        actorParticipantId,
      );
      await state.loadCase(currentCase.case_id);
    } catch {
      // error handled
    }
  };

  const handleSubmitProcApp = async (
    eventType: EventType,
    description: string,
    actorParticipantId?: string,
  ) => {
    if (!currentCase) return;
    try {
      await mootApi.submitProceduralApplication(
        currentCase.case_id,
        eventType,
        description,
        actorParticipantId,
      );
      await state.loadCase(currentCase.case_id);
    } catch {
      // error handled
    }
  };

  // ── Selection mode handlers ──
  const handleDeleteSelected = () => {
    // Client-side deletion (API doesn't support individual message deletion)
    clearSelection();
  };

  const handleShareSelected = () => {
    // Generate a simple text share
    const selected = messages.filter((m) => selectedMessageIds.has(m.id));
    const text = selected
      .map(
        (m) =>
          `[${dayjs(m.timestamp * 1000).format("HH:mm:ss")}] ${m.display_name}: ${m.content}`,
      )
      .join("\n");
    navigator.clipboard.writeText(text);
    clearSelection();
  };

  return (
    <div className={styles.container}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Users style={{ fontSize: 18, color: "var(--ant-color-primary)" }} />
          <span className={styles.caseName}>{currentCase.case_name}</span>
          <Tag color={getStageColor(currentCase.current_stage)}>
            {currentCase.current_stage_label}
          </Tag>
          {currentSpeakerName && (
            <span style={{ fontSize: 12, color: "var(--ant-color-text-secondary)" }}>
              当前发言：{currentSpeakerName}
            </span>
          )}
          {/* Progress badge */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginLeft: 8,
              padding: "2px 8px",
              border: "1px solid var(--ant-color-border-secondary)",
              borderRadius: 999,
              background: "var(--ant-color-bg-layout)",
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600 }}>
              准备度 {progressSummary.percent}%
            </span>
            <span style={{ fontSize: 12, color: "var(--ant-color-text-secondary)" }}>
              {progressSummary.label}
            </span>
          </div>
          {/* View mode toggle */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 8 }}>
            <Segmented
              size="small"
              value={viewMode}
              onChange={(v) => setViewMode(v as "director" | "role")}
              options={[
                { value: "director", label: "🎬 导演" },
                { value: "role", label: "🎭 角色" },
              ]}
            />
            {viewMode === "role" && (
              <Select
                size="small"
                value={currentRoleParticipantId || undefined}
                onChange={setCurrentRoleParticipantId}
                placeholder="选择角色"
                style={{ minWidth: 100 }}
                options={activeParticipants.map((p) => ({
                  value: p.participant_id,
                  label: `${p.display_name}${p.role_detail ? `(${p.role_detail})` : ""}`,
                }))}
              />
            )}
          </div>
        </div>

        <div className={styles.headerRight}>
          {currentCase.status !== "closed" && (
            <>
              {previousStage && (
                <Button
                  size="small"
                  onClick={handleUndoStage}
                  loading={loading}
                  style={{ marginRight: 8 }}
                >
                  撤销上一步
                </Button>
              )}
              <Dropdown menu={{ items: stageMenuItems }} placement="bottomRight">
                <Button
                  icon={<ThunderboltOutlined />}
                  loading={loading}
                  size="small"
                >
                  切换阶段
                </Button>
              </Dropdown>
            </>
          )}
          <Dropdown
            menu={{ items: caseChangeMenuItems }}
            trigger={["click"]}
          >
            <Button icon={<AppstoreOutlined />} loading={loading} size="small">
              案件变更
            </Button>
          </Dropdown>
          <Tooltip title={isFullScreen ? "退出全屏" : "全屏模式"}>
            <Button
              size="small"
              icon={isFullScreen ? <CompressOutlined /> : <ExpandAltOutlined />}
              onClick={() => setIsFullScreen(!isFullScreen)}
            />
          </Tooltip>
          <Button size="small" onClick={handleBack}>
            {t("moot.back", "返回列表")}
          </Button>
        </div>
      </div>

      {/* ── Stage Bar ── */}
      <StageBar
        currentStage={currentCase.current_stage}
        visitedStages={visitedStages}
        isStageEnabled={isStageEnabled}
        isClosed={currentCase.status === "closed"}
        onStageClick={requestStageChange}
      />

      {/* ── Body ── */}
      <div
        className={`${styles.body} ${isFullScreen ? styles.fullScreenMode : ""}`}
      >
        <div className={styles.contentWrapper}>
          <div className={styles.leftColumn}>
            <MessagePanel
              messages={messages}
              participants={activeParticipants}
              selectedParticipant={selectedParticipant}
              onSelectParticipant={setSelectedParticipant}
              inputText={inputText}
              onInputChange={setInputText}
              onSpeak={handleSpeak}
              onAutoSpeak={handleAutoSpeak}
              isClosed={currentCase.status === "closed"}
              currentStage={currentCase.current_stage}
              isSelectionMode={isSelectionMode}
              selectedMessageIds={selectedMessageIds}
              onToggleSelection={toggleMessageSelection}
              onSelectAll={selectAllMessages}
              onClearSelection={clearSelection}
              onEnterSelectionMode={() => setIsSelectionMode(true)}
              onDeleteSelected={handleDeleteSelected}
              onShareSelected={handleShareSelected}
              viewMode={viewMode}
              currentRoleParticipantId={currentRoleParticipantId}
              onSelectRoleParticipant={setCurrentRoleParticipantId}
            />
          </div>
        </div>

        {/* ── Sidebar ── */}
        {!isFullScreen && (
          <SidebarPanel
            caseData={currentCase}
            participants={activeParticipants}
            caseFiles={caseFiles}
            events={currentCase.events}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
            onAddParticipant={() => setAddParticipantOpen(true)}
            onUploadFile={() => {
              // Trigger file upload via hidden input or modal
              const input = document.createElement("input");
              input.type = "file";
              input.onchange = async () => {
                if (input.files && input.files[0] && activeParticipants[0]) {
                  await handleUploadFile(
                    input.files[0],
                    activeParticipants[0].participant_id,
                    "shared" as FileVisibility,
                    "",
                    "",
                  );
                }
              };
              input.click();
            }}
            onUpdateCollabMode={handleUpdateCollabMode}
            onRemoveParticipant={handleRemoveParticipant}
            onDeleteFile={handleDeleteFile}
            onShareFile={handleShareFile}
            onGenerateDocument={() => setDocGenOpen(true)}
            onScoreParticipant={() => setScoreOpen(true)}
          />
        )}
      </div>

      {/* ── Modals ── */}
      <CreateCaseModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        templates={caseTemplates}
        rules={arbitrationRules}
        collaborationPresetId={collaborationPresetId}
        onPresetChange={setCollaborationPresetId}
        onCreate={handleCreate}
        loading={loading}
      />

      <AddParticipantModal
        open={addParticipantOpen}
        onClose={() => setAddParticipantOpen(false)}
        availableAgents={availableAgents}
        onAdd={handleAddParticipant}
        loading={loading}
      />

      <AddPartyModal
        open={addPartyOpen}
        onClose={() => setAddPartyOpen(false)}
        availableAgents={availableAgents}
        onAdd={async (params) => {
          await handleAddParticipant(params);
          // Also create a party_change event
          if (currentCase) {
            try {
              await mootApi.addCaseEvent(currentCase.case_id, {
                event_type: "party_change" as EventType,
                description: `新增当事人：${params.display_name}`,
              });
            } catch {
              // ignore
            }
          }
        }}
        loading={loading}
      />

      <ProcAppModal
        open={procAppOpen}
        onClose={() => setProcAppOpen(false)}
        onSubmit={handleSubmitProcApp}
        loading={loading}
      />

      <ChangeRulesModal
        open={changeRulesOpen}
        onClose={() => setChangeRulesOpen(false)}
        currentRules={currentCase.rules}
        rules={arbitrationRules}
        onSubmit={handleChangeRules}
        loading={loading}
      />

      <ChangeTribunalModal
        open={changeTribunalOpen}
        onClose={() => setChangeTribunalOpen(false)}
        onSubmit={handleChangeTribunal}
        loading={loading}
      />

      <ChangeClaimsModal
        open={changeClaimsOpen}
        onClose={() => setChangeClaimsOpen(false)}
        onSubmit={handleChangeClaims}
        loading={loading}
      />

      <DocGenModal
        open={docGenOpen}
        onClose={() => setDocGenOpen(false)}
        docTemplates={docTemplates}
        participants={activeParticipants}
        onGenerate={handleGenerateDocument}
      />

      <ScoreModal
        open={scoreOpen}
        onClose={() => setScoreOpen(false)}
        participants={activeParticipants}
        onScore={handleScoreParticipant}
      />
    </div>
  );
}
