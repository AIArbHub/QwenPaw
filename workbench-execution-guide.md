# QwenPaw × StaffDeck 前端融合 — 执行指令

> 本文件是给 TRAE Work（AI 编码助手）的执行指令。配合 `workbench-refinement-plan.html` 方案文档使用。
> 方案文档是"做什么"，本文件是"怎么执行、按什么顺序、如何验证"。

## 项目上下文

- **项目路径**: `d:\BaiduSyncdisk\Project\QwenPaw`
- **前端代码目录**: `console/src/`
- **技术栈**: React 18 + TypeScript + Ant Design 5 + CSS Modules (.less) + Zustand + React Router v6 + react-i18next
- **包管理**: pnpm
- **禁止事项**:
  - 不引入 TailwindCSS
  - 不替换组件库（保持 Ant Design 5 + @agentscope-ai/design）
  - 不删除任何现有功能
  - 不修改后端代码
- **方案文档**: `d:\BaiduSyncdisk\Project\QwenPaw\workbench-refinement-plan.html`（浏览器打开可查看完整设计规格）

## 执行总则

1. **每完成一个阶段，先运行 `pnpm build` 验证编译通过，再进入下一阶段**
2. **所有新增文案需同步添加 i18n 中英文翻译**（`console/src/i18n.ts` 或对应 locale 文件）
3. **暗色模式必须支持**：使用 CSS 变量，在 `:global(.dark-mode)` 中覆盖
4. **组件提取时不修改原页面逻辑**：原页面改为调用提取后的组件，功能保持不变
5. **遇到不确定的 API 签名时，先读现有代码确认，不要猜测**

---

## 阶段 1：设计令牌 + 基础组件（1-2 天）

### 任务 1.1：创建设计令牌文件

**创建文件**: `console/src/styles/staffdeck-tokens.css`

内容见方案文档第 7.1 节。核心是定义 `--sd-*` 系列 CSS 变量，包含亮色/暗色两套值。

**验证**: 在 `console/src/App.tsx` 或全局入口引入该文件，浏览器 DevTools 检查 `:root` 是否有 `--sd-ink` 等变量。

### 任务 1.2：创建 UnderlineTabs 组件

**创建文件**:
- `console/src/components/UnderlineTabs/index.tsx`
- `console/src/components/UnderlineTabs/index.module.less`

**规格**（见方案文档第 3.3 节）:
- Props: `items: { key, label, count? }[]`, `active: string`, `onChange: (key) => void`, `variant?: 'dot' | 'line'`
- 高度 36px，文字 14px
- 默认色 `#858B9C`，选中 `#18181A` + `font-weight: 600` + 底部 2px 实线
- hover 色 `#464C5E`
- 使用 `--sd-*` CSS 变量

**参考现有代码**: `console/src/pages/Settings/Agents/index.module.less` 中现有的 tab 样式

**验证**: 临时在 AgentsPage 中渲染 `<UnderlineTabs>`，检查视觉是否符合预期。

### 任务 1.3：创建 useMobile hook

**创建文件**: `console/src/hooks/useMobile.ts`

