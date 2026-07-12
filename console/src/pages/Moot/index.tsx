/**
 * Moot (模拟仲裁) page entry point.
 *
 * Rewritten from a 3252-line monolith into a clean modular architecture:
 * - hooks/useMootState.ts: central state management
 * - components/CaseListView.tsx: case list + create
 * - components/CaseDetailView.tsx: case workspace (header, stage bar, messages, sidebar)
 * - components/StageBar.tsx: visual stage progression
 * - components/MessagePanel.tsx: message list + input
 * - components/SidebarPanel.tsx: case info, participants, timeline, files
 * - components/CaseModals.tsx: all modal dialogs
 *
 * The page simply routes between list view and case detail view based on
 * whether a case is currently selected.
 */
import { useMootState } from "./hooks/useMootState";
import { CaseListView } from "./components/CaseListView";
import { CaseDetailView } from "./components/CaseDetailView";

const MootPage: React.FC = () => {
  const state = useMootState();

  if (!state.currentCase) {
    return <CaseListView state={state} />;
  }

  return <CaseDetailView state={state} />;
};

export default MootPage;
