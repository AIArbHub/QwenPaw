# 记忆中心上传按钮 + 知识库左侧日期文件列表

## Context

用户提出两个诉求：
1. **记忆中心**（`/memory`）：左侧「文件列表」面板目前只有日期分组树，没有「上传文件」按钮，需补充。
2. **知识库**（`/knowledge`）：左侧没有像记忆中心那样按日期（年/月/日）分组的文件列表，需补齐，并镜像记忆中心的交互（文件列表 + 上传按钮 + 点击文件在右侧编辑器打开）。

背景事实（已探明）：
- 记忆中心左侧树由页面自身构建（[Memory/index.tsx](file:///d:/Project/QwenPaw/console/src/pages/Memory/index.tsx)），右侧 `FilesWorkspace`（`initialSource="daily"` + `hideSourceTabs`）。
- 知识库页面目前是「搜索 + 全宽 `FilesWorkspace`」，无页面级左侧树；右侧 `FilesWorkspace` 自带导航器。
- `/knowledge/tree` 返回的文件条目只有 `name/path/size`，**无修改时间**，无法按日期分组 → 需后端补 `modified_time`。
- `/workspace/file-upload` 后端通过 `get_agent_for_request()` 读取 `X-Agent-Id` 头来限定智能体工作区；前端 `workspaceApi.uploadFiles` 目前**不传**该头 → 需扩展。
- i18n：`files.upload`（"上传文件"）已存在于各语言文件，可复用。

## 变更方案

### 1. 后端：`/knowledge/tree` 补充 modified_time

文件：`src/aiarb/app/routers/knowledge.py`
- 在 `_walk_files()` 的每个文件条目中增加 `"modified_time": datetime.fromtimestamp(entry.stat().st_mtime, tz=timezone.utc).isoformat()`，格式与记忆文件的 `_memory_file_info`（agent_md_manager.py L201-L220）保持一致。
- 补充导入：`from datetime import datetime, timezone`。
- 向后兼容：新增字段不破坏现有调用方。

### 2. 前端 API 层

- `console/src/api/modules/knowledge.ts`：`KnowledgeFile` 接口增加 `modified_time?: string`。
- `console/src/api/modules/workspace.ts`：`uploadFiles` 增加可选参数 `agentId?: string`，传入时向 headers 合并 `{ "X-Agent-Id": agentId }`（现有调用方不受影响，后端 `get_agent_for_request` 会据此定位智能体工作区）。

### 3. 记忆中心：左侧面板加「上传文件」按钮

文件：`console/src/pages/Memory/index.tsx` + `index.module.less`
- 顶部工具栏（`treeHeader`）右侧改为一个分组容器：`上传`按钮（antd `Upload`，`showUploadList={false}`、`beforeUpload={() => false}`、`multiple`）+ 现有数量 `Tag`。
- 新增 `uploading` 状态与 `handleUpload(files)`：
  - 目标智能体：`editorAgentId`（始终是具体 id；「全部智能体」模式下也落到当前编辑器绑定智能体）。
  - 调用 `workspaceApi.uploadFiles(files, "", undefined, undefined, "project", undefined, editorAgentId)`，成功后 `message.success` 并 `await fetchAll()` 刷新列表；失败 `message.error`。
- CSS：`index.module.less` 新增 `.treeHeaderRight { display:flex; align-items:center; gap:8px; }`。
- 说明：上传的文件进入该智能体的工作区根目录（与全应用现有上传语义一致），可在该智能体右侧文件导航器/文件视图使用。

### 4. 知识库：左侧新增日期分组文件列表（镜像记忆中心）

文件：`console/src/pages/KnowledgeBase/index.tsx` + `index.module.less`

JSX 结构调整为与记忆中心一致的 `mainLayout`（左树 + 右编辑器）：
```
<div className={styles.mainLayout}>
  <div className={styles.treePanel}> … 日期分组树 + 上传按钮 … </div>
  <div className={styles.editorPanel}>
    <FilesWorkspace key={`kb:${editorAgentId}:${refreshKey}`} … initialTarget={initialTarget} />
  </div>
</div>
```

左侧面板逻辑（页面内自包含，镜像记忆中心写法）：
- 数据：`knowledgeApi.tree()` → `files`（含新 `modified_time`）。
- 分组：本地 `getDateParts()`（复制记忆中心 6 行工具函数）→ 年 → 月 → 日 → 叶子，未知日期归入 `unknown` 组；叶子展示相对路径（mono 字体 + tooltip 全路径 + 大小）。
- 交互：
  - 点击叶子 → `setInitialTarget({ source: "knowledge", path })`（复用现有打开机制，右侧编辑器打开）。
  - `treeHeader` 上传按钮（antd `Upload`，同记忆中心）→ `knowledgeApi.upload(file)` 逐个上传到知识库可编辑根 → 成功后刷新 `kbFiles`。
  - 首次展开默认展开年/月第一层（镜像记忆中心 `expandedKeys` 逻辑）。
- i18n：新增 `knowledge.fileList`（"文件列表"）、`knowledge.noFiles`（"暂无知识文件"）到 `zh.json`、`en.json`（其余语言走内联 fallback，与代码库惯例一致）；上传按钮标题复用 `files.upload`；成功/失败消息用内联 fallback。

CSS（`KnowledgeBase/index.module.less`）：
- 新增 `.mainLayout`（flex row，gap 8px）、`.treePanel`（宽 300px，同记忆中心）、`.treeHeader`、`.treeHeaderTitle`、`.treeBody`、`dateNodeTitle`、`fileNode/fileInfo/fileIcon/fileName/fileSize`、`.editorPanel`（flex:1）、空态样式，样式值从记忆中心 `index.module.less` 对应类目复制（共用 `--files-*` CSS 变量，深色模式自动适配）。
- 保留现有 `.searchSection`/`.workspace` 相关样式（`.workspace` 类可继续用于编辑器容器或直接替换为 `.editorPanel`）。

## 不改动 / 风险控制

- 记忆中心左侧树的既有结构（概览 / 每日记忆 / 长期知识 + 全部智能体模式 agent 标签）保持不动，只加按钮，避免回归。
- 知识库左列表为日期扁平视图（跨分类），与记忆中心「每日记忆」视图一致；分类层级仍由右侧 `FilesWorkspace` 导航器提供。

## 验证

1. 后端重启后：`GET /api/knowledge/tree` 返回条目含 `modified_time`（UTC ISO）。
2. 前端 `localhost:5173/knowledge`：
   - 左侧出现「文件列表」面板，文件按 年/月/日 分组；
   - 点击文件 → 右侧编辑器打开对应知识文件；
   - 点击上传按钮选文件 → 上传成功、列表刷新出现新文件。
3. 前端 `localhost:5173/memory`：
   - 左侧面板头部出现上传按钮；上传后文件进入所选智能体工作区，列表刷新、无报错。
4. 现有页面回归：`/knowledge` 搜索、AI 整理入口、右侧导航器不受影响；`/memory` 搜索、重建索引、概览/每日/长期分组不受影响。
