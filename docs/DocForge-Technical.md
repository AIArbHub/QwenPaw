# 文档工坊（DocForge）技术说明文档

> 版本：v2.0 | 更新日期：2026-07-12

---

## 1. 改动概览

本次改动围绕"文档智能"功能重构，核心变更：

1. **命名统一**：`desensitize` → `docforge`，页面标题统一为"文档工坊"
2. **安全配置面板**：新增安全度可视化配置，每个环节明确数据流向
3. **页面标题更新**：材料库、知识卡片、案件卷宗
4. **路由更新**：`/desensitize` → `/docforge`

---

## 2. 文件变更清单

### 2.1 路由与菜单

| 文件 | 变更 |
|------|------|
| `console/src/layouts/registry/builtinRoutes.tsx` | 路由ID `core.desensitize` → `core.docforge`，路径 `/desensitize` → `/docforge` |
| `console/src/layouts/registry/builtinMenu.ts` | 菜单ID/路由/标签更新，Knowledge标签→"材料库"，Wiki标签→"知识卡片" |

### 2.2 页面组件

| 文件 | 变更 |
|------|------|
| `console/src/pages/Desensitize/index.tsx` | 组件名 `DesensitizePage` → `DocForgePage`，i18n命名空间 `desensitize` → `docforge`，新增安全配置面板（4项配置），解析工作区新增安全标识栏，新增代号映射表Tab |
| `console/src/pages/Desensitize/index.module.less` | 新增 `.securityPanel*`、`.parseSecurityBar*`、`.codenameMapTab`、`.codenameMapHeader` 样式 |
| `console/src/pages/Desensitize/storage.ts` | IndexedDB名称 `aiarb_desensitize` → `aiarb_docforge`，新增 `migrateOldDB()` 迁移函数 |
| `console/src/pages/Knowledge/index.tsx` | 页面标题 "AI资料中心" → "材料库"，新增版本标记（原版/脱敏版Tag+关联版本），新增AI使用偏好选择器，文件列表中脱敏版文件名旁显示Tag |
| `console/src/pages/Wiki/index.tsx` | 页面标题 "AI裁判智库" → "知识卡片" |
| `console/src/pages/Cases/index.tsx` | 页面标题 "案件档案" → "案件卷宗"，新增AI使用偏好设置行 |

### 2.3 国际化

| 文件 | 变更 |
|------|------|
| `console/src/locales/zh.json` | 新增 `docforge` 命名空间（含安全配置、代号映射、AI验证相关文本），更新nav标签 |

### 2.4 类型与数据

| 文件 | 变更 |
|------|------|
| `console/src/api/types/backup.ts` | `desensitizeTasks` → `docforgeTasks`，`desensitizeParseTasks` → `docforgeParseTasks` |
| `console/src/api/modules/knowledge.ts` | KnowledgeDoc新增 `version_type`/`original_doc_id`/`desensitized_doc_id`/`codename_map_id` 字段，新增代号映射表API（5个接口），新增AI使用偏好API（2个接口），新增 `CodenameEntry` 类型 |
| `console/src/pages/Settings/Backups/shared/browserDataCollector.ts` | 变量名同步更新 |

### 2.5 样式

| 文件 | 变更 |
|------|------|
| `console/src/layouts/index.module.less` | 注释更新 |

---

## 3. 安全配置面板技术实现

### 3.1 状态管理

安全配置面板依赖两个已有状态变量：

```typescript
const [selectedMode, setSelectedMode] = useState<DesensitizeMode>("local_ai");
const [selectedParseMode, setSelectedParseMode] = useState<ParseMode>("auto");
```

### 3.2 安全概览计算逻辑

```typescript
// 安全概览标签逻辑
if (selectedMode === "local" && selectedParseMode === "local_only") {
  // 🟢 全程本地处理，数据零外传
} else if (selectedMode === "ai" || selectedParseMode === "cloud_ocr") {
  // 🔴 原始敏感数据将经云端，请确认授权
} else {
  // 🟡 部分环节使用云端，请注意隐私政策
}
```

### 3.3 安全级别颜色编码

