import type { BrowserDataPayload } from "@/api/types/backup";

export async function collectBrowserData(): Promise<BrowserDataPayload> {
  const [
    docforgeTasks,
    docforgeParseTasks,
    messageQueues,
  ] = await Promise.all([
    loadIndexedDBStore("aiarb_desensitize", "tasks"),
    loadIndexedDBStore("aiarb_desensitize", "parse_tasks"),
    loadMessageQueues(),
  ]);

  return {
    docforgeTasks,
    docforgeParseTasks,
    messageQueues,
    preferences: collectPreferences(),
  };
}

function loadIndexedDBStore(
  dbName: string,
  storeName: string,
): Promise<unknown[]> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(dbName);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.close();
          resolve([]);
          return;
        }
        const tx = db.transaction(storeName, "readonly");
        const getAll = tx.objectStore(storeName).getAll();
        getAll.onsuccess = () => {
          resolve(getAll.result ?? []);
          db.close();
        };
        getAll.onerror = () => {
          resolve([]);
          db.close();
        };
      };
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

function loadMessageQueues(): Promise<Record<string, unknown[]>> {
  const result: Record<string, unknown[]> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("aiarb:message-queue:")) {
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            result[key] = JSON.parse(raw);
          }
        } catch {
          // skip unparseable
        }
      }
    }
  } catch {
    // localStorage may throw
  }
  return Promise.resolve(result);
}

function collectPreferences() {
  try {
    return {
      theme: localStorage.getItem("aiarb-theme"),
      language: localStorage.getItem("language"),
      sidebarMode: localStorage.getItem("aiarb_sidebar_mode"),
      lastUsedAgent: localStorage.getItem("aiarb-last-used-agent"),
      codingTabs: safeJsonParse(
        localStorage.getItem("aiarb-coding-tabs"),
      ),
      closeWindowAction: localStorage.getItem("aiarb.closeWindowAction"),
    };
  } catch {
    return {
      theme: null,
      language: null,
      sidebarMode: null,
      lastUsedAgent: null,
      codingTabs: null,
      closeWindowAction: null,
    };
  }
}

function safeJsonParse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}