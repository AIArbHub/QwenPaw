# AIArb 控制台全面升级开发说明

## 1. 项目概述

本次升级对 AIArb 控制台进行了全面改造，包括菜单结构调整、功能整合、新增功能、UI/UX 优化和数据持久化设计。

### 1.1 修改范围

#### 前端 (console/)
- `src/layouts/registry/builtinMenu.ts` - 菜单配置
- `src/layouts/registry/builtinRoutes.tsx` - 路由配置
- `src/pages/Memory/` - 记忆中心页面（恢复）
- `src/pages/Design/Skills/` - 统一技能页面
- `src/pages/KnowledgeDesk/` - 知识库 RAG 聚合页
- `src/pages/Moot/` - 增强模拟仲裁页面
- `src/pages/Cases/` - 增强案件管理页面
- `src/pages/EngineSettings/` - 文档引擎设置页面
- `src/api/modules/cases.ts` - 案件 API 接口定义
- `src/api/modules/moot.ts` - 模拟仲裁 API 接口扩展

#### 后端 (src/aiarb/)
- `cases/models.py` - 案件数据模型
- `cases/store.py` - 案件 SQLite 持久化存储
- `cases/__init__.py` - 模块导出

---

## 2. 菜单和路由调整

### 2.1 builtinMenu.ts 修改

**位置**: `console/src/layouts/registry/builtinMenu.ts`

**修改内容**:
1. 恢复记忆中心菜单项
2. 添加模拟仲裁和案件管理菜单项
3. 移除独立的技能池菜单项（已整合到技能页面）
4. 更新菜单图标

**关键代码**:
```typescript
{
  id: "core.memory", // 恢复
  location: "primary.arbitration",
  parentId: "core.tools-group",
  label: navLabel("nav.memory", "记忆中心"),
  icon: Brain,
  route: "core.memory",
  order: 60,
},
{
  id: "core.moot", // 新增
  location: "primary.arbitration",
  parentId: "core.tools-group",
  label: navLabel("nav.moot", "模拟仲裁"),
  icon: Gavel,
  route: "core.moot",
  order: 40,
},
{
  id: "core.cases", // 新增
  location: "primary.arbitration",
  parentId: "core.tools-group",
  label: navLabel("nav.cases", "案件管理"),
  icon: FolderKanban,
  route: "core.cases",
  order: 50,
},
```

### 2.2 builtinRoutes.tsx 修改

**位置**: `console/src/layouts/registry/builtinRoutes.tsx`

**修改内容**:
1. 使用 `UnifiedSkillsPage` 替代独立的 Skills 和 SkillPool 页面
2. 添加 `/skill-pool` 到 `/skills?tab=pool` 的重定向

**关键代码**:
```typescript
// Unified skills page (tabs: skills / skill-pool / market)
const UnifiedSkillsPage = lazyImportWithRetry("../../pages/Design/Skills");

{ id: "core.skills", path: "/skills", component: UnifiedSkillsPage },
{
  id: "core.skill-pool",
  path: "/skill-pool",
  component: () => <Navigate to="/skills?tab=pool" replace />,
},
```

---

## 3. 前端页面修改详解

### 3.1 Moot 页面增强

**文件**: `console/src/pages/Moot/index.tsx`

**新增功能**:
1. 视角选择器 (`viewPerspective` state)
2. 策略分析按钮和 Drawer (`handleAnalyzeStrategy`, `strategyAnalysis` state)
3. 案件导入按钮和 Modal (`handleOpenImport`, `importableCases` state)

**关键改动**:
- 添加 `Drawer`, `Alert` 导入
- 添加策略分析类型导入 (`StrategyAnalysis`, `ViewPerspective` 等)
- 新增策略分析 Drawer UI，包含胜率预测（环形图）、策略列表、AI 建议
- 新增案件导入 Modal，显示可导入案件列表

