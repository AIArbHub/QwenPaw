import { Button, Input, Select, Tooltip, Dropdown } from "@agentscope-ai/design";
import { Badge } from "antd";
import type { MenuProps } from "antd";
import {
  AppstoreOutlined,
  CloseOutlined,
  DeleteOutlined,
  ReloadOutlined,
  SendOutlined,
  SyncOutlined,
  UnorderedListOutlined,
  SettingOutlined,
  GroupOutlined,
} from "@ant-design/icons";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ImportHubModal } from "../../Agent/Skills/components/ImportHubModal";
import { SkillFilterDropdown } from "../../Agent/Skills/components/SkillFilterDropdown";
import { AddSkillDropdown } from "../../Agent/Skills/components/AddSkillDropdown";
import {
  BroadcastModal,
  ImportBuiltinModal,
  PoolSkillCard,
  PoolSkillListItem,
  PoolSkillDrawer,
} from "./components";
import { getBuiltinNoticeLines } from "./builtinNotice";
import { useSkillPool } from "./useSkillPool";
import { useBuiltinUpdatePrefs, type BuiltinUpdatePolicy } from "./useBuiltinUpdatePrefs";
import { useProgressiveRender } from "../../../hooks/useProgressiveRender";
import { PageHeader } from "@/components/PageHeader";
import type { PoolSkillSpec } from "../../../api/types";
import styles from "./index.module.less";

interface GroupedSkillsViewProps {
  skills: PoolSkillSpec[];
  selectedPoolSkills: Set<string>;
  batchModeEnabled: boolean;
  automationPendingSkills: Set<string>;
  onToggleSelect: (name: string) => void;
  onEdit: (skill: PoolSkillSpec) => void;
  onBroadcast: (skill: PoolSkillSpec) => void;
  onDelete: (skill: PoolSkillSpec) => void;
  onAutomationQuickAction: (skill: PoolSkillSpec) => void | Promise<void>;
  styles: Record<string, string>;
  sentinelRef: React.RefObject<HTMLDivElement | null>;
  hasMore: boolean;
}

function GroupedSkillsView({
  skills,
  selectedPoolSkills,
  batchModeEnabled,
  automationPendingSkills,
  onToggleSelect,
  onEdit,
  onBroadcast,
  onDelete,
  onAutomationQuickAction,
  styles,
  sentinelRef,
  hasMore,
}: GroupedSkillsViewProps) {
  const { t } = useTranslation();

  const groups = useMemo(() => {
    const map = new Map<string, PoolSkillSpec[]>();
    for (const skill of skills) {
      const category = skill.tags?.[0] || t("skills.uncategorized", "未分类");
      if (!map.has(category)) {
        map.set(category, []);
      }
      map.get(category)!.push(skill);
    }
    return Array.from(map.entries()).sort((a, b) =>
      a[0].localeCompare(b[0], "zh"),
    );
  }, [skills, t]);

  return (
    <div className={styles.skillsGroupView}>
      {groups.map(([category, groupSkills]) => (
        <div key={category} className={styles.skillGroup}>
          <div className={styles.skillGroupHeader}>
            <span className={styles.skillGroupTitle}>{category}</span>
            <span className={styles.skillGroupCount}>
              {groupSkills.length}
            </span>
          </div>
          <div className={`${styles.skillsGrid} responsive-grid`}>
            {groupSkills.map((skill: PoolSkillSpec) => (
              <PoolSkillCard
                key={skill.name}
                skill={skill}
                isSelected={selectedPoolSkills.has(skill.name)}
                batchModeEnabled={batchModeEnabled}
                automationPending={automationPendingSkills.has(skill.name)}
                onToggleSelect={onToggleSelect}
                onEdit={onEdit}
                onBroadcast={onBroadcast}
                onDelete={onDelete}
                onAutomationQuickAction={onAutomationQuickAction}
              />
            ))}
          </div>
        </div>
      ))}
      {hasMore && <div ref={sentinelRef} style={{ height: 1 }} />}
    </div>
  );
}

