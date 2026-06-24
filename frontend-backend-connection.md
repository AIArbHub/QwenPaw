# QwenPaw 前后端是怎么连接起来的？

## 一句话总结

**前端（React）通过 HTTP 请求调用后端（Python/FastAPI）提供的 API 接口，后端处理业务逻辑后返回 JSON 数据，前端拿到数据后渲染到页面上。**

---

## 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      你的浏览器                              │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │              前端 (React + Vite)                      │   │
│   │                                                     │   │
│   │   页面组件 ──→ API 模块 ──→ fetch() 发 HTTP 请求     │   │
│   │   (Chat.tsx)   (chat.ts)    (request.ts)            │   │
│   └──────────────────────┬──────────────────────────────┘   │
│                          │                                  │
│                   HTTP 请求 (JSON)                           │
│                          │                                  │
└──────────────────────────┼──────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              │                         │
     开发环境: Vite 代理          生产环境: 同一服务器
     localhost:5174 ──→          后端直接托管前端静态文件
     localhost:8088              (FastAPI 返回 index.html)
              │                         │
              └────────────┬────────────┘
                           │
┌──────────────────────────┼──────────────────────────────────┐
│                          ▼                                  │
│   ┌─────────────────────────────────────────────────────┐   │
│   │           后端 (Python + FastAPI)                     │   │
│   │                                                     │   │
│   │   路由层 (routers/) ──→ 业务逻辑 ──→ AI Agent       │   │
│   │   messages.py       agent.py    react_agent.py      │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 第一步：前端怎么知道后端在哪？

### 开发环境（你现在用的）

打开 `console/vite.config.ts`，里面有一段关键配置：

```ts
server: {
  proxy: {
    "/api": {
      target: "http://localhost:8088",  // 后端地址
      changeOrigin: false,
    },
  },
},
```

**原理**：Vite 开发服务器运行在 `localhost:5174`，当前端请求 `/api/xxx` 时，Vite 会自动把请求**转发**到 `localhost:8088`（Python 后端）。这叫**代理（Proxy）**。

就像你给朋友打电话，但电话先经过了一个总机（Vite），总机帮你转接到真正的号码（后端）。

### 生产环境（正式部署）

打开 `src/qwenpaw/app/_app.py`，找到这段：

```python
@app.get("/")
def read_root():
    if _CONSOLE_INDEX and _CONSOLE_INDEX.exists():
        return FileResponse(_CONSOLE_INDEX)  # 返回前端打包好的 index.html
```

**原理**：生产环境中，前端代码被打包成静态文件（HTML/CSS/JS），Python 后端直接**托管**这些文件。前后端运行在**同一个端口**（8088），不存在跨域问题。

---

## 第二步：前端怎么发请求？

前端有一个统一的"请求工厂"，位于 `console/src/api/` 目录：

### 1. 配置层 — `config.ts`

```ts
// 拼接 API 地址：基础地址 + /api + 具体路径
export function getApiUrl(path: string): string {
  const base = VITE_API_BASE_URL || "";  // 开发环境为空，生产环境也是空
  const apiPrefix = "/api";
  return `${base}${apiPrefix}${path}`;
  // 例如: getApiUrl("/models") → "/api/models"
}

// 管理登录 Token
export function getApiToken(): string {
  const stored = localStorage.getItem("qwenpaw_auth_token");
  if (stored) return stored;
  return typeof TOKEN !== "undefined" ? TOKEN : "";
}
```

### 2. 认证层 — `authHeaders.ts`

```ts
// 每次请求自动附带 Token 和 Agent ID
export function buildAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = getApiToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;  // 身份验证
  }
  // 还会附带当前选择的 Agent ID
  headers["X-Agent-Id"] = selectedAgent;
  return headers;
}
```

**就像每次出门都要带身份证（Token）和工牌（Agent ID），后端看到这些才知道你是谁、在操作哪个 Agent。**

### 3. 请求层 — `request.ts`

```ts
// 统一的 HTTP 请求函数
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = getApiUrl(path);           // 拼接完整 URL
  const headers = buildHeaders(method);  // 自动加认证头

  const response = await fetch(url, { ...options, headers });  // 发请求

  if (!response.ok) {
    if (response.status === 401) {
      clearAuthToken();                   // Token 过期，跳转登录页
      window.location.href = "/login";
    }
    throw new Error("请求失败");
  }

  return await response.json();          // 解析 JSON 响应
}
```

### 4. 业务层 — `modules/chat.ts` 等

每个功能模块都有自己的 API 文件，调用上面的 `request()` 函数：

```ts
export const chatApi = {
  listChats: (params) => {
    return request<ChatHistory>("/chats", { params });  // GET /api/chats
  },
  deleteChat: (chatId: string) => {
    return request(`/chats/${chatId}`, { method: "DELETE" });  // DELETE /api/chats/xxx
  },
  uploadFile: async (file: File) => {
    // 文件上传用 FormData，不走通用 request
    const formData = new FormData();
    formData.append("file", file);
    return fetch(getApiUrl("/console/upload"), { method: "POST", body: formData });
  },
};
```