**注意事项**:
- 确保所有 UI 组件正确导入
- 策略分析 Drawer 使用 conic-gradient 渐变实现环形图

### 3.2 Cases 页面增强

**文件**: `console/src/pages/Cases/index.tsx`

**新增功能**:
1. 案件结构化信息编辑 (Structured Info)
2. 材料分区筛选 (Material Zone Filter)
3. 文件标签编辑 (File Tag Editor)
4. AI 整理文件 (AI Organize)
5. 内部 AI 聊天 (Internal AI Chat)
6. 本地文件夹扫描 (Scan Folder)

**关键改动**:
- 新增 6 个 state: `zoneFilter`, `tagEditingFile`, `structuredInfo`, `organizeModalOpen`, `aiMessages`, `scanModalOpen`
- 新增 7 个 Modal/Drawer:
  - 文件标签编辑 Modal
  - 结构化信息编辑 Modal
  - AI 整理 Modal
  - 扫描文件夹 Modal
  - AI 聊天 tab 在详情 Drawer 内
- 材料分区使用颜色标签筛选: `MATERIAL_ZONE_COLORS`
- AI 聊天面板包含全能视角说明、消息列表、输入框、生成文档开关

**CSS 文件**: `console/src/pages/Cases/index.module.less`
- 新增 `.zoneFilter`, `.zoneTag`, `.aiChatPanel` 等样式类
- 新增 `.structuredInfoForm`, `.partyFormItem` 等表单样式
- 新增 `.organizeResult`, `.scanResult` 等结果展示样式

### 3.3 EngineSettings 页面增强

**文件**: `console/src/pages/EngineSettings/index.tsx`

**新增功能**:
1. 引擎就绪度 Banner (Engine Readiness Banner)
2. 可视化引擎状态卡片 (Visual Engine Status Cards)
3. 一键安装引导 (One-click Installation Guides)
4. 配置 Drawer (Configuration Drawer)
5. 处理历史记录 (Processing History)

**关键改动**:
- 新增 `installDrawerOpen`, `configDrawerOpen`, `historyDrawerOpen`, `previewDrawerOpen` state
- 新增 `engineReadiness` 计算逻辑（各引擎状态加权）
- 新增 `INSTALL_GUIDES` 常量（MinerU、Tesseract、本地模型安装步骤）
- 使用 `Progress` 组件环形图展示就绪度
- 使用 `Steps` 组件展示安装步骤
- 使用 `Timeline` 展示处理历史

**UI 设计**:
- Banner 使用渐变背景
- 卡片使用颜色编码状态
- 抽屉和模态框提供详细配置

---

## 4. API 接口定义

### 4.1 案件 API (cases.ts)

**文件**: `console/src/api/modules/cases.ts`

**新增类型**:
```typescript
export type MaterialZone = "shared" | "claimant" | "respondent" | "arbitrator" | "secretary";
export interface CaseStructuredInfo { ... };
export interface FileTag { ... };
export interface AIOrganizeResult { ... };
export interface CaseAIChatMessage { ... };
```

**新增 API 方法**:
```typescript
casesApi.updateStructuredInfo(caseId, info)
casesApi.updateFileTag(caseId, filePath, params)
casesApi.batchUpdateFileTags(caseId, updates)
casesApi.aiOrganize(caseId, params)
casesApi.caseAIChat(caseId, messages, params)
casesApi.scanFolder(folderPath, params)
```

### 4.2 模拟仲裁 API (moot.ts)

**文件**: `console/src/api/modules/moot.ts`

**新增类型**:
```typescript
export type ViewPerspective = "god" | "claimant" | "respondent" | "arbitrator" | "secretary";
export interface StrategyAnalysis { ... };
export interface CaseImportParams { ... };
```

**新增 API 方法**:
```typescript
strategyApi.analyzeStrategy(caseId, perspective)
strategyApi.importFromCase(caseId, params)
strategyApi.listCasesForImport()
```

---

