﻿import React from "react";
import { Button, Card } from "@agentscope-ai/design";
import {
  CaretDownOutlined,
  CaretRightOutlined,
  FolderOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { MarkdownFile, DailyMemoryFile, WorkFileInfo } from "../../../../api/types";
import { buildMemoryTree } from "./FileItem";
import prettyBytes from "pretty-bytes";
import { formatTimeAgo } from "./utils";
import { useTranslation } from "react-i18next";
import styles from "../index.module.less";

interface FileListPanelProps {
  files: MarkdownFile[] | WorkFileInfo[];
  selectedFile: MarkdownFile | null;
  dailyMemories: DailyMemoryFile[];
  expandedMemory: boolean;
  workspacePath: string | null;
  onRefresh: () => void;
  onFileClick: (file: MarkdownFile) => void;
  onDailyMemoryClick: (daily: DailyMemoryFile) => void;
  onMemoryExpand?: () => void;
}

export const FileListPanel: React.FC<FileListPanelProps> = ({
  files,
  selectedFile,
  dailyMemories,
  onRefresh,
  onFileClick,
  onDailyMemoryClick,
}) => {
  const { t } = useTranslation();
  const [expandedDigestNodes, setExpandedDigestNodes] = React.useState<
    Set<string>
  >(() => new Set());
  const digestRoot = React.useMemo(
    () => buildMemoryTree(dailyMemories).digestRoot,
    [dailyMemories],
  );

  const isDigestNodeExpanded = (key: string) => expandedDigestNodes.has(key);

  const toggleDigestNode = (key: string) => {
    setExpandedDigestNodes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const renderDigestFile = (
    file: DailyMemoryFile,
    label: string,
    level = 0,
  ) => {
    const isSelected = selectedFile?.memory_path === file.filename;
    return (
      <div
        key={file.filename}
        onClick={() => onDailyMemoryClick(file)}
        className={`${styles.dailyMemoryItem} ${
          isSelected ? styles.selected : ""
        }`}
        style={{ marginLeft: level * 14 }}
      >
        <div className={styles.dailyMemoryName}>{label}</div>
        <div className={styles.dailyMemoryMeta}>
          {prettyBytes(file.size)} · {formatTimeAgo(file.updated_at)}
        </div>
      </div>
    );
  };

  const renderDigestNode = (
    node: typeof digestRoot,
    level = 0,
    path = node.name,
  ): React.ReactNode => {
    if (node.file) {
      return renderDigestFile(node.file, node.name, level);
    }
    const isExpanded = isDigestNodeExpanded(path);
    return (
      <div key={path}>
        <div
          className={`${styles.dailyMemoryItem} ${styles.memoryFolderItem}`}
          style={{ marginLeft: level * 14 }}
          onClick={() => toggleDigestNode(path)}
        >
          {isExpanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
          <FolderOutlined />
          <span>{node.name}</span>
        </div>
        {isExpanded &&
          node.children.map((child) =>
            renderDigestNode(child, level + 1, `${path}/${child.name}`),
          )}
      </div>
    );
  };

  // Normalize file list: accept both MarkdownFile[] and WorkFileInfo[]
  const normalizedFiles: MarkdownFile[] = (files as Array<MarkdownFile | WorkFileInfo>).map((f) => {
    if ("updated_at" in f) return f as MarkdownFile;
    const wf = f as WorkFileInfo;
    return {
      filename: wf.filename,
      path: wf.path,
      size: wf.size,
      created_time: wf.modified_time || "",
      modified_time: wf.modified_time || "",
      updated_at: wf.modified_time ? new Date(wf.modified_time).getTime() : Date.now(),
      is_work_file: true,
      work_file_path: wf.path,
    } as MarkdownFile;
  });

  return (
    <div className={styles.fileListPanel}>
      <Card
        styles={{
          body: {
            padding: 16,
            display: "flex",
            flexDirection: "column",
            height: "100%",
            overflow: "auto",
          },
        }}
        style={{ flex: 1, minHeight: 0 }}
      >
        <div className={styles.headerRow}>
          <h3 className={styles.sectionTitle}>{t("workspace.workFiles")}</h3>
          <Button size="small" onClick={onRefresh} icon={<ReloadOutlined />} />
        </div>

        <p className={styles.infoText}>{t("workspace.workFilesDesc")}</p>
        <div className={styles.divider} />

        <div className={styles.scrollContainer}>
          {normalizedFiles.length > 0 ? (
            normalizedFiles.map((file) => {
              const isSelected =
                selectedFile?.filename === file.filename;
              return (
                <div
                  key={file.filename}
                  onClick={() => onFileClick(file)}
                  className={`${styles.dailyMemoryItem} ${
                    isSelected ? styles.selected : ""
                  }`}
                >
                  <div className={styles.dailyMemoryName}>
                    {file.filename}
                  </div>
                  <div className={styles.dailyMemoryMeta}>
                    {prettyBytes(file.size)}
                    {file.updated_at && ` · ${formatTimeAgo(file.updated_at)}`}
                  </div>
                </div>
              );
            })
          ) : (
            <div className={styles.emptyState}>{t("workspace.noFiles")}</div>
          )}
          {digestRoot.children.length > 0 && renderDigestNode(digestRoot)}
        </div>
      </Card>
    </div>
  );
};