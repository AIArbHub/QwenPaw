import { Tabs } from "antd";
import { useSearchParams } from "react-router-dom";
import MCPPage from "../../Agent/MCP";
import ACPPage from "../../Agent/ACP";

export default function DesignExtensionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "mcp";

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Tabs
        activeKey={activeTab}
        onChange={(key) => setSearchParams({ tab: key })}
        style={{ paddingLeft: 16, paddingRight: 16 }}
        items={[
          { key: "mcp", label: "MCP", children: <MCPPage /> },
          { key: "acp", label: "ACP", children: <ACPPage /> },
        ]}
      />
    </div>
  );
}