## 5. 后端 SQLite 持久化层

### 5.1 CasesStore 设计

**文件**: `src/aiarb/cases/store.py`

**设计原则**:
- 全局单例模式
- 线程锁保护并发访问
- WAL 模式支持并发读写
- 外键约束确保数据一致性

**数据库架构**:
```
case_structured_info        -- 案件结构化信息
  ├─ case_parties          -- 当事人信息
case_file_tags             -- 文件标签（分区、分类、自定义标签）
case_ai_organize_results   -- AI 整理结果
case_ai_chat_messages      -- AI 聊天历史
engine_config              -- 引擎配置
processing_history         -- 处理历史记录
case_scan_results          -- 扫描结果
```

**关键方法**:
```python
# 结构化信息
def get_structured_info(case_id)
def upsert_structured_info(case_id, info)

# 文件标签
def get_file_tags(case_id)
def get_file_tag(case_id, file_path)
def upsert_file_tag(case_id, file_path, params)
def batch_upsert_file_tags(case_id, updates)

# AI 整理
def save_organize_result(case_id, result)
def get_latest_organize_result(case_id)

# AI 聊天
def save_chat_message(case_id, role, content, documents)
def get_chat_history(case_id, limit=50)

# 引擎配置
def get_engine_config(key)
def set_engine_config(key, value)

# 处理历史
def add_processing_record(record)
def get_processing_history(limit=20)
```

### 5.2 数据模型 (models.py)

**文件**: `src/aiarb/cases/models.py`

**新增模型**:
```python
class CaseStructuredInfo(BaseModel): ...
class CaseParty(BaseModel): ...
class FileTag(BaseModel): ...
class AIOrganizeResult(BaseModel): ...
class CaseAIChatMessage(BaseModel): ...
class ProcessingRecord(BaseModel): ...
```

---

## 6. 安装和运行

### 6.1 前端
```bash
cd console
npm install
npm run dev
```

### 6.2 后端
```bash
# 安装依赖
pip install -r requirements.txt

# 启动服务
python -m src.aiarb.main
```

### 6.3 数据库初始化
SQLite 数据库会在首次运行时自动创建，无需手动初始化。

---

## 7. 调试和测试

### 7.1 前端调试
- 使用 Chrome DevTools
- 检查 Network 面板查看 API 请求
- 使用 Console 查看日志

### 7.2 后端调试
- 查看 `~/.aiarb/` 目录下的日志文件
- 检查 SQLite 数据库内容
- 使用 `print` 或 `logger.debug` 输出调试信息

---

## 8. 已知问题和限制

1. ** MinerU 安装**: 可能受网络限制，建议使用镜像源
2. **本地模型**: 需要较高硬件配置（建议 8GB+ RAM）
3. **SQLite 并发**: 高并发场景下性能可能受限
4. **文件上传**: 大文件上传需要分片支持

---

## 9. 扩展指南

### 9.1 添加新的材料分区
1. 修改 `cases.ts` 中的 `MaterialZone` 类型
2. 更新 `MATERIAL_ZONE_LABELS` 和 `MATERIAL_ZONE_COLORS`
3. 修改 `cases/store.py` 的 schema（如需要）

### 9.2 添加新的文件分类
1. 修改 `Cases/index.tsx` 中的 `FILE_CATEGORIES` 数组
2. 更新 API 类型定义

### 9.3 添加新的 AI 策略分析维度
1. 修改 `moot.ts` 中的 `StrategyAnalysis` 接口
2. 更新后端分析逻辑
3. 更新前端 Drawer 展示逻辑

---

## 10. 文档参考

- PRD 文档: `docs/PRD_AIArb_Consolidation.md`
- API 接口文档: 参见各 `api/modules/*.ts` 文件
- 模型定义: 参见 `src/aiarb/**/models.py` 文件

---

**版本**: v1.0
**最后更新**: 2024年
**维护者**: AIArb 团队