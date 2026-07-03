import React, {
  createContext,
  useCallback,
  useContext,
  useState,
  ReactNode,
} from "react";
import { type PendingApproval } from "../api/modules/console";

export type ApprovalStatus =
  | "approved"
  | "denied"
  | "timeout"
  | "cancelled"
  | "superseded";

export interface ApprovalHistoryItem extends PendingApproval {
  resolvedStatus: ApprovalStatus;
  resolvedAt: number;
  scope?: "exact" | "similar";
}

interface ApprovalContextValue {
  approvals: PendingApproval[];
  setApprovals: React.Dispatch<React.SetStateAction<PendingApproval[]>>;
  approvalHistory: ApprovalHistoryItem[];
  moveToHistory: (
    requestId: string,
    status: ApprovalStatus,
    scope?: "exact" | "similar",
  ) => void;
  clearHistory: () => void;
}

const APPROVAL_HISTORY_KEY = "qwenpaw.approval.history";
const MAX_HISTORY_ITEMS = 200;

const loadApprovalHistory = (): ApprovalHistoryItem[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(APPROVAL_HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ApprovalHistoryItem[];
  } catch {
    return [];
  }
};

const saveApprovalHistory = (items: ApprovalHistoryItem[]) => {
  if (typeof window === "undefined") return;
  const trimmed = items.slice(-MAX_HISTORY_ITEMS);
  window.localStorage.setItem(APPROVAL_HISTORY_KEY, JSON.stringify(trimmed));
};

const ApprovalContext = createContext<ApprovalContextValue | undefined>(
  undefined,
);

export function ApprovalProvider({ children }: { children: ReactNode }) {
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [approvalHistory, setApprovalHistory] = useState<ApprovalHistoryItem[]>(
    loadApprovalHistory,
  );

  const moveToHistory = useCallback(
    (
      requestId: string,
      status: ApprovalStatus,
      scope?: "exact" | "similar",
    ) => {
      setApprovals((prev) => {
        const found = prev.find((a) => a.request_id === requestId);
        if (!found) return prev;

        const historyItem: ApprovalHistoryItem = {
          ...found,
          resolvedStatus: status,
          resolvedAt: Date.now() / 1000,
          scope,
        };

        setApprovalHistory((hPrev) => {
          const next = [...hPrev, historyItem];
          saveApprovalHistory(next);
          return next;
        });

        return prev.filter((a) => a.request_id !== requestId);
      });
    },
    [],
  );

  const clearHistory = useCallback(() => {
    setApprovalHistory([]);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(APPROVAL_HISTORY_KEY);
    }
  }, []);

  return (
    <ApprovalContext.Provider
      value={{
        approvals,
        setApprovals,
        approvalHistory,
        moveToHistory,
        clearHistory,
      }}
    >
      {children}
    </ApprovalContext.Provider>
  );
}

export function useApprovalContext() {
  const context = useContext(ApprovalContext);
  if (!context) {
    throw new Error("useApprovalContext must be used within ApprovalProvider");
  }
  return context;
}