# AIArb 文档架构开发说明

## 一、架构总览

AIArb 采用四层文档架构，每层有独立的存储位置和生命周期：

```
.aiarb/                          ← 工作区根目录（优先于 .aiarb / .copaw）
├── knowledge/                   ← 知识库（全局 + 智能体私有）
│   ├── _meta.json               ← 文档元数据索引
│   ├── _enums.json              ← 分类/归属/标签枚举
│   ├── _desensitized/           ← 脱敏后 Markdown
│   │   └── {doc_id}.md
│   ├── _backfill/               ← 脱敏映射（加密存储）
│   │   └── {doc_id}.enc
│   ├── _parsed/                 ← 原始解析 Markdown
│   │   └── {doc_id}.md
│   ├── _desensitize_rules.json  ← 自定义脱敏规则（可选）
│   └── {doc_id}/                ← 原始文件存储
│       └── {filename}
├── cases/                       ← 案件卷宗（外部引用模式）
│   └── {agent_id}/
│       └── {case_id}/
│           ├── _ref.json        ← 外部引用记录
│           ├── _parsed/         ← 解析结果缓存
│           ├── _desensitized/   ← 脱敏结果缓存
│           └── _backfill/       ← 回填映射
├── wiki/                        ← Wiki 知识编译
│   └── pages/
│       ├── concept/             ← 概念页
│       ├── case/                ← 案例页
│       ├── comparison/          ← 对比页
│       └── comprehensive/       ← 综合页
├── agents/                      ← 智能体文档
│   └── {agent_id}/
│       ├── soul/
│       ├── memory/
│       └── skills/
└── output/                      ← 输出文档
    └── {agent_id}/
```

## 二、核心模块

### 2.1 文档解析引擎

**文件位置：** `src/aiarb/parsers/`

| 文件 | 职责 |
|------|------|
| `markitdown_parser.py` | 原生文档主解析（docx/xlsx/pptx/pdf等） |
| `mineru_parser.py` | 云端OCR解析（扫描件/图片），需配置API Key |
| `docling_parser.py` | 降级兜底解析器 |
| `router.py` | 解析路由中枢，自动选择解析器并降级 |

**路由逻辑：**
1. 原生文档 → MarkItDown → 结果 ≥ 50字符 → 返回
2. MarkItDown 结果 < 50字符 → 尝试 Docling → 返回
3. 扫描件/图片 → MinerU API → 返回
4. 全部失败 → 返回 `[Cannot parse: filename]`

### 2.2 脱敏处理管线

**文件位置：** `src/aiarb/knowledge/`

处理流程：`原始文件 → 解析为Markdown → 本地正则脱敏 → LLM二次脱敏 → 存储脱敏文本 + 回填映射`

| 文件 | 职责 |
|------|------|
| `desensitize.py` | 本地正则脱敏引擎，含默认规则（身份证/手机号/银行卡等） |
| `desensitize_llm.py` | LLM二次脱敏，处理正则遗漏的敏感信息 |
| `backfill.py` | 回填映射管理，XOR加密存储，支持还原 |

**默认脱敏规则：**

| 规则名 | 正则 | 占位符 |
|--------|------|--------|
| id_card | `[1-9]\d{5}(?:19\|20)\d{2}...` | `ID_{seq:03d}` |
| phone | `1[3-9]\d{9}` | `PHONE_{seq:03d}` |
| bank_card | `[1-9]\d{14,18}` | `BANK_{seq:03d}` |
| email | 标准邮箱正则 | `EMAIL_{seq:03d}` |
| address | 地址模式 | `ADDR_{seq:03d}` |

**自定义规则：** 用户可在设置页面添加/编辑/删除规则，存储在 `_desensitize_rules.json`。

**回填映射加密：**
- 使用 XOR + PBKDF2 加密
- 密钥来源：环境变量 `AIARB_BACKFILL_KEY`，默认 `aiarb_default_backfill_key`
- 文件格式：`{doc_id}.enc`（加密）或 `{doc_id}.json`（明文）

### 2.3 Wiki 知识编译引擎

**文件位置：** `src/aiarb/wiki/engine.py`

融合 Karpathy LLM Wiki 理念，实现四种操作：

| 操作 | 说明 | API端点 |
|------|------|---------|
| Ingest | 将原始文档编译为结构化Wiki页面 | `POST /wiki/ingest` |
| Query | 检索Wiki页面（优先于原始文档） | `GET /wiki/pages` |
| Lint | 检查Wiki页面质量，可选自动修复 | `POST /wiki/lint` |
| Future | 生成预测QA，预判用户可能的问题 | `POST /wiki/future` |

**页面类型：**
- `concept` — 概念页：解释核心概念
- `case` — 案例页：典型案例分析
- `comparison` — 对比页：概念/方案对比
- `comprehensive` — 综合页：跨文档知识整合

### 2.4 案件卷宗外部引用

