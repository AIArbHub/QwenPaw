import { useState, useRef, useEffect } from "react";
import { Button, Input, Modal } from "antd";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  Home,
  RotateCcw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  codingProjectApi,
  type BrowseDirsResponse,
} from "../../api/modules/codingProject";
import styles from "./index.module.less";

interface FolderPickerProps {
  value?: string;
  onChange?: (path: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function FolderPicker({
  value,
  onChange,
  placeholder,
  disabled,
}: FolderPickerProps) {
  const { t } = useTranslation();
  const [modalOpen, setModalOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState<string>("~");
  const [data, setData] = useState<BrowseDirsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navSeq = useRef(0);

  const navigate = (path: string) => {
    const seq = ++navSeq.current;
    setBrowsePath(path);
    setLoading(true);
    setError(null);
    codingProjectApi
      .browseDirs(path)
      .then((res) => {
        if (seq !== navSeq.current) return;
        setData(res);
        listRef.current?.scrollTo(0, 0);
      })
      .catch((err: unknown) => {
        if (seq !== navSeq.current) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (seq === navSeq.current) setLoading(false);
      });
  };

  const handleOpen = () => {
    if (disabled) return;
    setBrowsePath(value || "~");
    setModalOpen(true);
    navigate(value || "~");
  };

  const handleSelect = () => {
    if (data?.current) {
      onChange?.(data.current);
    }
    setModalOpen(false);
  };

  const breadcrumbParts = data?.current.split("/").filter(Boolean) ?? [];

  return (
    <>
      <Input
        readOnly
        value={value}
        placeholder={placeholder}
        onClick={handleOpen}
        suffix={
          <Button
            type="text"
            size="small"
            icon={<FolderOpen size={14} />}
            onClick={handleOpen}
            disabled={disabled}
          />
        }
        style={{ cursor: disabled ? "not-allowed" : "pointer" }}
        disabled={disabled}
      />

      <Modal
        title={t("folderPicker.title", "选择文件夹")}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSelect}
        okText={t("folderPicker.select", "选择此文件夹")}
        okButtonProps={{ disabled: !data?.current }}
        width={520}
        destroyOnHidden
      >
        <div className={styles.pickerContent}>
          <div className={styles.browseShortcuts}>
            <Button
              size="small"
              type="text"
              icon={<Home size={13} />}
              onClick={() => navigate("~")}
            >
              {t("folderPicker.home", "主目录")}
            </Button>
            <Button
              size="small"
              type="text"
              icon={<RotateCcw size={13} />}
              onClick={() => navigate(browsePath)}
            >
              {t("folderPicker.refresh", "刷新")}
            </Button>
          </div>

          {data && (
            <div className={styles.browseBreadcrumb}>
              <span
                className={styles.breadcrumbSeg}
                onClick={() => navigate("/")}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate("/");
                  }
                }}
              >
                /
              </span>
              {breadcrumbParts.map((seg, i) => {
                const segPath =
                  "/" + breadcrumbParts.slice(0, i + 1).join("/");
                const isLast = i === breadcrumbParts.length - 1;
                return (
                  <span key={segPath} className={styles.breadcrumbItem}>
                    <ChevronRight
                      size={11}
                      className={styles.breadcrumbSep}
                    />
                    <span
                      className={`${styles.breadcrumbSeg} ${
                        isLast ? styles.breadcrumbCurrent : ""
                      }`}
                      onClick={() => !isLast && navigate(segPath)}
                      role={isLast ? undefined : "button"}
                      tabIndex={isLast ? undefined : 0}
                      onKeyDown={(e) => {
                        if (
                          !isLast &&
                          (e.key === "Enter" || e.key === " ")
                        ) {
                          e.preventDefault();
                          navigate(segPath);
                        }
                      }}
                    >
                      {seg}
                    </span>
                  </span>
                );
              })}
            </div>
          )}

          <div className={styles.browseList} ref={listRef}>
            {loading && (
              <div className={styles.browseEmpty}>
                {t("folderPicker.loading", "加载中...")}
              </div>
            )}
            {error && (
              <div className={styles.browseEmpty} style={{ color: "#ff4d4f" }}>
                {error}
              </div>
            )}
            {!loading && !error && data && (
              <>
                {data.parent && (
                  <div
                    className={styles.browseItem}
                    onClick={() => navigate(data.parent!)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        navigate(data.parent!);
                      }
                    }}
                  >
                    <Folder size={15} className={styles.browseItemIcon} />
                    <span className={styles.browseItemName}>..</span>
                  </div>
                )}
                {data.dirs.length === 0 && !data.parent && (
                  <div className={styles.browseEmpty}>
                    {t("folderPicker.empty", "无子文件夹")}
                  </div>
                )}
                {data.dirs.map((dir) => (
                  <div
                    key={dir.path}
                    className={styles.browseItem}
                    onClick={() => navigate(dir.path)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        navigate(dir.path);
                      }
                    }}
                  >
                    <Folder size={15} className={styles.browseItemIcon} />
                    <span className={styles.browseItemName}>{dir.name}</span>
                    <ChevronRight
                      size={13}
                      className={styles.browseItemChevron}
                    />
                  </div>
                ))}
              </>
            )}
          </div>

          {data && (
            <div className={styles.selectedPath}>
              <FolderOpen size={14} />
              <span>{data.current}</span>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}