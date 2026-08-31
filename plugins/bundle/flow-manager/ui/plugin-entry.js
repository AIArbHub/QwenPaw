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

  var AIArb = window.AIArb;
  if (!AIArb || !AIArb.host || !AIArb.registerRoutes) {
    console.error("[flow-manager] window.AIArb not ready — cannot register.");
    return;
  }

  var host = AIArb.host;
  var React = host.React;
  var antd = host.antd;
  var h = React.createElement;

  var message = antd.message;
  var Modal = antd.Modal;
  var Input = antd.Input;
  var Button = antd.Button;
  var Empty = antd.Empty;

  // ── API helper ──────────────────────────────────────────────────

  function apiFetch(path, opts) {
    opts = opts || {};
    var base = host.getApiUrl("") || "/api";
    var token = host.getApiToken ? host.getApiToken() : "";
    var url = base + "/pawapps/flow-manager" + path;
    var headers = opts.headers || {};
    headers["Content-Type"] = "application/json";
    if (token) headers["Authorization"] = "Bearer " + token;
    return fetch(url, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (res) {
      if (!res.ok) {
        return res.text().catch(function () { return ""; }).then(function (text) {
          throw new Error(res.status + " " + res.statusText + " " + text);
        });
      }
      var ct = res.headers.get("content-type") || "";
      if (ct.indexOf("application/json") >= 0) return res.json();
      return res.text();
    });
  }

  // ── Flow list view ──────────────────────────────────────────────

  function FlowList(props) {
    var flowsState = React.useState(null); // null = loading
    var flows = flowsState[0];
    var setFlows = flowsState[1];
    var errorState = React.useState(null);
    var error = errorState[0];
    var setError = errorState[1];

    function load() {
      setFlows(null);
      setError(null);
      apiFetch("/flows")
        .then(function (data) {
          setFlows((data && data.flows) || []);
        })
        .catch(function (err) {
          setError(err.message);
        });
    }

    React.useEffect(load, []);

    function handleDelete(flowId) {
      Modal.confirm({
        title: "确认删除",
        content: "确定删除此流程定义？",
        onOk: function () {
          apiFetch("/flows/" + flowId, { method: "DELETE" })
            .then(function () {
              if (message) message.success("已删除");
              load();
            })
            .catch(function (err) {
              if (message) message.error("删除失败: " + err.message);
            });
        },
      });
    }

    if (error) {
      return h(
        "div",
        { style: { color: "#ff4d4f", padding: 24 } },
        "加载失败: " + error
      );
    }

    if (flows === null) {
      return h(
        "div",
        { style: { textAlign: "center", padding: 40, color: "#999" } },
        "加载中..."
      );
    }

    if (flows.length === 0) {
      return h(
        "div",
        { style: { textAlign: "center", padding: 40 } },
        h(Empty, { description: "暂无流程定义" }),
        h(
          "div",
          { style: { marginTop: 16 } },
          h(
            Button,
            {
              type: "primary",
              onClick: function () { props.onCreate(); },
            },
            "+ 创建流程"
          )
        )
      );
    }

    return h(
      "div",
      null,
      h(
        "div",
        { style: { display: "flex", justifyContent: "flex-end", marginBottom: 16 } },
        h(
          Button,
          { type: "primary", onClick: function () { props.onCreate(); } },
          "+ 创建流程"
        )
      ),
      flows.map(function (f) {
        var nodeCount = f.node_count || (f.nodes || []).length;
        var edgeCount = f.edge_count || (f.edges || []).length;
        return h(
          "div",
          {
            key: f.id,
            style: {
              border: "1px solid #e8e8e8",
              borderRadius: 8,
              padding: 16,
              marginBottom: 12,
              cursor: "pointer",
            },
            onClick: function () { props.onSelect(f.id); },
          },
          h(
            "div",
            { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
            h(
              "div",
              null,
              h("h3", { style: { margin: 0, fontSize: 16, color: "#1f1f1f" } }, f.name),
              h(
                "p",
                { style: { margin: "4px 0 0", color: "#999", fontSize: 13 } },
                nodeCount + " 节点 · " + edgeCount + " 连线"
              )
            ),
            h(
              "div",
              { style: { display: "flex", gap: 8 } },
              h(
                Button,
                {
                  size: "small",
                  onClick: function (e) {
                    e.stopPropagation();
                    props.onSelect(f.id);
                  },
                },
                "查看"
              ),
              h(
                Button,
                {
                  size: "small",
                  danger: true,
                  onClick: function (e) {
                    e.stopPropagation();
                    handleDelete(f.id);
                  },
                },
                "删除"
              )
            )
          )
        );
      })
    );
  }

  // ── Flow detail view ───────────────────────────────────────────

  function FlowDetail(props) {
    var flowState = React.useState(null);
    var flow = flowState[0];
    var setFlow = flowState[1];
    var errorState = React.useState(null);
    var error = errorState[0];
    var setError = errorState[1];

    React.useEffect(function () {
      setFlow(null);
      setError(null);
      apiFetch("/flows/" + props.flowId)
        .then(function (data) { setFlow(data); })
        .catch(function (err) { setError(err.message); });
    }, [props.flowId]);

    if (error) return h("div", { style: { color: "#ff4d4f" } }, "加载失败: " + error);
    if (!flow) return h("div", { style: { color: "#999" } }, "加载中...");

    var nodes = flow.nodes || [];
    var edges = flow.edges || [];

    var typeColors = {
      stage: "#0065fd",
      decision: "#ff9500",
      parallel: "#34c759",
      merge: "#5856d6",
      terminal: "#ff3b30",
      loop: "#af52de",
    };

    return h(
      "div",
      null,
      h(
        "div",
        { style: { marginBottom: 16 } },
        h(
          Button,
          { onClick: function () { props.onBack(); } },
          "← 返回列表"
        )
      ),
      h("h2", { style: { margin: "0 0 8px", fontSize: 20, color: "#1f1f1f" } }, flow.name),
      h("p", { style: { color: "#999", margin: "0 0 16px", fontSize: 13 } }, "ID: " + flow.id),
      h("h3", { style: { fontSize: 15, margin: "16px 0 8px" } }, "节点 (" + nodes.length + ")"),
      h(
        "div",
        { style: { display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 16 } },
        nodes.map(function (n, i) {
          var color = typeColors[n.type] || "#999";
          return h(
            "div",
            {
              key: i,
              style: {
                display: "inline-block",
                margin: 4,
                padding: "8px 12px",
                borderRadius: 8,
                background: color + "15",
                border: "2px solid " + color,
                minWidth: 120,
                textAlign: "center",
              },
            },
            h("div", { style: { fontWeight: 600, fontSize: 14, color: "#1f1f1f" } }, n.label),
            h(
              "div",
              { style: { fontSize: 11, color: color, marginTop: 2 } },
              n.type + (n.speaker_agent_id ? " · " + n.speaker_agent_id : "")
            )
          );
        })
      ),
      h("h3", { style: { fontSize: 15, margin: "16px 0 8px" } }, "连线 (" + edges.length + ")"),
      h(
        "div",
        { style: { background: "#f5f5f5", borderRadius: 8, padding: 12 } },
        edges.length > 0
          ? edges.map(function (e, i) {
              return h(
                "div",
                { key: i, style: { fontSize: 12, color: "#666", margin: "2px 0" } },
                e.source + " → " + e.target + (e.condition ? " (" + e.condition + ")" : "")
              );
            })
          : h("div", { style: { color: "#999", fontSize: 13 } }, "无连线")
      )
    );
  }

  // ── Create flow modal ──────────────────────────────────────────

  function CreateFlowModal(props) {
    var nameState = React.useState("");
    var name = nameState[0];
    var setName = nameState[1];
    var jsonState = React.useState("");
    var jsonStr = jsonState[0];
    var setJsonStr = jsonState[1];
    var submittingState = React.useState(false);
    var submitting = submittingState[0];
    var setSubmitting = submittingState[1];

    function handleSubmit() {
      if (!name.trim()) {
        if (message) message.warning("请填写流程名称");
        return;
      }
      if (!jsonStr.trim()) {
        if (message) message.warning("请填写 JSON 定义");
        return;
      }
      var parsed;
      try {
        parsed = JSON.parse(jsonStr);
      } catch (e) {
        if (message) message.error("JSON 格式错误: " + e.message);
        return;
      }
      var body = {
        name: name,
        nodes: parsed.nodes || [],
        edges: parsed.edges || [],
        entry_node_id: parsed.entry_node_id || (parsed.nodes && parsed.nodes[0] ? parsed.nodes[0].id : undefined),
      };
      setSubmitting(true);
      apiFetch("/flows", { method: "POST", body: body })
        .then(function () {
          if (message) message.success("创建成功");
          props.onClose();
        })
        .catch(function (err) {
          if (message) message.error("创建失败: " + err.message);
        })
        .finally(function () { setSubmitting(false); });
    }

    return h(
      Modal,
      {
        open: true,
        title: "创建流程",
        okText: "创建",
        cancelText: "取消",
        confirmLoading: submitting,
        onOk: handleSubmit,
        onCancel: props.onClose,
      },
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: 16, paddingTop: 8 } },
        h(
          "div",
          null,
          h("label", { style: { display: "block", marginBottom: 4, fontSize: 13 } }, "流程名称"),
          h(Input, {
            placeholder: "例如：模拟仲裁流程",
            value: name,
            onChange: function (e) { setName(e.target.value); },
          })
        ),
        h(
          "div",
          null,
          h("label", { style: { display: "block", marginBottom: 4, fontSize: 13 } }, "JSON 定义（节点 + 连线）"),
          h(Input.TextArea, {
            rows: 12,
            style: { fontFamily: "monospace", fontSize: 13 },
            placeholder: '{"nodes":[{"id":"n1","label":"开庭","type":"stage","max_turns":2}],"edges":[],"entry_node_id":"n1"}',
            value: jsonStr,
            onChange: function (e) { setJsonStr(e.target.value); },
          })
        )
      )
    );
  }

  // ── Main page component ─────────────────────────────────────────

  function FlowManagerPage() {
    var viewState = React.useState({ type: "list" });
    var view = viewState[0];
    var setView = viewState[1];
    var createModalState = React.useState(false);
    var showCreate = createModalState[0];
    var setShowCreate = createModalState[1];

    return h(
      "div",
      { style: { fontFamily: "system-ui, -apple-system, sans-serif", maxWidth: 960, margin: "0 auto", padding: 24 } },
      h("h1", { style: { margin: "0 0 8px", fontSize: 24, color: "#1f1f1f" } }, "🔀 FlowManager"),
      h("p", { style: { color: "#666", margin: "0 0 24px" } }, "流程定义与管理 — 可视化流程引擎，供群聊和智能体调用"),
      view.type === "list"
        ? h(FlowList, {
            onCreate: function () { setShowCreate(true); },
            onSelect: function (flowId) { setView({ type: "detail", flowId: flowId }); },
          })
        : h(FlowDetail, {
            flowId: view.flowId,
            onBack: function () { setView({ type: "list" }); },
          }),
      showCreate
        ? h(CreateFlowModal, { onClose: function () { setShowCreate(false); } })
        : null
    );
  }

  // ── Self-register route ─────────────────────────────────────────

  AIArb.registerRoutes("flow-manager", [
    {
      path: "/apps/flow-manager",
      component: FlowManagerPage,
      label: "FlowManager",
      icon: "🔀",
    },
  ]);

  console.info("[flow-manager] registered route /apps/flow-manager");
})();