function SkillPoolPage() {
  const { t } = useTranslation();
  const pool = useSkillPool();
  const updatePrefs = useBuiltinUpdatePrefs();

  const policyMenuItems: MenuProps["items"] = [
    {
      key: "safe_update",
      label: t("skillPool.policySafeUpdate", "用户未改则自动更新"),
    },
    {
      key: "ask",
      label: t("skillPool.policyAsk", "每次询问"),
    },
    {
      key: "never",
      label: t("skillPool.policyNever", "从不自动更新"),
    },
  ];

  const onPolicyChange: MenuProps["onClick"] = useCallback(
    ({ key }) => {
      updatePrefs.setPolicy(key as BuiltinUpdatePolicy);
    },
    [updatePrefs],
  );
  const builtinNoticeLines = getBuiltinNoticeLines(pool.builtinNotice, t);
  const {
    visibleItems: visibleSkills,
    hasMore,
    sentinelRef,
  } = useProgressiveRender(pool.sortedSkills);

  const navigate = useNavigate();

  const openMarket = useCallback(() => {
    navigate("/market?tab=skills&target=pool");
  }, [navigate]);

  return (
    <div className={styles.skillsPage}>
      <PageHeader
        items={[{ title: t("nav.settings") }, { title: t("nav.skillPool") }]}
        extra={
          <div className={styles.headerRight}>
            <input
              type="file"
              accept=".zip"
              ref={pool.zipInputRef}
              onChange={pool.handleZipImport}
              style={{ display: "none" }}
            />
            {pool.batchModeEnabled ? (
              <div className={styles.batchActions}>
                <span className={styles.batchCount}>
                  {t("skills.selectedCount", {
                    count: pool.selectedPoolSkills.size,
                  })}
                </span>
                <Button type="default" onClick={pool.selectAllPool}>
                  {t("skills.selectAll")}
                </Button>
                <Button
                  type="default"
                  onClick={pool.clearPoolSelection}
                  icon={<CloseOutlined />}
                >
                  {t("skills.clearSelection")}
                </Button>
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  onClick={pool.handleBatchDeletePool}
                >
                  {t("common.delete")} ({pool.selectedPoolSkills.size})
                </Button>
                <Button type="primary" onClick={pool.toggleBatchMode}>
                  {t("skills.exitBatch")}
                </Button>
              </div>
            ) : (
              <>
                <div className={styles.headerActionsLeft}>
                  <Tooltip title={t("skillPool.refreshHint")}>
                    <Button
                      type="default"
                      icon={<ReloadOutlined spin={pool.loading} />}
                      onClick={pool.handleRefresh}
                      disabled={pool.loading}
                    />
                  </Tooltip>
                  <Tooltip title={t("skillPool.broadcastHint")}>
                    <Button
                      type="default"
                      className={styles.primaryTransferButton}
                      icon={<SendOutlined />}
                      onClick={() => pool.openBroadcast()}
                    >
                      {t("skillPool.broadcast")}
                    </Button>
                  </Tooltip>
                  <Tooltip
                    title={
                      pool.hasUnseenBuiltinNotice
                        ? builtinNoticeLines.length > 0
                          ? builtinNoticeLines.map((line) => (
                              <div key={line}>{line}</div>
                            ))
                          : t("skillPool.importBuiltinAlertHint", {
                              count: pool.builtinNoticeTotal,
                            })
                        : t("skillPool.importBuiltinHint")
                    }
                  >
                    <Badge
                      dot={pool.hasUnseenBuiltinNotice}
                      color="rgba(0, 101, 253, 1)"
                      offset={[-4, 4]}
                    >
                      <Button
                        type="default"
                        icon={<SyncOutlined />}
                        onClick={() => void pool.openImportBuiltin()}
                      >
                        {t("skillPool.importBuiltin")}
                      </Button>
                    </Badge>
                  </Tooltip>
                </div>
                <div className={styles.headerActionsRight}>
                  <Dropdown
                    menu={{ items: policyMenuItems, onClick: onPolicyChange, selectedKeys: [updatePrefs.policy] }}
                    trigger={["click"]}
                  >
                    <Tooltip title={t("skillPool.updatePolicyHint", "内置技能更新策略")}>
                      <Button type="default" icon={<SettingOutlined />}>
                        {t("skillPool.updatePolicy", "更新策略")}
                      </Button>
                    </Tooltip>
                  </Dropdown>
                  <Button type="primary" onClick={pool.toggleBatchMode}>
                    {t("skills.batchOperation")}
                  </Button>
                  <AddSkillDropdown
                    onCreate={pool.openCreate}
                    onUploadZip={() => pool.zipInputRef.current?.click()}
                    onFromUrl={() => pool.setImportModalOpen(true)}
                    onBrowseMarket={openMarket}
                  />
                </div>
              </>
            )}
          </div>
        }
      />

      {/* ---- Scrollable Content ---- */}
      <div className={styles.content}>
        {/* Toolbar */}
        {!pool.loading && pool.skills.length > 0 && (
          <div className={styles.toolbar}>
            <div className={styles.searchContainer}>
              <Input
                className={styles.searchInput}
                placeholder={t("skills.searchPlaceholder")}
                value={pool.searchQuery}
                onChange={(e) => pool.setSearchQuery(e.target.value)}
                allowClear
              />
              <Select
                mode="multiple"
                className={styles.tagSelect}
                placeholder={t("skills.filterByTag")}
                value={pool.searchTags}
                onChange={pool.setSearchTags}
                open={pool.filterOpen}
                onOpenChange={pool.setFilterOpen}
                allowClear
                maxTagCount="responsive"
                notFoundContent={<></>}
                popupRender={() =>
                  pool.allTags.length > 0 ? (
                    <SkillFilterDropdown
                      allTags={pool.allTags}
                      searchTags={pool.searchTags}
                      setSearchTags={pool.setSearchTags}
                      styles={styles}
                    />
                  ) : (
                    <div className={styles.tagSelectEmpty}>
                      {t("skills.noTags")}
                    </div>
                  )
                }
              />
            </div>
            <div className={styles.toolbarRight}>
              <div className={styles.viewToggle}>
                <button
                  className={`${styles.viewToggleBtn} ${
                    pool.viewMode === "group" ? styles.viewToggleBtnActive : ""
                  }`}
                  onClick={() => pool.setViewMode("group")}
                  title={t("skills.groupView", "分组视图")}
                >
                  <GroupOutlined />
                </button>
                <button
                  className={`${styles.viewToggleBtn} ${
                    pool.viewMode === "list" ? styles.viewToggleBtnActive : ""
                  }`}
                  onClick={() => pool.setViewMode("list")}
                  title={t("skills.listView")}
                >
                  <UnorderedListOutlined />
                </button>
                <button
                  className={`${styles.viewToggleBtn} ${
                    pool.viewMode === "card" ? styles.viewToggleBtnActive : ""
                  }`}
                  onClick={() => pool.setViewMode("card")}
                  title={t("skills.gridView")}
                >
                  <AppstoreOutlined />
                </button>
              </div>
            </div>
          </div>
        )}

        {pool.loading ? (
          <div className={styles.loading}>
            <span className={styles.loadingText}>{t("common.loading")}</span>
          </div>
        ) : pool.sortedSkills.length === 0 && pool.skills.length > 0 ? (
          <div className={styles.noSearchResults}>
            <span className={styles.noSearchResultsIcon}>🔍</span>
            <span className={styles.noSearchResultsText}>
              {t("skills.noSearchResults")}
            </span>
          </div>
        ) : pool.viewMode === "group" ? (
          <GroupedSkillsView
            skills={visibleSkills}
            selectedPoolSkills={pool.selectedPoolSkills}
            batchModeEnabled={pool.batchModeEnabled}
            automationPendingSkills={pool.automationPendingSkills}
            onToggleSelect={pool.togglePoolSelect}
            onEdit={pool.openEdit}
            onBroadcast={pool.openBroadcast}
            onDelete={pool.handleDelete}
            onAutomationQuickAction={pool.handleAutomationQuickAction}
            styles={styles}
            sentinelRef={sentinelRef}
            hasMore={hasMore}
          />
        ) : pool.viewMode === "card" ? (
          <div className={`${styles.skillsGrid} responsive-grid`}>
            {visibleSkills.map((skill: PoolSkillSpec) => (
              <PoolSkillCard
                key={skill.name}
                skill={skill}
                isSelected={pool.selectedPoolSkills.has(skill.name)}
                batchModeEnabled={pool.batchModeEnabled}
                automationPending={pool.automationPendingSkills.has(skill.name)}
                onToggleSelect={pool.togglePoolSelect}
                onEdit={pool.openEdit}
                onBroadcast={pool.openBroadcast}
                onDelete={pool.handleDelete}
                onAutomationQuickAction={pool.handleAutomationQuickAction}
              />
            ))}
            {hasMore && <div ref={sentinelRef} style={{ height: 1 }} />}
          </div>
        ) : (
          <div className={styles.skillsList}>
            {visibleSkills.map((skill: PoolSkillSpec) => (
              <PoolSkillListItem
                key={skill.name}
                skill={skill}
                isSelected={pool.selectedPoolSkills.has(skill.name)}
                batchModeEnabled={pool.batchModeEnabled}
                onToggleSelect={pool.togglePoolSelect}
                onEdit={pool.openEdit}
                onBroadcast={pool.openBroadcast}
                onDelete={pool.handleDelete}
              />
            ))}
            {hasMore && <div ref={sentinelRef} style={{ height: 1 }} />}
          </div>
        )}
      </div>

      <ImportHubModal
        open={pool.importModalOpen}
        importing={pool.importing}
        onCancel={pool.closeImportModal}
        onConfirm={pool.handleConfirmImport}
        hint={t("skillPool.externalHubHint")}
      />

      <BroadcastModal
        open={pool.mode === "broadcast"}
        skills={pool.skills}
        workspaces={pool.workspaces}
        initialSkillNames={pool.broadcastInitialNames}
        onCancel={pool.closeModal}
        onConfirm={pool.handleBroadcast}
      />

      <ImportBuiltinModal
        open={pool.importBuiltinModalOpen}
        loading={pool.importBuiltinLoading}
        sources={pool.builtinSources}
        notice={pool.builtinNotice}
        defaultLanguage={pool.builtinLanguage}
        defaultSelectedNames={pool.builtinNotice?.actionable_skill_names}
        onCancel={pool.closeImportBuiltin}
        onConfirm={pool.handleImportBuiltins}
      />

      <PoolSkillDrawer
        mode={pool.mode}
        activeSkill={pool.activeSkill}
        loading={pool.detailLoading}
        saving={pool.saving}
        skillName={pool.detailSkillName}
        form={pool.form}
        drawerContent={pool.drawerContent}
        showMarkdown={pool.showMarkdown}
        configText={pool.configText}
        availableTags={pool.allTags}
        workspaces={pool.workspaces}
        builtinAutoUpdateEnabled={pool.builtinAutoUpdateEnabled}
        autoSyncEnabled={pool.autoSyncEnabled}
        autoSyncTargets={pool.autoSyncTargets}
        onClose={pool.closeDrawer}
        onSave={pool.handleSavePoolSkill}
        onContentChange={pool.handleDrawerContentChange}
        onShowMarkdownChange={pool.setShowMarkdown}
        onConfigTextChange={pool.setConfigText}
        onChangeBuiltinLanguage={pool.handleBuiltinLanguageSwitch}
        onBuiltinAutoUpdateEnabledChange={pool.setBuiltinAutoUpdateEnabled}
        onAutoSyncEnabledChange={pool.setAutoSyncEnabled}
        onAutoSyncTargetsChange={pool.setAutoSyncTargets}
        validateFrontmatter={pool.validateFrontmatter}
      />

      {pool.conflictRenameModal}
    </div>
  );
}

export default SkillPoolPage;