```typescript
import { useState, useEffect } from 'react';
export function useMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(max-width: ${breakpoint}px)`).matches
  );
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [breakpoint]);
  return isMobile;
}
```

**验证**: 在任意页面调用 `const isMobile = useMobile()`，控制台打印，调整窗口宽度观察变化。

### 阶段 1 完成标准
- [ ] `pnpm build` 编译通过
- [ ] CSS 变量在 DevTools 中可见
- [ ] UnderlineTabs 渲染正常
- [ ] 暗色模式下变量值正确切换

---

## 阶段 2：AgentCard 改造（2-3 天）

### 任务 2.1：创建 useAgentStatsBatch hook

**创建文件**: `console/src/pages/Settings/Agents/hooks/useAgentStatsBatch.ts`

**先读这些文件确认 API 签名**:
- `console/src/api/index.ts` — 找 `getAgentStats` 方法
- `console/src/api/types/agentStats.ts` — 确认返回类型
- `console/src/pages/Settings/AgentStats/index.tsx` — 看现有调用方式

**Hook 规格**:
```typescript
interface AgentStatInfo {
  sessions: number;
  messages: number;
  lastActive: string; // ISO 时间或相对时间
}
export function useAgentStatsBatch(): {
  statsMap: Record<string, AgentStatInfo>;
  loading: boolean;
}
```

策略：调用一次 `api.getAgentStats()`，按 `agent_id` 索引结果。若 API 不支持 per-agent 粒度，返回空对象，卡片显示 `--`。

### 任务 2.2：改造 AgentCard

**修改文件**:
- `console/src/pages/Settings/Agents/components/AgentCard.tsx`
- `console/src/pages/Settings/Agents/components/AgentCard.module.less`（可能需要新建独立样式文件）

**改造清单**（见方案文档第 2.2 节，共 11 项）:

1. **隐藏 ID 行** — 删除 `<div className={styles.cardId}>ID: {agent.id}</div>`
2. **隐藏 workspace_dir** — 删除 cardMeta 中的 workspace 显示
3. **隐藏模型信息** — 删除 cardMeta 中的 model 显示
4. **头像溢出设计** — 新增 `headerBar` 灰条容器（68px 高，`#f6f6f6` 底，18px 圆角，`margin-top: 34px`）+ `avatarOverflow` 绝对定位头像（80×94px，`top: -42px`）
5. **状态最小化** — 替换 `<Tag>` 为 `statusRow`（6px 圆点 + 10px 文字）
6. **新增统计三联格** — `statsTri` grid（3 列，边框，圆角 14px，`margin-top: auto` 钉底部）
7. **新增工作风格标签** — `agent.tags?.length > 0 && (...)`（当前不渲染，QwenPaw 无此字段）
8. **聊天按钮** — 28×28 白底圆角按钮，点击跳转 `/chat`
9. **卡片圆角** — 使用 `var(--sd-radius-card)` 即 20px
10. **选中态阴影** — 使用 `var(--sd-shadow-float)`
11. **操作区移入 DropdownMenu** — 用 Ant Design `<Dropdown>` 替代平铺按钮

**新增 Props**:
```typescript
interface AgentCardProps {
  agent: AgentSummary;
  stats?: { sessions: number; messages: number; lastActive: string };
  isSelected: boolean;
  onSelect: (agentId: string) => void;
  onEdit: (agent: AgentSummary) => void;
  onChat: (agentId: string) => void;
  onDelete: (agentId: string) => void;
  onToggle: (agentId: string, enabled: boolean) => void;
  onConfigurePersona?: (agent: AgentSummary) => void;
}
```

**样式参考**: 方案文档第 7.6 节有完整的 `.less` 代码

**注意**:
- 保留 `memo` 包裹
- 保留头像加载失败回退逻辑
- 保留 default 智能体的编辑/禁用/删除 disabled 逻辑
- DropdownMenu 中包含：编辑、配置人格（如有）、启用/禁用、删除

### 任务 2.3：更新 AgentsPage 调用

**修改文件**: `console/src/pages/Settings/Agents/index.tsx`

- 调用 `useAgentStatsBatch()` 获取统计
- 将 `stats` 和 `isSelected` 传给 `<AgentCard>`
- `onChat` 回调：`navigate('/chat')`
- `onSelect` 回调：`setSelectedAgent(agentId)`

### 阶段 2 完成标准
- [ ] `pnpm build` 编译通过
- [ ] 卡片视觉匹配方案文档第 2.1 节的 AFTER 效果
- [ ] 暗色模式正常
- [ ] 点击卡片打开 Drawer（功能不丢）
- [ ] DropdownMenu 中编辑/禁用/删除正常工作
- [ ] default 智能体保护逻辑正常

---

## 阶段 3：AgentsPage 改造（1-2 天）