**文件位置：** `src/aiarb/cases/`

核心设计：**引用不复制**。通过 `_ref.json` 记录外部文件夹路径，仅缓存解析结果。

```json
// _ref.json 示例
{
  "case_id": "2024-001",
  "source_path": "D:\\案件\\2024-001",
  "scan_mode": "auto",
  "files": [
    {
      "file_name": "起诉状.docx",
      "file_path": "D:\\案件\\2024-001\\起诉状.docx",
      "file_type": "docx",
      "size": 45678,
      "status": "parsed",
      "parsed_path": "_parsed/___起诉状.docx.md"
    }
  ]
}
```

### 2.5 多维筛选体系

知识库文档支持三种维度筛选：

| 维度 | 类型 | 层级支持 | 说明 |
|------|------|----------|------|
| `category` | 单选 | ✅ 用 `/` 表示层级 | 如 `法律/合同法/买卖合同` |
| `owner` | 单选 | ✅ 用 `/` 表示层级 | 如 `机构/律所A/团队B` |
| `tags` | 多选 | ❌ 扁平 | 如 `重要`, `已审核` |

## 三、API 端点一览

### 3.1 知识库 `/knowledge`

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/knowledge/docs` | 列出文档（支持筛选） |
| POST | `/knowledge/upload` | 上传文档 |
| DELETE | `/knowledge/docs/{doc_id}` | 删除文档 |
| PUT | `/knowledge/docs/{doc_id}` | 更新文档元数据 |
| GET | `/knowledge/enums` | 获取分类枚举 |
| POST | `/knowledge/enums` | 创建分类枚举 |
| DELETE | `/knowledge/enums/{field}/{value}` | 删除分类枚举 |
| POST | `/knowledge/parse` | 批量解析文档 |
| POST | `/knowledge/desensitize` | 批量本地脱敏 |
| POST | `/knowledge/desensitize-llm` | 批量LLM脱敏 |
| GET | `/knowledge/docs/{doc_id}/parsed` | 获取解析文本 |
| GET | `/knowledge/docs/{doc_id}/desensitized` | 获取脱敏文本 |
| POST | `/knowledge/docs/{doc_id}/restore` | 还原脱敏文本 |
| GET | `/knowledge/desensitize-rules` | 获取脱敏规则 |
| PUT | `/knowledge/desensitize-rules` | 更新脱敏规则 |
| POST | `/knowledge/desensitize-rules/reset` | 重置为默认规则 |
| POST | `/knowledge/export` | 导出文档（支持还原） |

### 3.2 案件卷宗 `/cases`

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/cases/add` | 添加案件（外部引用） |
| GET | `/cases/list` | 列出案件 |
| GET | `/cases/{case_id}` | 获取案件详情 |
| DELETE | `/cases/{case_id}` | 删除案件 |
| POST | `/cases/{case_id}/rescan` | 重新扫描 |
| POST | `/cases/{case_id}/parse` | 批量解析案件文件 |
| GET | `/cases/{case_id}/parsed/{file_id}` | 获取解析文本 |
| GET | `/cases/{case_id}/desensitized/{file_id}` | 获取脱敏文本 |
| POST | `/cases/{case_id}/restore/{file_id}` | 还原脱敏文本（需授权） |
| POST | `/cases/{case_id}/export` | 导出案件文件（支持还原，需授权） |

### 3.3 Wiki `/wiki`

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/wiki/ingest` | 编译知识页面 |
| GET | `/wiki/pages` | 列出/搜索页面 |
| GET | `/wiki/pages/{path}` | 读取页面内容 |
| POST | `/wiki/lint` | 检查/修复页面 |
| POST | `/wiki/future` | 生成预测QA |

## 四、前端页面

### 4.1 页面路由

| 路由 | 页面 | 说明 |
|------|------|------|
| `/knowledge` | KnowledgePage | 知识库管理 |
| `/cases` | CasesPage | 案件卷宗管理 |
| `/wiki` | WikiPage | Wiki知识编译 |
| `/desensitize` | DesensitizePage | 脱敏配置 |

### 4.2 知识库页面功能

- **文档列表** — 支持按分类/归属/标签/关键词筛选
- **文档详情多标签** — 基本信息 / 原始解析 / 脱敏文本 / Wiki引用
- **批量操作** — 解析 / 脱敏 / 导出
- **分类管理** — 支持层级式分类（用 `/` 分隔）
- **扫描文件夹** — 批量导入本地文件

### 4.3 案件卷宗页面功能

- **案件列表** — 卡片式展示，显示状态/文件数/大小
- **案件详情** — Descriptions + 文件列表表格
- **文件详情多标签** — 基本信息 / 原始解析 / 脱敏文本 / 还原文本
- **导出功能** — 支持批量导出，可选还原脱敏内容

### 4.4 Wiki页面功能

- **左侧目录树** — 按页面类型分组展示
- **右侧表格** — 页面列表，支持搜索和类型筛选
- **页面详情Drawer** — Markdown渲染 + 编辑模式
- **编译操作** — Ingest / Force Ingest / Lint / Lint Fix / Future

### 4.5 脱敏配置页面功能

- **规则列表** — 表格展示所有脱敏规则
- **CRUD操作** — 添加/编辑/删除规则
- **保存/重置** — 保存自定义规则或恢复默认
- **状态提示** — 显示当前使用默认/自定义规则

## 五、权限控制机制

### 5.1 还原权限

所有还原操作需要前端显式传递 `authorize: true`：

```typescript
// 前端调用示例
await casesApi.restoreCaseFile(caseId, fileId);
// 内部自动传递 { authorize: true }
```

后端严格校验：
```python
if not body or not body.authorize:
    raise HTTPException(status_code=403, detail="Restore requires explicit authorization")
