/**
 * OfficePreview – renders and edits Office documents in the editor area.
 *
 * Supported types:
 *   • xlsx / xls – SheetJS parsed editable table (multi-sheet tabs)
 *   • docx       – mammoth.js HTML preview with contenteditable editing
 *   • pptx       – text outline extraction (read-only)
 *   • doc / ppt  – legacy binary formats, read-only download prompt
 */

import { Download, FileWarning, LoaderCircle, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { workspaceApi } from "../../api/modules/workspace";
import { buildAuthHeaders } from "../../api/authHeaders";
import type { WorkspaceRoot } from "../../features/files-workspace/types";
import styles from "./FilePreview.module.less";
import officeStyles from "./OfficePreview.module.less";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OfficeType = "xlsx" | "docx" | "pptx" | "legacy";

export function getOfficeType(filePath: string): OfficeType | null {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "xlsx" || ext === "xls") return "xlsx";
  if (ext === "docx") return "docx";
  if (ext === "pptx") return "pptx";
  if (ext === "doc" || ext === "ppt") return "legacy";
  return null;
}

export function isOfficeFile(filePath: string): boolean {
  return getOfficeType(filePath) !== null;
}

// ---------------------------------------------------------------------------
// Authenticated blob loader (shared)
// ---------------------------------------------------------------------------

function useAuthBlob(
  filePath: string,
  chatId?: string,
  binaryUrl?: string,
  root?: WorkspaceRoot,
): { arrayBuffer: ArrayBuffer | null; loading: boolean; failed: boolean } {
  const [arrayBuffer, setArrayBuffer] = useState<ArrayBuffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoked = false;
    setLoading(true);
    setFailed(false);

    const loadBlob = async (): Promise<ArrayBuffer | null> => {
      const url = binaryUrl ?? workspaceApi.getFileDownloadUrl(filePath, root);
      const res = await fetch(url, {
        headers: {
          ...buildAuthHeaders(),
          ...(chatId ? { "X-Chat-Id": chatId } : {}),
        },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.arrayBuffer();
    };

    loadBlob()
      .then((buf) => {
        if (revoked || !buf) return;
        setArrayBuffer(buf);
        setLoading(false);
      })
      .catch(() => {
        if (!revoked) {
          setArrayBuffer(null);
          setLoading(false);
          setFailed(true);
        }
      });

    return () => {
      revoked = true;
    };
  }, [binaryUrl, chatId, filePath, root]);

  return { arrayBuffer, loading, failed };
}

// ---------------------------------------------------------------------------
// PreviewStatus (reuse from FilePreview)
// ---------------------------------------------------------------------------