### 任务 3.1：添加统计卡片区

**修改文件**: `console/src/pages/Settings/Agents/index.tsx` + `index.module.less`

在 PageHeader 和卡片网格之间插入 4 张统计卡：
- 员工总数 / 在线员工 / 离线员工 / 创建新员工（深底白字）
- 每张 100px 高，圆角 20px，浅灰底 `#f6f6f6`
- 第 4 张是创建入口，hover 出阴影

数据来源：`agents` 数组的 `filter(agent => agent.enabled)` 计算

### 任务 3.2：添加 UnderlineTabs 筛选

在统计卡片区下方添加 `<UnderlineTabs>`：
- items: 全部 / 启用 / 禁用（带计数）
- onChange 时过滤 `agents` 数组

### 任务 3.3：搜索框嵌入 Header

将搜索框改为白色胶囊样式（圆角 20px + `var(--sd-shadow-xs)`），嵌入 PageHeader 的 extra 区域。

### 任务 3.4：网格等高优化

**修改文件**: `console/src/pages/Settings/Agents/index.module.less`

```less
.agentsGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  auto-rows: minmax(262px, auto); /* 新增：保证等高 */
  gap: var(--sd-card-gap); /* 32px */

  @media (max-width: 768px) {
    gap: var(--sd-card-gap-mobile); /* 18px */
  }
}
```

### 任务 3.5：ViewToggle 右移

将卡片/列表视图切换按钮从 PageHeader extra 移到 UnderlineTabs 右侧（flex 布局，tabs 左、toggle 右）。

### 阶段 3 完成标准
- [ ] `pnpm build` 编译通过
- [ ] 统计卡片区显示正确，点击"创建新员工"打开创建 Modal
- [ ] UnderlineTabs 筛选正常，计数正确
- [ ] 搜索框样式匹配
- [ ] 卡片网格等高
- [ ] Card / List 双视图切换正常
- [ ] 拖拽排序（List 视图）不受影响

---

## 阶段 4：Workbench 聚合页面（3-5 天）

### 任务 4a：创建页面骨架 + 路由 + 菜单

**创建文件**:
- `console/src/pages/Workbench/index.tsx`
- `console/src/pages/Workbench/index.module.less`

**修改文件**:
- `console/src/layouts/registry/builtinRoutes.tsx` — 注册 `/workbench` 路由
- `console/src/layouts/registry/builtinMenu.ts` — 注册菜单项（见方案文档 7.2 / 7.3 节）

**WorkbenchPage 骨架**（见方案文档 7.4 节）:
- 使用 `useAgentStore()` 获取 `selectedAgent` 和 `agents`
- 5 个 Tab：工作记录 / 对话日志 / 定时任务 / 记忆 / 事件
- Tab 内容懒加载（`React.lazy` + `Suspense`）
- 无 agent 时显示空状态

### 任务 4b：实现 HeroSection

**创建文件**:
- `console/src/pages/Workbench/components/HeroSection.tsx`
- `console/src/pages/Workbench/components/HeroSection.module.less`

**规格**（见方案文档第 4.2 节）:
- 大头像 136×160px（hover 显示"更换头像"遮罩）
- 名称 22px semibold + default 徽章
- 状态行：在线/离线胶囊 + 创建者 + 入职时间
- 描述（2 行截断）
- 4 个 HeroMetric（资料数 / 技能数 / SOP数 / 定时任务数）— 数据来自各模块 API
- 操作按钮："去对话"（深底白字）+ "编辑资料"（描边）

**数据获取**:
- 头像/名称/描述：`agentStore`
- 技能数：`skillApi.listSkills(agentId)`
- 定时任务数：`api.listCronJobs({ agent_id: agentId })`
- 资料数/SOP数：读 workspace 文件列表

### 任务 4c：实现 OverviewTab

**创建文件**:
- `console/src/pages/Workbench/components/OverviewTab.tsx`
- `console/src/pages/Workbench/components/OverviewTab.module.less`