| 级别 | 颜色 | Tag color | 含义 |
|------|------|-----------|------|
| 🟢 安全 | 绿色 | green | 数据全程本地，零外传 |
| 🟡 注意 | 黄色 | warning | 部分环节使用云端 |
| 🔴 高风险 | 红色 | red | 原始敏感数据经云端 |

---

## 4. i18n 新增 Key

`docforge` 命名空间新增以下 Key：

| Key | 中文 | 用途 |
|-----|------|------|
| securityLevelLocal | 🟢 全程本地 | 安全级别标签 |
| securityLevelCloud | 🟡 含云端处理 | 安全级别标签 |
| securityLevelHighRisk | 🔴 原始数据经云端 | 安全级别标签 |
| securityConfigTitle | 安全配置 | 面板标题 |
| securityParseEngine | 解析引擎 | 配置项标签 |
| securityParseLocal | 🟢 本地优先 | 解析引擎选项 |
| securityParseCloud | 🟡 云端OCR | 解析引擎选项 |
| securityParseLocalOnly | 🟢 仅本地 | 解析引擎选项 |
| securityDesensMode | 脱敏模式 | 配置项标签 |
| securityDesensRules | 🟢 规则脱敏 | 脱敏模式选项 |
| securityDesensRulesAI | 🟡 规则+AI辅助 | 脱敏模式选项 |
| securityDesensRulesAILocal | 🟢 规则+本地AI | 脱敏模式选项 |
| securitySummaryTitle | 当前安全概览 | 概览标题 |
| securitySummaryAllLocal | 🟢 全程本地处理，数据零外传 | 概览文案 |
| securitySummaryPartialCloud | 🟡 部分环节使用云端，请注意隐私政策 | 概览文案 |
| securitySummaryHighRisk | 🔴 原始敏感数据将经云端，请确认授权 | 概览文案 |

---

## 5. 待实施功能

### 5.1 代号策略 UI（✅ 已实现）

已在安全配置面板中新增代号策略选项：

```typescript
type CodenameStrategy = "global" | "doc_level";
const [codenameStrategy, setCodenameStrategy] = useState<CodenameStrategy>("global");
```

选项：
- 🟢 全局一致：同一主体跨材料统一代号
- 文档独立：每份材料独立编号

### 5.2 AI验证配置（✅ 已实现）

已在安全配置面板中新增AI验证选项：

```typescript
type AIValidation = "off" | "local" | "cloud";
const [aiValidation, setAiValidation] = useState<AIValidation>("off");
```

选项：
- 关闭：不进行AI验证，仅依赖规则
- 🟢 本地AI验证：本地AI检查脱敏文本是否有遗漏
- 🟡 云端AI验证：发送脱敏文本至云端检查遗漏

安全概览逻辑已更新：AI验证选择"云端"时，安全标签升级为🔴高风险。

### 5.3 路由重定向（✅ 已实现）

旧路由 `/desensitize` 自动重定向到 `/docforge`：

```typescript
{
  id: "core.desensitize-redirect",
  path: "/desensitize",
  component: () => <Navigate to="/docforge" replace />,
}
```

### 5.4 IndexedDB迁移（✅ 已实现）

数据库从 `aiarb_desensitize` 迁移到 `aiarb_docforge`：

- storage.ts 中添加 `migrateOldDB()` 函数
- 自动检测旧数据库，复制数据到新数据库后删除旧数据库
- 模块加载时自动执行迁移

### 5.5 材料版本管理（✅ 已实现）

在材料库（Knowledge）页面中实现：

**KnowledgeDoc 类型扩展**：
```typescript
export interface KnowledgeDoc {
  // ... 原有字段
  version_type?: "original" | "desensitized";
  original_doc_id?: string;
  desensitized_doc_id?: string;
  codename_map_id?: string;
}
```

**UI 实现**：
- 文档详情"基本信息"Tab中，脱敏字段显示为 Tag 标签（✓ 已脱敏 / ✗ 未脱敏 + 原版/脱敏版）
- 新增"关联版本"字段，显示原版文档和脱敏版本的链接
- 文件列表中，脱敏版文件名旁显示绿色"脱敏版"Tag

### 5.6 代号映射表（✅ 已实现）

**API 接口**（knowledge.ts）：

