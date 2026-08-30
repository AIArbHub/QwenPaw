/**
 * FlowManager — PawApp frontend entry.
 *
 * Provides a visual flow designer and flow instance viewer.
 * Pure flow management UI — no chat or agent runtime.
 *
 * Author: Sum
 */
(function () {
  "use strict";

  const REACT_HOST_ID = "flow-manager-root";

  // ── API helper ──────────────────────────────────────────────────

  function apiFetch(path, options) {
    const base = AIArb.host.getApiUrl("") || "/api";
    const token = AIArb.host.getApiToken() || "";
    const url = `${base}/pawapps/flow-manager${path}`;
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    return fetch(url, { ...options, headers }).then(async (resp) => {
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`${resp.status} ${resp.statusText} ${text}`);
      }
      const ct = resp.headers.get("content-type") || "";
      if (ct.includes("application/json")) return resp.json();
      return resp.text();
    });
  }

  // ── Main render ─────────────────────────────────────────────────

  function render() {
    const root = document.getElementById(REACT_HOST_ID) || document.body;
    root.innerHTML = `
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 960px; margin: 0 auto; padding: 24px;">
        <h1 style="margin: 0 0 8px; font-size: 24px; color: #1f1f1f;">🔀 FlowManager</h1>
        <p style="color: #666; margin: 0 0 24px;">流程定义与管理 — 可视化流程引擎，供群聊和智能体调用</p>
        <div id="fm-content" style="min-height: 400px;">
          <p style="color: #999;">加载中...</p>
        </div>
      </div>
    `;

    loadFlows();
  }

  function loadFlows() {
    const container = document.getElementById("fm-content");
    if (!container) return;

    apiFetch("/flows")
      .then((data) => {
        const flows = data.flows || [];
        if (flows.length === 0) {
          container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #999;">
              <p>暂无流程定义</p>
              <button id="fm-create-btn" style="margin-top: 12px; padding: 8px 20px; background: #0065fd; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">
                + 创建流程
              </button>
            </div>
          `;
          const btn = document.getElementById("fm-create-btn");
          if (btn) btn.addEventListener("click", () => showCreateModal());
          return;
        }

        const flowList = flows.map((f) => `
          <div style="border: 1px solid #e8e8e8; border-radius: 8px; padding: 16px; margin-bottom: 12px; cursor: pointer;" class="fm-flow-card" data-flow-id="${f.id}">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <h3 style="margin: 0; font-size: 16px; color: #1f1f1f;">${f.name}</h3>
                <p style="margin: 4px 0 0; color: #999; font-size: 13px;">
                  ${f.node_count || (f.nodes || []).length} 节点 · ${f.edge_count || (f.edges || []).length} 连线
                </p>
              </div>
              <div style="display: flex; gap: 8px;">
                <button class="fm-edit-btn" data-flow-id="${f.id}" style="padding: 4px 12px; font-size: 13px; border: 1px solid #d9d9d9; border-radius: 4px; background: #fff; cursor: pointer;">编辑</button>
                <button class="fm-delete-btn" data-flow-id="${f.id}" style="padding: 4px 12px; font-size: 13px; border: 1px solid #ff4d4f; color: #ff4d4f; border-radius: 4px; background: #fff; cursor: pointer;">删除</button>
              </div>
            </div>
          </div>
        `).join("");

        container.innerHTML = `
          <div style="display: flex; justify-content: flex-end; margin-bottom: 16px;">
            <button id="fm-create-btn" style="padding: 8px 20px; background: #0065fd; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">
              + 创建流程
            </button>
          </div>
          ${flowList}
        `;

        const createBtn = document.getElementById("fm-create-btn");
        if (createBtn) createBtn.addEventListener("click", () => showCreateModal());

        document.querySelectorAll(".fm-delete-btn").forEach((btn) => {
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const flowId = btn.getAttribute("data-flow-id");
            if (confirm("确定删除此流程？")) {
              apiFetch(`/flows/${flowId}`, { method: "DELETE" })
                .then(() => loadFlows())
                .catch((err) => alert("删除失败: " + err.message));
            }
          });
        });

        document.querySelectorAll(".fm-flow-card").forEach((card) => {
          card.addEventListener("click", () => {
            const flowId = card.getAttribute("data-flow-id");
            showFlowDetail(flowId);
          });
        });
      })
      .catch((err) => {
        container.innerHTML = `<p style="color: #ff4d4f;">加载失败: ${err.message}</p>`;
      });
  }

  function showCreateModal() {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.45);z-index:1000;display:flex;align-items:center;justify-content:center;";
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:24px;width:480px;max-width:90vw;max-height:80vh;overflow-y:auto;">
        <h2 style="margin:0 0 16px;font-size:18px;">创建流程</h2>
        <div style="margin-bottom:16px;">
          <label style="display:block;margin-bottom:4px;font-size:13px;">流程名称</label>
          <input id="fm-name" type="text" style="width:100%;padding:8px 12px;border:1px solid #d9d9d9;border-radius:6px;font-size:14px;" placeholder="例如：模拟仲裁流程" />
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:block;margin-bottom:4px;font-size:13px;">JSON 定义（节点 + 连线）</label>
          <textarea id="fm-json" rows="12" style="width:100%;padding:8px 12px;border:1px solid #d9d9d9;border-radius:6px;font-size:13px;font-family:monospace;" placeholder='{"nodes":[{"id":"n1","label":"开庭","type":"stage","max_turns":2}],"edges":[],"entry_node_id":"n1"}'></textarea>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button id="fm-cancel" style="padding:8px 16px;border:1px solid #d9d9d9;border-radius:6px;background:#fff;cursor:pointer;">取消</button>
          <button id="fm-submit" style="padding:8px 16px;background:#0065fd;color:#fff;border:none;border-radius:6px;cursor:pointer;">创建</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector("#fm-cancel").addEventListener("click", () => overlay.remove());
    overlay.querySelector("#fm-submit").addEventListener("click", () => {
      const name = overlay.querySelector("#fm-name").value.trim();
      const jsonStr = overlay.querySelector("#fm-json").value.trim();
      if (!name || !jsonStr) {
        alert("请填写名称和 JSON 定义");
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(jsonStr);
      } catch (e) {
        alert("JSON 格式错误: " + e.message);
        return;
      }
      const body = { name, nodes: parsed.nodes || [], edges: parsed.edges || [], entry_node_id: parsed.entry_node_id || (parsed.nodes || [])[0]?.id };
      apiFetch("/flows", {
        method: "POST",
        body: JSON.stringify(body),
      })
        .then(() => {
          overlay.remove();
          loadFlows();
        })
        .catch((err) => alert("创建失败: " + err.message));
    });
  }

  function showFlowDetail(flowId) {
    const container = document.getElementById("fm-content");
    if (!container) return;

    apiFetch(`/flows/${flowId}`)
      .then((flow) => {
        const nodes = flow.nodes || [];
        const edges = flow.edges || [];

        const nodesHtml = nodes.map((n) => {
          const typeColors = {
            stage: "#0065fd", decision: "#ff9500", parallel: "#34c759",
            merge: "#5856d6", terminal: "#ff3b30", loop: "#af52de",
          };
          const color = typeColors[n.type] || "#999";
          return `
            <div style="display:inline-block;margin:4px;padding:8px 12px;border-radius:8px;background:${color}15;border:2px solid ${color};min-width:120px;text-align:center;">
              <div style="font-weight:600;font-size:14px;color:#1f1f1f;">${n.label}</div>
              <div style="font-size:11px;color:${color};margin-top:2px;">${n.type}${n.speaker_agent_id ? " · " + n.speaker_agent_id : ""}</div>
            </div>
          `;
        }).join("");

        const edgesHtml = edges.length > 0
          ? edges.map((e) => `<div style="font-size:12px;color:#666;margin:2px 0;">${e.source} → ${e.target}${e.condition ? " (" + e.condition + ")" : ""}</div>`).join("")
          : "<div style='color:#999;font-size:13px;'>无连线</div>";

        container.innerHTML = `
          <div style="margin-bottom:16px;">
            <button id="fm-back" style="padding:6px 12px;border:1px solid #d9d9d9;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;">← 返回列表</button>
          </div>
          <h2 style="margin:0 0 8px;font-size:20px;color:#1f1f1f;">${flow.name}</h2>
          <p style="color:#999;margin:0 0 16px;font-size:13px;">ID: ${flow.id}</p>
          <h3 style="font-size:15px;margin:16px 0 8px;">节点 (${nodes.length})</h3>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:16px;">${nodesHtml}</div>
          <h3 style="font-size:15px;margin:16px 0 8px;">连线 (${edges.length})</h3>
          <div style="background:#f5f5f5;border-radius:8px;padding:12px;">${edgesHtml}</div>
        `;

        document.getElementById("fm-back").addEventListener("click", loadFlows);
      })
      .catch((err) => {
        container.innerHTML = `<p style="color:#ff4d4f;">加载失败: ${err.message}</p>`;
      });
  }

  // ── Export ──────────────────────────────────────────────────────

  AIArb.onReady(render);
})();