**内容**（见方案文档第 4.4 节）:
1. 4 个 ClickableMetric（今日对话/累计对话/好评率/差评率）
2. 简化版活动时间轴（仅日视图，3 种活动类型：对话蓝/定时任务橙/记忆新增绿）
3. 能力卡片网格（6 张，深浅交替）

**数据来源**:
- `api.getAgentStats()` — 对话统计
- `chatApi.listChats()` — 时间轴对话事件
- `api.listCronJobs()` — 时间轴任务事件 + 任务总数
- `api.listDailyMemory(agentId)` — 时间轴记忆事件 + 知识库统计
- `skillApi.listSkills()` — 技能数

**简化原则**: 时间轴用 Ant Design `Popover` 替代 HoverCard，每条轨道 26px 高，事件按 2 小时分桶。

### 任务 4d：从 SessionsPage 提取 SessionListContent

**先读**: `console/src/pages/Control/Sessions/index.tsx`（完整理解现有结构）

**创建文件**: `console/src/pages/Control/Sessions/SessionListContent.tsx`

**提取模式**（见方案文档 7.5 节）:
- Props: `agentId: string`, `showHeader?: boolean`
- 将 PageHeader 之外的渲染部分封装
- `useSessions` hook 改为接收 `agentId` 参数（若原 hook 不支持，适配之）
- 原页面 `SessionsPage` 改为：`<PageHeader /> + <SessionListContent agentId={selectedAgent} showHeader />`

**关键**: 不修改任何业务逻辑，只做结构提取。

### 任务 4e：从 CronJobsPage 提取 CronJobListContent

**先读**: `console/src/pages/Control/CronJobs/index.tsx`（966 行，较复杂）

**创建文件**: `console/src/pages/Control/CronJobs/CronJobListContent.tsx`

**提取范围**:
- 仅列表视图（不含日历视图）
- 包含 Table + 移动端 Card 列表
- 包含创建/编辑 JobDrawer
- 包含模板选择器
- 包含执行历史 Modal
- Props: `agentId: string`, `showHeader?: boolean`

**原页面保留**: 日历视图 + 视图切换 toggle 仍只在 CronJobsPage 中

### 任务 4f：从 MemoryPage 提取 MemoryExplorer

**先读**: `console/src/pages/Memory/index.tsx`（1001 行）

**创建文件**: `console/src/pages/Memory/MemoryExplorer.tsx`

**提取范围**:
- 文件树 + Markdown 编辑器 + 版本抽屉 + 搜索
- Props: `agentId: string`（不需要 ALL_AGENTS 模式和 Agent Select）

### 任务 4g：从 InboxPage 提取 MessageListContent

**先读**: `console/src/pages/Inbox/index.tsx`（1294 行）

**创建文件**: `console/src/pages/Inbox/MessageListContent.tsx`

**提取范围**:
- 仅消息 Tab 内容（不含审批 / 收获）
- PushMessageCard 列表 + 筛选 + 批量删除 + 消息详情 Modal
- Props: `agentId: string`

### 任务 4h：Tab 懒加载接入

在 WorkbenchPage 中用 `React.lazy` + `Suspense` 接入所有 Tab 内容。
Suspense fallback 使用骨架屏（非 Spin），避免闪烁。

### 阶段 4 完成标准
- [ ] `pnpm build` 编译通过
- [ ] `/workbench` 路由可访问
- [ ] 侧边栏出现"工作台"菜单项
- [ ] HeroSection 显示当前智能体信息
- [ ] 5 个 Tab 切换正常，内容懒加载
- [ ] **原页面功能回归**:
  - `/sessions` 页面功能不变
  - `/cron-jobs` 页面（含日历）功能不变
  - `/memory` 页面功能不变
  - `/inbox` 页面功能不变

---

## 阶段 5：打磨与测试（1-2 天）

### 检查清单