```

### 5.2 导出权限

导出时若勾选"还原脱敏内容"，同样需要 `authorize: true`：

```typescript
await casesApi.exportCaseFiles(caseId, {
  file_ids: [...],
  restore: true,
  authorize: true,  // 必须显式授权
});
```

### 5.3 回填映射安全

- 映射文件使用 XOR + PBKDF2 加密存储
- 生产环境应设置 `AIARB_BACKFILL_KEY` 环境变量
- 还原操作仅限授权用户

## 六、前端模块结构

```
console/src/
├── api/modules/
│   ├── knowledge.ts    ← 知识库API（含解析/脱敏/导出）
│   ├── cases.ts        ← 案件卷宗API（含解析/还原/导出）
│   └── wiki.ts         ← Wiki API（含编译/检查/预测）
├── pages/
│   ├── Knowledge/
│   │   ├── index.tsx           ← 知识库页面
│   │   └── index.module.less   ← 样式
│   ├── Cases/
│   │   ├── index.tsx           ← 案件卷宗页面
│   │   └── index.module.less   ← 样式
│   ├── Wiki/
│   │   ├── index.tsx           ← Wiki页面
│   │   └── index.module.less   ← 样式
│   └── Settings/
│       └── Desensitize/
│           ├── index.tsx       ← 脱敏配置页面
│           └── index.module.less
└── layouts/registry/
    ├── builtinRoutes.tsx  ← 路由注册
    └── builtinMenu.ts     ← 菜单注册
```

## 七、后端模块结构

```
src/aiarb/
├── parsers/
│   ├── markitdown_parser.py  ← MarkItDown解析器
│   ├── mineru_parser.py      ← MinerU云端OCR
│   ├── docling_parser.py     ← Docling降级解析
│   └── router.py             ← 解析路由中枢
├── knowledge/
│   ├── models.py             ← 知识库数据模型
│   ├── desensitize.py        ← 本地正则脱敏
│   ├── desensitize_llm.py    ← LLM二次脱敏
│   └── backfill.py           ← 回填映射管理
├── cases/
│   └── models.py             ← 案件卷宗数据模型
├── wiki/
│   └── engine.py             ← Wiki编译引擎
└── app/routers/
    ├── knowledge.py          ← 知识库API路由
    ├── cases.py              ← 案件卷宗API路由
    └── wiki.py               ← Wiki API路由
```

## 八、依赖说明

### 后端 Python 依赖

| 包名 | 用途 | 必选 |
|------|------|------|
| `markitdown` | 原生文档解析 | 推荐 |
| `docling` | 降级解析器 | 可选 |
| `fastapi` | Web框架 | 必选 |
| `pydantic` | 数据模型 | 必选 |

### 前端 NPM 依赖

| 包名 | 用途 | 必选 |
|------|------|------|
| `react-markdown` | Wiki页面Markdown渲染 | 必选 |
| `remark-gfm` | GFM扩展（表格/删除线等） | 必选 |
| `antd` | UI组件库 | 必选 |
| `@ant-design/icons` | 图标库 | 必选 |
| `lucide-react` | 补充图标（Shield等） | 必选 |

## 九、开发注意事项

1. **路径兼容**：系统优先使用 `.aiarb` 目录，自动兼容 `.aiarb` / `.copaw` 旧路径
2. **解析降级**：MarkItDown → Docling → `[Cannot parse]`，确保用户始终能看到结果
3. **脱敏顺序**：先解析为Markdown → 本地正则脱敏 → LLM二次脱敏，确保最小token消耗
4. **回填安全**：映射文件加密存储，还原操作需显式授权
5. **Wiki编译**：Ingest操作较耗时，建议后台异步执行
6. **外部引用**：案件卷宗不复制原始文件，仅缓存解析结果，避免workspace臃肿
7. **前端懒加载**：文档详情各标签页内容按需加载，切换时才请求API
8. **国际化**：所有用户可见文本使用 `t()` 函数包裹，支持中英文切换