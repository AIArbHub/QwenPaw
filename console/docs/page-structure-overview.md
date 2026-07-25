# AIArb 前端页面结构总览

> 生成时间：2026-07-11
> 来源：`builtinRoutes.tsx` + `builtinMenu.ts` + `Sidebar.tsx` + 各页面源码

---

## 三种侧栏模式

侧栏模式存储在 `localStorage("aiarb_sidebar_mode")`，通过 `sidebarModeStore` 管理，循环切换顺序为 `full → simple → design`。

| 模式 | 内部ID | 说明 |
|------|--------|------|
| **详版（Full）** | `full` | 默认模式，展示全部菜单分组，4 个分组共 28 个菜单项 |
| **简版（Simple）** | `simple` | 极简模式，白名单仅 3 项：技能、模型管理、智能体管理；仲裁业务区保留全部 6 项 |
| **设计版（Design）** | `design` | 扁平化设计模式，将多页面合并为 5 个聚合页（Design/*），共 16 个扁平入口 |

---

## 一、详版（Full Mode） — 完整菜单层级

### 📌 固定入口（不在侧栏菜单中）

| 入口 | 路由 | 说明 |
|------|------|------|
| 💬 聊天 | `/chat/*` | 粘性按钮，位于 AgentSelector 旁，不作为菜单项 |
| 📝 编程模式 | `/coding/*` | 编程模式下的独立页面，替代聊天 |
| 📨 收件箱 | `/inbox` | 通过头部图标按钮访问，带未读角标 |

### 🗂️ 分组 1：仲裁业务（`primary.arbitration`）

| 序号 | 菜单项 | 路由ID | 路径 | 页面文件 | 内部Tab |
|------|--------|--------|------|----------|---------|
| 1 | 本地资料 | `core.knowledge` | `/knowledge` | `pages/Knowledge/` | 📑 AI总结 / 基本信息 / 原文预览 / 脱敏对比 |
| 2 | 模拟仲裁 | `core.moot` | `/moot` | `pages/Moot/` | — |
| 3 | 文档智能 | `core.desensitize` | `/desensitize` | `pages/Desensitize/` | — |
| 4 | Wiki | `core.wiki` | `/wiki` | `pages/Wiki/` | — |
| 5 | 案件卷宗 | `core.cases` | `/cases` | `pages/Cases/` | — |
| 6 | 记忆中心 | `core.memory` | `/memory` | `pages/Memory/` | — |

### 🗂️ 分组 2：智能体工作区（`primary.the frameworkd`）

| 序号 | 菜单项 | 路由ID | 路径 | 页面文件 | 内部Tab |
|------|--------|--------|------|----------|---------|
| 1 | 工作区文件 | `core.workspace` | `/workspace` | `pages/Agent/Workspace/` | 🔄 可视化模式 / 专家模式（新增） |
| 2 | 技能 | `core.skills` | `/skills` | `pages/Agent/Skills/` | — |
| 3 | 工具 | `core.tools` | `/tools` | `pages/Agent/Tools/` | — |
| 4 | MCP | `core.mcp` | `/mcp` | `pages/Agent/MCP/` | 内置 / 自定义 |
| 5 | ACP | `core.acp` | `/acp` | `pages/Agent/ACP/` | 内置 / 自定义 |
| 6 | Agent配置 | `core.agent-config` | `/agent-config` | `pages/Agent/Config/` | 📑 React Agent / Agent Loop / LLM重试 / LLM限流 / 记忆 / 工具执行级别 |

### 🗂️ 分组 3：系统设置（`primary.settings` — group 1）

| 序号 | 菜单项 | 路由ID | 路径 | 页面文件 | 内部Tab |
|------|--------|--------|------|----------|---------|
| 1 | 模型管理 | `core.models` | `/models` | `pages/Settings/Models/` | — (卡片分区：LLM配置 / Provider列表 / 已添加模型) |
| 2 | 智能体管理 | `core.agents` | `/agents` | `pages/Settings/Agents/` | 列表视图 / 卡片视图 |
| 3 | 渠道 | `core.channels` | `/channels` | `pages/Control/Channels/` | 📑 全部 / 内置 / 自定义 |
| 4 | 会话 | `core.sessions` | `/sessions` | `pages/Control/Sessions/` | — |
| 5 | Token用量 | `core.token-usage` | `/token-usage` | `pages/Settings/TokenUsage/` | — |
| 6 | 环境变量 | `core.environments` | `/environments` | `pages/Settings/Environments/` | — |

### 🗂️ 分组 4：运维与调试（`primary.settings` — group 2，可折叠）

| 序号 | 菜单项 | 路由ID | 路径 | 页面文件 | 内部Tab |
|------|--------|--------|------|----------|---------|
| 1 | 安全 | `core.security` | `/security` | `pages/Settings/Security/` | 📑 工具守卫 / 文件守卫 / 技能扫描 / 免认证白名单 |
| 2 | 备份 | `core.backups` | `/backups` | `pages/Settings/Backups/` | — (列表 + 创建弹窗 + 恢复弹窗 + 导入) |
| 3 | 调试 | `core.debug` | `/debug` | `pages/Settings/Debug/` | 📑 日志级别筛选 |
| 4 | 插件 | `core.plugin-manager` | `/plugin-manager` | `pages/Settings/PluginManager/` | 📑 已安装 / 官方插件 / 插件市场 |
| 5 | 定时任务 | `core.cron-jobs` | `/cron-jobs` | `pages/Control/CronJobs/` | — |
| 6 | 心跳 | `core.heartbeat` | `/heartbeat` | `pages/Control/Heartbeat/` | — |
| 7 | 语音转写 | `core.voice-transcription` | `/voice-transcription` | `pages/Settings/VoiceTranscription/` | — |
| 8 | 智能体统计 | `core.agent-stats` | `/agent-stats` | `pages/Settings/AgentStats/` | — |
| 9 | 技能池 | `core.skill-pool` | `/skill-pool` | `pages/Settings/SkillPool/` | — |
| 10 | 桌面宠物 | `core.pet` | `/pet` | `pages/Settings/Pet/` | — |
| 11 | 全局划词 | `core.text-selection` | `/text-selection` | `pages/Settings/TextSelection/` | — |

### 🔗 有路由但不在侧栏菜单中的页面

| 路由ID | 路径 | 页面文件 | 说明 |
|--------|------|----------|------|
| `core.inbox` | `/inbox` | `pages/Inbox/` | 📑 推送消息 / 审批待办 |
| `core.moot-tribunal` | `/tribunal` | `pages/Moot/` | 模拟仲裁的 Tribunal 视图（复用 Moot 页面） |
| `core.acp-alias` | `/ACP` | → 重定向到 `/acp` | 大写别名 |
| `core.root` | `/` | → 重定向到 `/chat` 或 `/coding` | 根路径自动跳转 |

---

## 二、简版（Simple Mode） — 极简菜单

### 🗂️ 仲裁业务区（保留全部 6 项，与详版相同）

同详版分组 1。

### 🗂️ 精简工作区/设置区（仅白名单 3 项）

白名单定义在 `SIMPLE_MODE_WHITELIST`：

| 序号 | 菜单项 | 路由ID | 路径 |
|------|--------|--------|------|
| 1 | 技能 | `core.skills` | `/skills` |
| 2 | 模型管理 | `core.models` | `/models` |
| 3 | 智能体管理 | `core.agents` | `/agents` |

> 简版模式下，分组标题被移除，白名单项被提升为顶级条目。

---

## 三、设计版（Design Mode） — 扁平化聚合

设计版将原有分散页面合并为 5 个聚合页，每个聚合页内部用 Tabs 组织子页面。同时保留仲裁业务区的 6 项作为独立入口。

### 📌 固定入口

| 入口 | 路由 | 说明 |
|------|------|------|
| 💬 Chat | `core.chat` | 聊天 |
| 📨 收件箱 | — | 通过头部图标访问 |

### 🗂️ 仲裁业务区（保留全部 6 项，与详版相同）

同详版分组 1。

### 🗂️ 设计版聚合页

| 序号 | 聚合页 | 路由ID | 路径 | 页面文件 | 内部Tab（合并的原页面） |
|------|--------|--------|------|----------|----------------------|
| 1 | **Skills** | `design.skills` | `/design/skills` | `pages/Design/Skills/` | 📑 技能(`core.skills`) / 技能池(`core.skill-pool`) / 技能市场(`Market`) |
| 2 | **Extensions** | `design.extensions` | `/design/extensions` | `pages/Design/Extensions/` | 📑 MCP(`core.mcp`) / ACP(`core.acp`) |
| 3 | **Agent** | `design.agent` | `/design/agent` | `pages/Design/Agent/` | 📑 智能体管理(`core.agents`) / Agent配置(`core.agent-config`) / 智能体统计(`core.agent-stats`) |
| 4 | **Usage** | `design.usage` | `/design/usage` | `pages/Design/Usage/` | 📑 Token用量(`core.token-usage`) / 智能体统计(`core.agent-stats`) |
| 5 | **Ops** | `design.ops` | `/design/ops` | `pages/Design/Ops/` | 📑 备份(`core.backups`) / 调试(`core.debug`) / 语音转写(`core.voice-transcription`) / 插件(`core.plugin-manager`) |

### 🗂️ 设计版独立入口（不聚合，直接展示）

| 序号 | 菜单项 | 路由ID | 路径 | 说明 |
|------|--------|--------|------|------|
| 1 | Tools | `core.tools` | `/tools` | 工具 |
| 2 | Channels | `core.channels` | `/channels` | 渠道 |
| 3 | Sessions | `core.sessions` | `/sessions` | 会话 |
| 4 | Files | `core.workspace` | `/workspace` | 工作区文件 |
| 5 | Models | `core.models` | `/models` | 模型管理 |
| 6 | Environments | `core.environments` | `/environments` | 环境变量 |
| 7 | Security | `core.security` | `/security` | 安全 |
| 8 | Cron Jobs | `core.cron-jobs` | `/cron-jobs` | 定时任务 |
| 9 | Heartbeat | `core.heartbeat` | `/heartbeat` | 心跳 |

---

## 四、页面路由完整清单（按路由ID字母序）

| 路由ID | 路径 | 页面 | 详版 | 简版 | 设计版 |
|--------|------|------|:----:|:----:|:------:|
| `core.root` | `/` | 重定向 | — | — | — |
| `core.chat` | `/chat/*` | 聊天 | 粘性按钮 | 粘性按钮 | 独立入口 |
| `core.coding` | `/coding/*` | 编程模式 | 编程模式切换 | 编程模式切换 | 编程模式切换 |
| `core.knowledge` | `/knowledge` | 本地资料 | ✅ 分组1-1 | ✅ | ✅ 仲裁区 |
| `core.moot` | `/moot` | 模拟仲裁 | ✅ 分组1-2 | ✅ | ✅ 仲裁区 |
| `core.desensitize` | `/desensitize` | 文档智能 | ✅ 分组1-3 | ✅ | ✅ 仲裁区 |
| `core.wiki` | `/wiki` | Wiki | ✅ 分组1-4 | ✅ | ✅ 仲裁区 |
| `core.cases` | `/cases` | 案件卷宗 | ✅ 分组1-5 | ✅ | ✅ 仲裁区 |
| `core.memory` | `/memory` | 记忆中心 | ✅ 分组1-6 | ✅ | ✅ 仲裁区 |
| `core.workspace` | `/workspace` | 工作区文件 | ✅ 分组2-1 | ❌ | ✅ 独立入口 |
| `core.skills` | `/skills` | 技能 | ✅ 分组2-2 | ✅ 白名单 | ✅ Skills Tab1 |
| `core.tools` | `/tools` | 工具 | ✅ 分组2-3 | ❌ | ✅ 独立入口 |
| `core.mcp` | `/mcp` | MCP | ✅ 分组2-4 | ❌ | ✅ Extensions Tab1 |
| `core.acp` | `/acp` | ACP | ✅ 分组2-5 | ❌ | ✅ Extensions Tab2 |
| `core.agent-config` | `/agent-config` | Agent配置 | ✅ 分组2-6 | ❌ | ✅ Agent Tab2 |
| `core.models` | `/models` | 模型管理 | ✅ 分组3-1 | ✅ 白名单 | ✅ 独立入口 |
| `core.agents` | `/agents` | 智能体管理 | ✅ 分组3-2 | ✅ 白名单 | ✅ Agent Tab1 |
| `core.channels` | `/channels` | 渠道 | ✅ 分组3-3 | ❌ | ✅ 独立入口 |
| `core.sessions` | `/sessions` | 会话 | ✅ 分组3-4 | ❌ | ✅ 独立入口 |
| `core.token-usage` | `/token-usage` | Token用量 | ✅ 分组3-5 | ❌ | ✅ Usage Tab1 |
| `core.environments` | `/environments` | 环境变量 | ✅ 分组3-6 | ❌ | ✅ 独立入口 |
| `core.security` | `/security` | 安全 | ✅ 分组4-1 | ❌ | ✅ 独立入口 |
| `core.backups` | `/backups` | 备份 | ✅ 分组4-2 | ❌ | ✅ Ops Tab1 |
| `core.debug` | `/debug` | 调试 | ✅ 分组4-3 | ❌ | ✅ Ops Tab2 |
| `core.plugin-manager` | `/plugin-manager` | 插件 | ✅ 分组4-4 | ❌ | ✅ Ops Tab3 |
| `core.cron-jobs` | `/cron-jobs` | 定时任务 | ✅ 分组4-5 | ❌ | ✅ 独立入口 |
| `core.heartbeat` | `/heartbeat` | 心跳 | ✅ 分组4-6 | ❌ | ✅ 独立入口 |
| `core.voice-transcription` | `/voice-transcription` | 语音转写 | ✅ 分组4-7 | ❌ | ✅ Ops Tab4 |
| `core.agent-stats` | `/agent-stats` | 智能体统计 | ✅ 分组4-8 | ❌ | ✅ Agent Tab3 / Usage Tab2 |
| `core.skill-pool` | `/skill-pool` | 技能池 | ✅ 分组4-9 | ❌ | ✅ Skills Tab2 |
| `core.pet` | `/pet` | 桌面宠物 | ✅ 分组4-10 | ❌ | ❌ |
| `core.text-selection` | `/text-selection` | 全局划词 | ✅ 分组4-11 | ❌ | ❌ |
| `core.inbox` | `/inbox` | 收件箱 | 头部图标 | 头部图标 | 头部图标 |
| `core.moot-tribunal` | `/tribunal` | Tribunal视图 | — | — | — |
| `core.acp-alias` | `/ACP` | ACP别名 | — | — | — |
| `design.skills` | `/design/skills` | 设计版-Skills | — | — | ✅ 聚合页 |
| `design.extensions` | `/design/extensions` | 设计版-Extensions | — | — | ✅ 聚合页 |
| `design.agent` | `/design/agent` | 设计版-Agent | — | — | ✅ 聚合页 |
| `design.usage` | `/design/usage` | 设计版-Usage | — | — | ✅ 聚合页 |
| `design.ops` | `/design/ops` | 设计版-Ops | — | — | ✅ 聚合页 |

---

## 五、关键配置文件索引

| 文件 | 作用 |
|------|------|
| `console/src/layouts/registry/builtinRoutes.tsx` | 所有路由定义（Route ID → path → component） |
| `console/src/layouts/registry/builtinMenu.ts` | 详版侧栏菜单定义（分组、顺序、图标） |
| `console/src/layouts/Sidebar.tsx` | 侧栏渲染逻辑（含简版白名单、设计版聚合导航） |
| `console/src/stores/sidebarModeStore.ts` | 侧栏模式状态管理（full/simple/design 切换） |
| `console/src/pages/Design/*/index.tsx` | 设计版 5 个聚合页（Tabs 合并子页面） |