- [ ] 响应式：768px / 960px / 480px 断点验证
- [ ] 暗色模式：所有新增页面/组件在暗色下正常
- [ ] i18n：所有新增文案有中英文
- [ ] 性能：Tab 懒加载正常，统计缓存有效
- [ ] 原页面回归：
  - AgentsPage: 卡片视图 + 列表视图 + 拖拽排序 + 创建/编辑/删除/复制
  - SessionsPage: 列表 + 批量操作 + 归档 + 搜索
  - CronJobsPage: 列表 + 日历 + 创建/编辑 + 历史 + 模板
  - MemoryPage: 文件树 + 编辑器 + 版本 + 搜索 + ALL_AGENTS
  - InboxPage: 消息 + 审批 + 收获
- [ ] AgentDetailDrawer: basic / persona (visual+expert) / skills 三 Tab 不变
- [ ] default 智能体保护逻辑正常

---

## 关键文件索引

### 需要阅读的现有文件（执行前必读）

| 文件 | 用途 |
|------|------|
| `console/src/api/types/agents.ts` | AgentSummary 类型定义 |
| `console/src/api/types/agentStats.ts` | 统计数据类型 |
| `console/src/api/index.ts` | API 入口（找 getAgentStats 等） |
| `console/src/stores/agentStore.ts` | 智能体状态管理 |
| `console/src/layouts/registry/builtinRoutes.tsx` | 路由注册机制 |
| `console/src/layouts/registry/builtinMenu.ts` | 菜单注册机制 |
| `console/src/pages/Settings/Agents/index.tsx` | 智能体列表页（要改造） |
| `console/src/pages/Settings/Agents/components/AgentCard.tsx` | 智能体卡片（要改造） |
| `console/src/pages/Settings/Agents/components/AgentDetailDrawer.tsx` | 详情抽屉（不修改，确认保持不变） |
| `console/src/pages/Control/Sessions/index.tsx` | 会话页（要提取子组件） |
| `console/src/pages/Control/CronJobs/index.tsx` | 定时任务页（要提取子组件） |
| `console/src/pages/Memory/index.tsx` | 记忆页（要提取子组件） |
| `console/src/pages/Inbox/index.tsx` | 收件箱页（要提取子组件） |
| `console/src/components/PageHeader/index.tsx` | 页头组件（复用） |
| `console/src/utils/agentDisplayName.ts` | 智能体显示名工具 |
| `console/src/contexts/ThemeContext.tsx` | 暗色模式判断 |

### 可复用的现有组件/Hook

| 组件/Hook | 路径 | 用途 |
|-----------|------|------|
| `PageHeader` | `components/PageHeader/` | 统一页头 |
| `MarkdownCopy` | `components/MarkdownCopy/` | Markdown 编辑+复制 |
| `AgentStatusIndicator` | `components/AgentStatusIndicator/` | 启动状态指示 |
| `SummaryCard` | `pages/Settings/AgentStats/SummaryCard.tsx` | 统计数字卡片 |
| `useAppMessage` | `hooks/useAppMessage` | 统一消息提示 |
| `useTheme` | `contexts/ThemeContext.tsx` | 暗色模式判断 |
| `getAgentDisplayName` | `utils/agentDisplayName.ts` | 智能体显示名 |
| `providerIcon` | `pages/Settings/Models/components/providerIcon.ts` | 模型供应商图标 |

---

## 给 TRAE Work 的对话建议

在 QwenPaw 项目中打开 TRAE Work，按以下方式引用本文件：

> "请阅读 `workbench-execution-guide.md` 和 `workbench-refinement-plan.html`，从阶段 1 开始执行。每完成一个任务后告诉我，我会确认后你再进入下一个。"

或者分阶段执行：

> "请阅读 `workbench-execution-guide.md`，只执行阶段 1（设计令牌 + 基础组件），完成后暂停。"

**重要**: 如果 TRAE Work 在执行中发现 API 签名不匹配或类型冲突，让它先暂停并报告，你来确认后再继续。不要让它自行猜测 API 用法。