function PreviewStatus({
  children,
  icon,
  spinning = false,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  spinning?: boolean;
}) {
  return (
    <div className={styles.previewStatus}>
      <span className={spinning ? styles.spinning : undefined}>{icon}</span>
      <span>{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// XLSX Preview + Edit
// ---------------------------------------------------------------------------

interface SheetData {
  name: string;
  rows: string[][];
}

function XlsxPreview({
  filePath,
  chatId,
  binaryUrl,
  root,
  onSave,
}: {
  filePath: string;
  chatId?: string;
  binaryUrl?: string;
  root?: WorkspaceRoot;
  onSave?: (path: string, data: ArrayBuffer) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { arrayBuffer, loading, failed } = useAuthBlob(
    filePath,
    chatId,
    binaryUrl,
    root,
  );
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [editedCells, setEditedCells] = useState<
    Record<string, Record<number, Record<number, string>>>
  >({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const workbookRef = useRef<unknown>(null);

  useEffect(() => {
    if (!arrayBuffer) return;
    import("xlsx").then((XLSX) => {
      try {
        const wb = XLSX.read(arrayBuffer, { type: "array" });
        workbookRef.current = wb;
        const sheetList: SheetData[] = wb.SheetNames.map(
          (name: string) => {
            const ws = wb.Sheets[name];
            const rows = XLSX.utils.sheet_to_json(ws, {
              header: 1,
              blankrows: false,
              defval: "",
            }) as string[][];
            return { name, rows };
          },
        );
        setSheets(sheetList);
        setActiveSheet(0);
        setEditedCells({});
        setDirty(false);
      } catch {
        setSheets([]);
      }
    });
  }, [arrayBuffer]);

  const getCellValue = useCallback(
    (sheetIdx: number, row: number, col: number): string => {
      const edits = editedCells[sheetIdx]?.[row]?.[col];
      if (edits !== undefined) return edits;
      return sheets[sheetIdx]?.rows?.[row]?.[col] ?? "";
    },
    [editedCells, sheets],
  );

  const handleCellEdit = useCallback(
    (sheetIdx: number, row: number, col: number, value: string) => {
      setEditedCells((prev) => {
        const next = { ...prev };
        if (!next[sheetIdx]) next[sheetIdx] = {};
        if (!next[sheetIdx][row]) next[sheetIdx][row] = {};
        next[sheetIdx][row][col] = value;
        return next;
      });
      setDirty(true);
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!onSave || !workbookRef.current || saving) return;
    setSaving(true);
    try {
      const XLSX = await import("xlsx");
      const wb = workbookRef.current as {
        SheetNames: string[];
        Sheets: Record<string, Record<string, unknown>>;
      };
      // Apply edits to the workbook cells
      for (const [sheetIdxStr, rowEdits] of Object.entries(editedCells)) {
        const sheetIdx = Number(sheetIdxStr);
        const sheetName = wb.SheetNames[sheetIdx];
        const ws = wb.Sheets[sheetName];
        for (const [rowStr, colEdits] of Object.entries(rowEdits)) {
          const row = Number(rowStr);
          for (const [colStr, value] of Object.entries(colEdits)) {
            const col = Number(colStr);
            const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
            if (!ws[cellRef]) {
              ws[cellRef] = { t: "s", v: value };
            } else {
              (ws[cellRef] as { v: unknown }).v = value;
              (ws[cellRef] as { t: string }).t = "s";
            }
          }
        }
      }
      const newBuffer = XLSX.write(wb, {
        type: "array",
        bookType: "xlsx",
      }) as ArrayBuffer;
      await onSave(filePath, newBuffer);
      setDirty(false);
      setEditedCells({});
    } catch (e) {
      console.error("Failed to save xlsx:", e);
    } finally {
      setSaving(false);
    }
  }, [editedCells, filePath, onSave, saving]);

  if (loading) {
    return (
      <PreviewStatus icon={<LoaderCircle size={18} />} spinning>
        {t("common.loading")}
      </PreviewStatus>
    );
  }
  if (failed || !arrayBuffer) {
    return (
      <PreviewStatus icon={<FileWarning size={18} />}>
        {t("files.loadFailed")}
      </PreviewStatus>
    );
  }
  if (sheets.length === 0) {
    return (
      <PreviewStatus icon={<FileWarning size={18} />}>
        {t("files.loadFailed")}
      </PreviewStatus>
    );
  }

  const MAX_ROWS = 500;
  const MAX_COLS = 50;
  const currentSheet = sheets[activeSheet];
  const header = currentSheet.rows[0] ?? [];
  const body = currentSheet.rows.slice(1, MAX_ROWS + 1);

  return (
    <div className={officeStyles.xlsxWrap}>
      <div className={officeStyles.xlsxToolbar}>
        <div className={officeStyles.sheetTabs}>
          {sheets.map((sheet, idx) => (
            <button
              key={sheet.name}
              type="button"
              className={
                idx === activeSheet ? officeStyles.sheetTabActive : ""
              }
              onClick={() => setActiveSheet(idx)}
            >
              {sheet.name}
            </button>
          ))}
        </div>
        {onSave && (
          <button
            type="button"
            className={officeStyles.saveBtn}
            onClick={() => void handleSave()}
            disabled={!dirty || saving}
          >
            <Save size={13} />
            {saving ? t("common.saving") : t("common.save")}
          </button>
        )}
      </div>
      <div className={styles.csvScroll}>
        <table className={styles.csvTable}>
          <thead>
            <tr>
              <th>#</th>
              {header.slice(0, MAX_COLS).map((h, i) => (
                <th key={`h:${i}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((_row, ri) => (
              <tr key={`r:${ri}`}>
                <td className={officeStyles.rowNumber}>{ri + 1}</td>
                {Array.from({ length: Math.min(header.length, MAX_COLS) }).map(
                  (_, ci) => (
                    <td key={`c:${ri}:${ci}`}>
                      {onSave ? (
                        <input
                          type="text"
                          value={getCellValue(activeSheet, ri + 1, ci)}
                          onChange={(e) =>
                            handleCellEdit(
                              activeSheet,
                              ri + 1,
                              ci,
                              e.target.value,
                            )
                          }
                          className={officeStyles.cellInput}
                        />
                      ) : (
                        getCellValue(activeSheet, ri + 1, ci)
                      )}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DOCX Preview + Edit
// ---------------------------------------------------------------------------

function DocxPreview({
  filePath,
  chatId,
  binaryUrl,
  root,
  onSave,
}: {
  filePath: string;
  chatId?: string;
  binaryUrl?: string;
  root?: WorkspaceRoot;
  onSave?: (path: string, data: ArrayBuffer) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { arrayBuffer, loading, failed } = useAuthBlob(
    filePath,
    chatId,
    binaryUrl,
    root,
  );
  const [html, setHtml] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const editRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!arrayBuffer) return;
    import("mammoth").then((mammoth) => {
      mammoth
        .convertToHtml({ arrayBuffer })
        .then((result: { value: string }) => {
          setHtml(result.value);
          setDirty(false);
        })
        .catch(() => {
          setHtml("<p>Failed to read document.</p>");
        });
    });
  }, [arrayBuffer]);

  const handleSave = useCallback(async () => {
    if (!onSave || !editRef.current || saving) return;
    setSaving(true);
    try {
      const { Document, Packer, Paragraph, TextRun } = await import("docx");
      const container = editRef.current;
      const paragraphs: InstanceType<typeof Paragraph>[] = [];

      const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent ?? "";
          if (text.trim()) {
            paragraphs.push(
              new Paragraph({ children: [new TextRun(text)] }),
            );
          }
          return;
        }
        if (node.nodeName === "P" || node.nodeName === "DIV") {
          const text = node.textContent ?? "";
          if (text.trim()) {
            paragraphs.push(
              new Paragraph({ children: [new TextRun(text)] }),
            );
          }
          return;
        }
        if (node.nodeName === "TABLE") {
          // Extract table rows as text paragraphs
          const rows = (node as HTMLElement).querySelectorAll("tr");
          rows.forEach((row) => {
            const cells = row.querySelectorAll("th,td");
            const text = Array.from(cells)
              .map((c) => c.textContent ?? "")
              .join("\t");
            if (text.trim()) {
              paragraphs.push(
                new Paragraph({ children: [new TextRun(text)] }),
              );
            }
          });
          return;
        }
        node.childNodes.forEach(walk);
      };

      walk(container);

      const doc = new Document({
        sections: [{ properties: {}, children: paragraphs }],
      });
      const blob = await Packer.toBlob(doc);
      const buffer = await blob.arrayBuffer();
      await onSave(filePath, buffer);
      setDirty(false);
    } catch (e) {
      console.error("Failed to save docx:", e);
    } finally {
      setSaving(false);
    }
  }, [filePath, onSave, saving]);

  if (loading) {
    return (
      <PreviewStatus icon={<LoaderCircle size={18} />} spinning>
        {t("common.loading")}
      </PreviewStatus>
    );
  }
  if (failed || !arrayBuffer) {
    return (
      <PreviewStatus icon={<FileWarning size={18} />}>
        {t("files.loadFailed")}
      </PreviewStatus>
    );
  }

  return (
    <div className={officeStyles.docxWrap}>
      <div className={officeStyles.docxToolbar}>
        {onSave && (
          <button
            type="button"
            className={officeStyles.saveBtn}
            onClick={() => void handleSave()}
            disabled={!dirty || saving}
          >
            <Save size={13} />
            {saving ? t("common.saving") : t("common.save")}
          </button>
        )}
      </div>
      <div
        ref={editRef}
        className={officeStyles.docxContent}
        contentEditable={!!onSave}
        suppressContentEditableWarning
        onInput={() => setDirty(true)}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PPTX Preview (read-only text outline)
// ---------------------------------------------------------------------------

function PptxPreview({
  filePath,
  chatId,
  binaryUrl,
  root,
}: {
  filePath: string;
  chatId?: string;
  binaryUrl?: string;
  root?: WorkspaceRoot;
}) {
  const { t } = useTranslation();
  const { arrayBuffer, loading, failed } = useAuthBlob(
    filePath,
    chatId,
    binaryUrl,
    root,
  );
  const [slides, setSlides] = useState<
    { title: string; bullets: string[] }[]
  >([]);

  useEffect(() => {
    if (!arrayBuffer) return;
    import("jszip").then(async (JSZip) => {
      try {
        const zip = await JSZip.loadAsync(arrayBuffer);
        const slideFiles = Object.keys(zip.files)
          .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
          .sort((a, b) => {
            const na = parseInt(a.match(/slide(\d+)/)?.[1] ?? "0");
            const nb = parseInt(b.match(/slide(\d+)/)?.[1] ?? "0");
            return na - nb;
          });

        const parsed: { title: string; bullets: string[] }[] = [];
        for (const slideFile of slideFiles) {
          const content = await zip.files[slideFile].async("string");
          // Extract text from <a:t> tags
          const texts: string[] = [];
          const regex = /<a:t>(.*?)<\/a:t>/g;
          let match;
          while ((match = regex.exec(content)) !== null) {
            if (match[1].trim()) texts.push(match[1].trim());
          }
          parsed.push({
            title: texts[0] ?? "(Untitled slide)",
            bullets: texts.slice(1),
          });
        }
        setSlides(parsed);
      } catch {
        setSlides([]);
      }
    });
  }, [arrayBuffer]);

  if (loading) {
    return (
      <PreviewStatus icon={<LoaderCircle size={18} />} spinning>
        {t("common.loading")}
      </PreviewStatus>
    );
  }
  if (failed || !arrayBuffer) {
    return (
      <PreviewStatus icon={<FileWarning size={18} />}>
        {t("files.loadFailed")}
      </PreviewStatus>
    );
  }

  return (
    <div className={officeStyles.pptxWrap}>
      <div className={officeStyles.pptxNote}>
        {t("files.pptxReadonly") ??
          "PowerPoint preview is read-only. Download to edit."}
      </div>
      {slides.map((slide, idx) => (
        <div key={idx} className={officeStyles.slide}>
          <h3>
            <span className={officeStyles.slideNumber}>{idx + 1}</span>
            {slide.title}
          </h3>
          {slide.bullets.length > 0 && (
            <ul>
              {slide.bullets.map((bullet, bi) => (
                <li key={bi}>{bullet}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {slides.length === 0 && (
        <PreviewStatus icon={<FileWarning size={18} />}>
          {t("files.loadFailed")}
        </PreviewStatus>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legacy format (doc/ppt) – binary, cannot parse in browser
// ---------------------------------------------------------------------------

function LegacyPreview({
  filePath,
  onDownload,
}: {
  filePath: string;
  chatId?: string;
  binaryUrl?: string;
  root?: WorkspaceRoot;
  onDownload?: () => Promise<void>;
}) {
  const { t } = useTranslation();

  return (
    <div className={officeStyles.legacyWrap}>
      <FileWarning size={36} />
      <p>
        {t("files.legacyFormat") ??
          "Legacy Office format (.doc/.ppt) cannot be previewed in browser."}
      </p>
      <p className={officeStyles.legacyFileName}>
        {filePath.split("/").pop()}
      </p>
      {onDownload && (
        <button
          type="button"
          className={officeStyles.downloadBtn}
          onClick={() => void onDownload()}
        >
          <Download size={14} />
          {t("files.download")}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface OfficePreviewProps {
  filePath: string;
  chatId?: string;
  binaryUrl?: string;
  root?: WorkspaceRoot;
  onSaveBinary?: (path: string, data: ArrayBuffer) => Promise<void>;
  onDownload?: () => Promise<void>;
}

export default function OfficePreview({
  filePath,
  chatId,
  binaryUrl,
  root,
  onSaveBinary,
  onDownload,
}: OfficePreviewProps) {
  const type = getOfficeType(filePath);

  if (type === "xlsx") {
    return (
      <XlsxPreview
        filePath={filePath}
        chatId={chatId}
        binaryUrl={binaryUrl}
        root={root}
        onSave={onSaveBinary}
      />
    );
  }
  if (type === "docx") {
    return (
      <DocxPreview
        filePath={filePath}
        chatId={chatId}
        binaryUrl={binaryUrl}
        root={root}
        onSave={onSaveBinary}
      />
    );
  }
  if (type === "pptx") {
    return (
      <PptxPreview
        filePath={filePath}
        chatId={chatId}
        binaryUrl={binaryUrl}
        root={root}
      />
    );
  }
  return (
    <LegacyPreview
      filePath={filePath}
      chatId={chatId}
      binaryUrl={binaryUrl}
      root={root}
      onDownload={onDownload}
    />
  );
}