---

## 第三步：后端怎么接收和处理？

### 1. 应用入口 — `_app.py`

```python
app = FastAPI(
    lifespan=lifespan,           # 启动/关闭时的初始化逻辑
    default_response_class=ORJSONResponse,  # 用更快的 JSON 序列化
)

# 中间件（按顺序执行）
app.add_middleware(AgentContextMiddleware)  # 从请求头提取 Agent ID
app.add_middleware(AuthMiddleware)          # 验证 Token 是否合法
```

**中间件就像保安**：每个请求进来，先检查 Token（你认识吗？），再提取 Agent ID（你要找哪个部门？），然后才放行。

### 2. 路由层 — `routers/messages.py`

```python
router = APIRouter(prefix="/messages", tags=["messages"])

class SendMessageRequest(BaseModel):
    channel: str       # 目标渠道（console/钉钉/飞书...）
    target_user: str   # 目标用户
    text: str          # 消息内容

@router.post("/send")
async def send_message(req: SendMessageRequest):
    # 处理发送消息的业务逻辑
    ...
```

所有路由都挂在 `/api` 前缀下（在 `routers/__init__.py` 中统一注册），所以完整路径是 `/api/messages/send`。

### 3. 业务层 — Agent 处理

```python
class DynamicMultiAgentRunner:
    async def stream_query(self, request, *args, **kwargs):
        workspace = await self._get_workspace(request)  # 根据 Agent ID 找到对应的工作区
        runner = workspace.runner                         # 获取 AI 运行器
        async for item in runner.stream_query(request):   # 流式调用 AI 模型
            yield item                                    # 逐条返回结果
```

---

## 第四步：数据怎么回传？

### 普通请求（JSON）

```
前端: GET /api/models
  ↓
后端: 查询数据库中的模型列表
  ↓
后端: 返回 JSON [{"id": "gpt-4", "name": "GPT-4"}, ...]
  ↓
前端: request() 解析 JSON → 页面渲染
```

### 流式请求（SSE — 聊天场景）

```
前端: POST /api/console/stream_query
  ↓
后端: 调用 AI 模型，模型逐字生成
  ↓
后端: 逐条 yield {"text": "你"}, {"text": "好"}, {"text": "！"}
  ↓
前端: 用 EventSource 或 ReadableStream 逐条读取，实时显示
```

这就是为什么聊天时你能看到文字一个一个蹦出来——后端不是等全部生成完才返回，而是**流式传输**。

---

## 关键文件速查表

| 文件 | 作用 |
|------|------|
| `console/vite.config.ts` | Vite 开发服务器配置，包含 API 代理规则 |
| `console/src/api/config.ts` | API 地址拼接、Token 管理 |
| `console/src/api/authHeaders.ts` | 请求头构建（Token + Agent ID） |
| `console/src/api/request.ts` | 统一 HTTP 请求函数（fetch 封装） |
| `console/src/api/modules/*.ts` | 各业务模块的 API 调用（chat、agent、skill...） |
| `console/src/api/types/*.ts` | API 返回数据的 TypeScript 类型定义 |
| `src/qwenpaw/app/_app.py` | FastAPI 应用创建、中间件、静态文件托管 |
| `src/qwenpaw/app/auth.py` | Token 验证中间件 |
| `src/qwenpaw/app/routers/*.py` | API 路由定义（messages、agents、skills...） |
| `src/qwenpaw/app/runner/session.py` | AI Agent 会话管理 |

---

## 一图总结整个流程

```
用户点击"发送消息"
    │
    ▼
Chat.tsx 页面组件
    │  调用 chatApi.sendMessage()
    ▼
modules/chat.ts
    │  调用 request("/console/stream_query", { method: "POST", body: ... })
    ▼
request.ts
    │  拼接 URL: "/api/console/stream_query"
    │  附加 Header: Authorization: Bearer <token>
    │  附加 Header: X-Agent-Id: default
    │  发起 fetch()
    ▼
Vite 代理 (开发环境) 或 直接访问 (生产环境)
    │  转发到 localhost:8088
    ▼
FastAPI 后端
    │  AuthMiddleware 验证 Token ✓
    │  AgentContextMiddleware 提取 Agent ID ✓
    ▼
routers/console.py
    │  路由匹配 POST /api/console/stream_query
    ▼
DynamicMultiAgentRunner.stream_query()
    │  根据 Agent ID 找到对应工作区
    ▼
AI Agent (react_agent.py)
    │  调用大语言模型 API（OpenAI/通义千问...）
    │  模型逐字生成回复
    ▼
流式返回 (Server-Sent Events)
    │
    ▼
Chat.tsx 接收并逐字渲染到页面
    │
    ▼
用户看到 AI 回复 ✓
```
