import React from "react";
import { Button, Input, Switch, Spin } from "antd";
import {
  ReloadOutlined,
  UndoOutlined,
  SaveOutlined,
  HolderOutlined,
} from "@ant-design/icons";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { MarkdownFile } from "@/api/types/workspace";
import { useTranslation } from "react-i18next";
import prettyBytes from "pretty-bytes";

interface CoreConfigExpertPanelProps {
  files: MarkdownFile[];
  enabledFiles: string[];
  selectedFile: MarkdownFile | null;
  fileContent: string;
  hasChanges: boolean;
  loading: boolean;
  onFileClick: (file: MarkdownFile) => void;
  onContentChange: (content: string) => void;
  onSave: () => void;
  onReset: () => void;
  onToggleEnabled: (filename: string) => void;
  onReorder: (newOrder: string[]) => void;
  onRefresh: () => void;
}

/** A single draggable file row */
const SortableFileRow: React.FC<{
  file: MarkdownFile;
  enabled: boolean;
  selected: boolean;
  onClick: () => void;
  onToggle: () => void;
}> = ({ file, enabled, selected, onClick, onToggle }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: file.filename });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`core-config-row ${selected ? "selected" : ""}`}
      onClick={onClick}
    >
      <span className="drag-handle" {...attributes} {...listeners}>
        <HolderOutlined />
      </span>
      <Switch size="small" checked={enabled} onChange={onToggle} />
      <span className="file-name">{file.filename}</span>
      <span className="file-size">{prettyBytes(file.size)}</span>
    </div>
  );
};

export const CoreConfigExpertPanel: React.FC<CoreConfigExpertPanelProps> = ({
  files,
  enabledFiles,
  selectedFile,
  fileContent,
  hasChanges,
  loading,
  onFileClick,
  onContentChange,
  onSave,
  onReset,
  onToggleEnabled,
  onReorder,
  onRefresh,
}) => {
  const { t } = useTranslation();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = enabledFiles.indexOf(active.id as string);
    const newIndex = enabledFiles.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(arrayMove(enabledFiles, oldIndex, newIndex));
  };

  const enabledFileObjs = enabledFiles
    .map((filename) => files.find((f) => f.filename === filename))
    .filter((f): f is MarkdownFile => Boolean(f));
  const disabledFileObjs = files.filter(
    (f) => !enabledFiles.includes(f.filename),
  );

  return (
    <Spin spinning={loading}>
      <div style={{ display: "flex", gap: 16, minHeight: 400 }}>
        <div style={{ width: 280, flexShrink: 0 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 13 }}>
              {t("workspace.coreFiles")}
            </span>
            <Button
              size="small"
              type="text"
              icon={<ReloadOutlined />}
              onClick={onRefresh}
            />
          </div>
          <p style={{ fontSize: 12, color: "#999", marginBottom: 8 }}>
            {t("workspace.coreFilesDesc")}
          </p>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={enabledFiles}
              strategy={verticalListSortingStrategy}
            >
              {enabledFileObjs.map((file) => (
                <SortableFileRow
                  key={file.filename}
                  file={file}
                  enabled={true}
                  selected={selectedFile?.filename === file.filename}
                  onClick={() => onFileClick(file)}
                  onToggle={() => onToggleEnabled(file.filename)}
                />
              ))}
            </SortableContext>
          </DndContext>

          {disabledFileObjs.length > 0 && (
            <>
              <div
                style={{
                  borderTop: "1px solid #f0f0f0",
                  marginTop: 8,
                  paddingTop: 8,
                  fontSize: 12,
                  color: "#999",
                  marginBottom: 4,
                }}
              >
                {t("workspace.disabledFiles")}
              </div>
              {disabledFileObjs.map((file) => (
                <SortableFileRow
                  key={file.filename}
                  file={file}
                  enabled={false}
                  selected={selectedFile?.filename === file.filename}
                  onClick={() => onFileClick(file)}
                  onToggle={() => onToggleEnabled(file.filename)}
                />
              ))}
            </>
          )}

          {files.length === 0 && (
            <div style={{ color: "#999", fontSize: 13, padding: 16 }}>
              {t("workspace.noFiles")}
            </div>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {selectedFile ? (
            <>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 8,
                }}
              >
                <div>
                  <span style={{ fontWeight: 600 }}>
                    {selectedFile.filename}
                  </span>
                  <span style={{ fontSize: 12, color: "#999", marginLeft: 8 }}>
                    {selectedFile.path}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span
                    style={{
                      fontSize: 12,
                      color: hasChanges ? "#faad14" : "#52c41a",
                    }}
                  >
                    {hasChanges ? t("workspace.unsaved") : t("workspace.saved")}
                  </span>
                  <Button
                    size="small"
                    icon={<UndoOutlined />}
                    onClick={onReset}
                    disabled={!hasChanges}
                  >
                    {t("common.reset")}
                  </Button>
                  <Button
                    type="primary"
                    size="small"
                    icon={<SaveOutlined />}
                    onClick={onSave}
                    disabled={!hasChanges}
                  >
                    {t("common.save")}
                  </Button>
                </div>
              </div>
              <Input.TextArea
                value={fileContent}
                onChange={(e) => onContentChange(e.target.value)}
                style={{
                  minHeight: 400,
                  fontFamily: "monospace",
                  fontSize: 13,
                }}
                autoSize={{ minRows: 20, maxRows: 40 }}
              />
            </>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: 400,
                color: "#999",
                fontSize: 14,
              }}
            >
              {t("workspace.selectFile")}
            </div>
          )}
        </div>
      </div>

      <style>{`
        .core-config-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 8px;
          border-radius: 6px;
          cursor: pointer;
          transition: background 0.2s;
          border: 1px solid transparent;
        }
        .core-config-row:hover {
          background: #f5f5f5;
        }
        .core-config-row.selected {
          background: #e6f4ff;
          border-color: #91caff;
        }
        .core-config-row .drag-handle {
          cursor: grab;
          color: #bbb;
          display: flex;
          align-items: center;
        }
        .core-config-row .drag-handle:active {
          cursor: grabbing;
        }
        .core-config-row .file-name {
          flex: 1;
          font-size: 13px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .core-config-row .file-size {
          font-size: 11px;
          color: #999;
        }
      `}</style>
    </Spin>
  );
};