| 接口 | 方法 | 说明 |
|------|------|------|
| `/knowledge/codename-map` | GET | 获取代号映射表 |
| `/knowledge/codename-map` | POST | 创建代号映射表 |
| `/knowledge/codename-map/:id` | PUT | 更新代号映射表 |
| `/knowledge/codename-map/:id` | DELETE | 删除代号映射表 |
| `/knowledge/codename-map/merge` | POST | 合并代号条目（处理冲突） |

**CodenameEntry 类型**：
```typescript
export interface CodenameEntry {
  original: string;       // 原始信息
  codename: string;       // 代号
  entity_type: string;    // 实体类型（person/company/id_card/phone/address/bank_account/other）
  context: string;        // 上下文描述
  doc_ids: string[];      // 涉及的材料ID
  aliases: string[];      // 别名/别称
}
```

**UI 实现**（文档工坊"代号映射表"Tab）：
- 顶部：代号策略选择（全局一致/文档独立）+ 新建映射表按钮
- 全局一致模式下显示说明 Alert
- 表格列：原始信息、代号、实体类型、别名/别称、涉及材料、操作
- 实体类型使用不同颜色 Tag 区分
- 全局一致模式下显示"称呼一致性检查"警告，列出同一主体的不同称呼
- 支持编辑代号

**称呼一致性处理**：
- 同一主体在不同材料中的称呼不一致时（如"A公司"vs"申请人"），在aliases中记录
- 全局模式下，所有别称映射到同一代号
- 相对性称呼（如反请求中的"反请求申请人"）通过context字段区分

### 5.7 AI使用时材料版本选择（✅ 已实现）

**API 接口**（knowledge.ts）：

| 接口 | 方法 | 说明 |
|------|------|------|
| `/knowledge/ai-use-preference` | PUT | 设置AI使用偏好 |
| `/knowledge/ai-use-preference` | POST | 获取AI使用偏好 |

**偏好选项**：
| 选项 | 说明 |
|------|------|
| 🟢 脱敏版 | AI默认使用脱敏版材料（安全优先） |
| 🔴 原版 | AI默认使用原版材料（需确认安全提示） |
| ❓ 每次询问 | AI使用前询问用户选择 |

**作用域**：
| scope | 说明 | UI位置 |
|-------|------|--------|
| global | 全局默认 | 材料库页面文件夹信息栏 |
| case | 案件级别 | 案件卷宗详情抽屉 |
| doc | 文档级别 | 文档详情（预留） |

**UI 实现**：
- 材料库页面：文件夹信息栏右侧添加"AI使用"偏好选择器
- 案件卷宗页面：案件详情Descriptions中添加"AI使用偏好"行
- 选择后自动调用API保存，显示成功提示

### 5.8 文件夹重命名

`console/src/pages/Desensitize/` 文件夹应重命名为 `DocForge/`，因IDE锁定暂未完成。重命名后需同步更新：
- `builtinRoutes.tsx` 中的 lazy import 路径
- 其他引用该路径的文件

---

## 6. 向后兼容

### 6.1 IndexedDB 数据迁移（✅ 已实现）

数据库从 `aiarb_desensitize` 更名为 `aiarb_docforge`，已在 storage.ts 中实现自动迁移：

```typescript
async function migrateOldDB(): Promise<void> {
  // 检查旧DB是否存在，若存在则复制数据到新DB并删除旧DB
  // 模块加载时自动执行
}
migrateOldDB();
```

### 6.2 路由重定向（✅ 已实现）

旧路由 `/desensitize` 已自动重定向到 `/docforge`：

```typescript
{ id: "core.desensitize-redirect", path: "/desensitize", component: () => <Navigate to="/docforge" replace /> }
```

### 6.3 i18n 兼容（✅ 已实现）

保留 `desensitize` 命名空间的内容不删除，确保旧代码引用仍可用。新增 `docforge` 命名空间作为主命名空间。

---

## 7. 测试要点

1. **安全配置面板**：验证各选项组合的安全概览标签正确性
2. **路由**：验证 `/docforge` 可正常访问，旧 `/desensitize` 需重定向
3. **i18n**：验证所有新增Key在中文环境下正确显示
4. **数据持久化**：验证IndexedDB新名称下任务可正常保存和读取
5. **备份恢复**：验证备份中 `docforgeTasks` 字段可正常导入导出