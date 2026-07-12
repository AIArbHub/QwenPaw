import { useState, useEffect } from "react";
import { useAppMessage } from "../../../../hooks/useAppMessage";
import { useTranslation } from "react-i18next";
import api from "../../../../api";
import type { MarkdownFile, DailyMemoryFile, WorkFileInfo } from "../../../../api/types";
import { workspaceApi } from "../../../../api/modules/workspace";
import { useAgentStore } from "../../../../stores/agentStore";

// Returns the parent directory of a file path, supporting both '/' and '\' separators.
const getParentDir = (filePath: string): string => {
  const match = filePath.match(/^(.*)[/\\]/);
  return match ? match[1] : filePath;
};

export const useAgentsData = () => {
  const { t } = useTranslation();
  const { selectedAgent } = useAgentStore();
  const [files, setFiles] = useState<MarkdownFile[]>([]);
  const [workFiles, setWorkFiles] = useState<WorkFileInfo[]>([]);
  const [workDirEnabled, setWorkDirEnabled] = useState(false);
  const [selectedFile, setSelectedFile] = useState<MarkdownFile | null>(null);
  const [dailyMemories, setDailyMemories] = useState<DailyMemoryFile[]>([]);
  const [fileContent, setFileContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [expandedMemory, setExpandedMemory] = useState(false);
  const { message } = useAppMessage();

  const fetchDailyMemories = async () => {
    try {
      const memoryList = await api.listDailyMemory();
      setDailyMemories(memoryList);
    } catch (error) {
      console.error("Failed to fetch daily memories", error);
      message.error(t("memory.loadError"));
    }
  };

  const handleFileClick = async (file: MarkdownFile) => {
    if (file.filename === "MEMORY.md") {
      setExpandedMemory((prev) => {
        if (!prev) {
          fetchDailyMemories();
        }
        return !prev;
      });
    }

    setSelectedFile(file);
    setLoading(true);
    try {
      let content: string;
      if (file.is_work_file && file.work_file_path) {
        const data = await workspaceApi.loadWorkFile(file.work_file_path);
        content = data.content;
      } else {
        const data = await workspaceApi.loadFile(file.filename);
        content = data.content;
      }
      setFileContent(content);
      setOriginalContent(content);
    } catch (error) {
      console.error("Failed to load file", error);
      message.error(t("workspace.loadFileError"));
    } finally {
      setLoading(false);
    }
  };

  const fetchFiles = async () => {
    try {
      const [workDocs, workDirCfg] = await Promise.all([
        workspaceApi.listFiles(),
        workspaceApi.getWorkDirConfig(),
      ]);
      setFiles(workDocs as unknown as MarkdownFile[]);
      setWorkDirEnabled(workDirCfg.enabled);

      if (workDirCfg.enabled) {
        try {
          const wf = await workspaceApi.listWorkFiles();
          setWorkFiles(wf);
        } catch {
          setWorkFiles([]);
        }
      } else {
        setWorkFiles([]);
      }

      await fetchDailyMemories();
      if (workDocs.length > 0) {
        setWorkspacePath(getParentDir(workDocs[0].path));
      } else {
        setWorkspacePath("");
      }
    } catch (error) {
      console.error("Failed to fetch files", error);
      message.error(t("workspace.loadFileListError"));
    }
  };

  useEffect(() => {
    const initializeData = async () => {
      // Remember currently selected file name
      const previouslySelectedFilename = selectedFile?.filename;

      // Clear content first
      setFileContent("");
      setOriginalContent("");
      setExpandedMemory(false);

      const [workDocs, workDirCfg] = await Promise.all([
        workspaceApi.listFiles(),
        workspaceApi.getWorkDirConfig(),
      ]);
      setFiles(workDocs as unknown as MarkdownFile[]);
      setWorkDirEnabled(workDirCfg.enabled);

      // Fetch work files if enabled, store in local var to avoid stale state
      let fetchedWorkFiles: WorkFileInfo[] = [];
      if (workDirCfg.enabled) {
        try {
          fetchedWorkFiles = await workspaceApi.listWorkFiles();
          setWorkFiles(fetchedWorkFiles);
        } catch {
          setWorkFiles([]);
        }
      } else {
        setWorkFiles([]);
      }

      await fetchDailyMemories();

      // Set workspace path
      if (workDocs.length > 0) {
        setWorkspacePath(getParentDir(workDocs[0].path));
      } else {
        setWorkspacePath("");
      }

      // Try to re-select the same file in new workspace
      if (previouslySelectedFilename) {
        const searchList = workDirCfg.enabled ? fetchedWorkFiles : workDocs;
        const sameFile = searchList.find(
          (f) => f.filename === previouslySelectedFilename,
        );
        if (sameFile) {
          const mdFile = "updated_at" in sameFile
            ? sameFile as MarkdownFile
            : {
                ...sameFile,
                updated_at: sameFile.modified_time
                  ? new Date(sameFile.modified_time).getTime()
                  : Date.now(),
                created_time: sameFile.modified_time || "",
                is_work_file: true,
                work_file_path: (sameFile as WorkFileInfo).path,
              } as MarkdownFile;
          await handleFileClick(mdFile);
        } else {
          setSelectedFile(null);
        }
      } else {
        setSelectedFile(null);
      }
    };
    initializeData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAgent]);

  const handleDailyMemoryClick = async (daily: DailyMemoryFile) => {
    setSelectedFile({
      filename: daily.filename,
      path: daily.path,
      size: daily.size,
      created_time: daily.created_time,
      modified_time: daily.modified_time,
      updated_at: daily.updated_at,
      memory_path: daily.filename,
    });
    setLoading(true);
    try {
      const data = await api.loadDailyMemory(daily.filename);
      setFileContent(data.content);
      setOriginalContent(data.content);
    } catch (error) {
      console.error("Failed to load daily memory", error);
      message.error(t("memory.loadContentError"));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedFile) return;
    setLoading(true);
    try {
      if (selectedFile.memory_path) {
        await api.saveDailyMemory(selectedFile.memory_path, fileContent);
      } else if (selectedFile.is_work_file && selectedFile.work_file_path) {
        await workspaceApi.saveWorkFile(
          selectedFile.work_file_path,
          fileContent,
        );
      } else {
        await api.saveFile(selectedFile.filename, fileContent);
      }
      setOriginalContent(fileContent);
      message.success(t("memory.saveSuccess"));
      if (selectedFile.memory_path) {
        fetchDailyMemories();
      } else if (selectedFile.is_work_file) {
        // Refresh work files list
        try {
          const wf = await workspaceApi.listWorkFiles();
          setWorkFiles(wf);
        } catch {
          /* ignore */
        }
      } else {
        fetchFiles();
      }
    } catch (error) {
      console.error("Failed to save file", error);
      message.error(t("memory.saveError"));
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setFileContent(originalContent);
  };

  const hasChanges = fileContent !== originalContent;

  return {
    files,
    workFiles,
    workDirEnabled,
    selectedFile,
    dailyMemories,
    expandedMemory,
    fileContent,
    loading,
    workspacePath,
    hasChanges,
    setFileContent,
    fetchFiles,
    fetchDailyMemories,
    handleFileClick,
    handleDailyMemoryClick,
    toggleExpandedMemory: () => {
      setExpandedMemory((v) => {
        if (!v) {
          fetchDailyMemories();
        }
        return !v;
      });
    },
    handleSave,
    handleReset,
  };
};
