import { request } from "../request";
import { buildAuthHeaders } from "../authHeaders";

/** Response from GET /api/console/group-chats */
export interface GroupChatMemberInfo {
  agent_id: string;
  name: string;
  controller: "auto" | "human" | "assist";
  assist_hint: string;
  override_count: number;
  human_pending: boolean;
}

export interface GroupChatState {
  members: GroupChatMemberInfo[];
  round: number;
  mode: string;
  script_phase: string | null;
  script_phase_idx: number;
}

/** Request body for PATCH /api/console/group-chats/members/controller */
export interface SetControllerRequest {
  host_agent_id: string;
  session_id: string;
  member_id: string;
  controller: "auto" | "human" | "assist";
  assist_hint?: string;
}

/** Request body for POST /api/console/group-chats/members/inject */
export interface InjectTurnRequest {
  host_agent_id: string;
  session_id: string;
  member_id: string;
  text: string;
}

/** Request body for POST /api/console/group-chats/members/interrupt */
export interface InterruptMemberRequest {
  host_agent_id: string;
  session_id: string;
  member_id: string;
}

/** Request body for POST /api/console/group-chats/turns/edit */
export interface EditTurnRequest {
  host_agent_id: string;
  session_id: string;
  turn_id: string;
  text: string;
}

export const groupChatsApi = {
  /** Get the current state of a group chat session. */
  getGroupChat: (
    hostAgentId: string,
    sessionId: string,
  ) => {
    const searchParams = new URLSearchParams({
      host_agent_id: hostAgentId,
      session_id: sessionId,
    });
    return request<GroupChatState>(
      `/api/console/group-chats?${searchParams.toString()}`,
      {
        headers: { "X-Agent-Id": hostAgentId },
      },
    );
  },

  /** Set a member's controller (takeover / release / assist). */
  setController: (body: SetControllerRequest) =>
    request<{ member_id: string; controller: string; assist_hint: string }>(
      "/api/console/group-chats/members/controller",
      {
        method: "PATCH",
        body: JSON.stringify(body),
        headers: { "X-Agent-Id": body.host_agent_id },
      },
    ),

  /** Inject a human-produced turn for a member. */
  injectTurn: (body: InjectTurnRequest) =>
    request<{ member_id: string; text: string; resolved_pending: boolean }>(
      "/api/console/group-chats/members/inject",
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "X-Agent-Id": body.host_agent_id },
      },
    ),

  /** Interrupt a member's in-flight generation. */
  interruptMember: (body: InterruptMemberRequest) =>
    request<{ member_id: string; interrupted: boolean }>(
      "/api/console/group-chats/members/interrupt",
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "X-Agent-Id": body.host_agent_id },
      },
    ),

  /** Edit a completed member turn's result text. */
  editTurn: (body: EditTurnRequest) =>
    request<{ turn_id: string; text: string; updated: boolean }>(
      "/api/console/group-chats/turns/edit",
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "X-Agent-Id": body.host_agent_id },
      },
    ),
};
