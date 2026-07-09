# 仲裁实训（Moot）模块开发说明

## 1. 模块概述

仲裁实训（Moot）模块现在以“仲裁模拟案”为核心抽象，面向更真实的模拟仲裁场景，而不再把所有内容都看成单纯的聊天对话。它支持从案件创建、文件上传、参与者管理、阶段推进，到流程总结与协同模式配置的完整闭环。

### 1.1 命名约定

| 旧名称 | 新名称 | 说明 |
|--------|--------|------|
| tribunal | moot | tribunal 指仲裁庭，moot 指仲裁实训/模拟仲裁 |
| 新的对话 | 仲裁模拟案（case） | 在 moot 项下创建的项目是仲裁案件，不是对话 |
| 书记员 | 仲裁秘书 | 仲裁程序中承担程序管理功能的角色 |

### 1.2 设计原则

- **渐进式确认**：创建案件时无需确定所有细节，可随案件推进不断补充
- **非线性流程**：16个仲裁阶段可自由切换，不强制线性推进
- **角色灵活**：智能体可承担任意角色，同一智能体可在不同场景中切换身份
- **人机协同**：每个参与者可独立设置四种协同模式
- **文件驱动摘要**：上传文件后可根据文件信息自动生成案件摘要，减少人工输入
- **低门槛入门**：首次进入时会自动生成一个示例案，降低体验成本

---

## 2. 文件结构

```
前端（console/）
├── src/pages/Moot/
│   ├── index.tsx              # 主页面组件（~1560行）
│   ├── index.module.less      # 样式文件
│   └── DEV.md                 # 本文档
├── src/api/modules/moot.ts    # API 接口层 + 类型定义
├── src/layouts/registry/
│   ├── builtinRoutes.tsx      # 路由注册：core.moot → /moot
│   └── builtinMenu.ts         # 菜单注册：Users 图标 + "仲裁实训"
└── src/locales/
    ├── zh.json                # 中文 i18n
    └── en.json                # 英文 i18n

后端（src/qwenpaw/）
├── moot/
│   ├── __init__.py
│   ├── models.py              # 数据模型（Pydantic）+ 案件模板 + 仲裁规则 + 文档模板 + 评分维度
│   ├── store.py               # SQLite 持久化层
│   └── orchestrator.py        # 核心编排逻辑 + AI文书生成 + AI评分
└── app/routers/
    ├── moot.py                # FastAPI 路由（20个端点：4个查询 + 16个操作）
    └── __init__.py            # 路由注册
```

### 2.1 关键前端文件

- [console/src/pages/Moot/index.tsx](console/src/pages/Moot/index.tsx)：主页面组件，负责列表、创建、文件、阶段、消息、分享与协作模式入口
- [console/src/pages/Moot/utils.ts](console/src/pages/Moot/utils.ts)：封装协作模式预设、示例案件草案、搜索索引与自动摘要逻辑
- [console/src/pages/Moot/DEV.md](console/src/pages/Moot/DEV.md)：当前模块说明文档

### 2.2 已删除的旧文件

以下 tribunal 相关文件已清理：

```
console/src/pages/Tribunal/index.tsx
console/src/pages/Tribunal/index.module.less
console/src/api/modules/tribunal.ts
src/qwenpaw/tribunal/orchestrator.py
src/qwenpaw/tribunal/models.py
src/qwenpaw/tribunal/__init__.py
src/qwenpaw/app/routers/tribunal.py
```

---

## 3. 当前功能概览

### 3.1 新增能力

- 案件列表支持按名称、规则、参与者搜索
- 首次进入模块时自动创建一个演示仲裁模拟案，降低新用户门槛
- 创建案件时可选择默认的人机协同模式预设
- 上传案件文件时，系统会尝试根据文件名称、描述与类别生成案件摘要
- 阶段切换前提供确认弹窗，并支持“撤销上一步”操作
- 主要文案已统一为“仲裁模拟案”而不是“仲裁案”

### 3.2 典型使用流

1. 打开仲裁模拟实训页面
2. 查看或搜索现有模拟案
3. 创建新的模拟案，选择默认协同模式预设
4. 上传材料文件，自动生成案件摘要
5. 添加参与者并推进案件阶段
6. 通过消息、文件与时间线持续推进实训

---

## 4. 数据模型

### 4.1 核心类型定义

#### CaseStage — 案件阶段（16个）

```typescript
type CaseStage =
  | "draft"                  // 草稿
  | "filing"                 // 立案
  | "service"                // 送达
  | "defense"                // 答辩
  | "arbitrator_selection"   // 选定仲裁员
  | "tribunal_formation"     // 组庭
  | "jurisdiction_objection" // 管辖权异议
  | "challenge"              // 回避申请
  | "appraisal"              // 鉴定
  | "merger"                 // 合并审理
  | "pre_hearing"            // 庭前准备
  | "hearing"                // 开庭审理
  | "deliberation"           // 合议
  | "award"                  // 裁决
  | "enforcement"            // 执行
  | "closed";                // 结案
```

**阶段排列顺序**仅为展示参考，不代表强制推进顺序。用户可自由切换到任意阶段。

#### RoleCategory — 角色类别（4类）

```typescript
type RoleCategory = "arbitrator" | "party" | "secretary" | "controller";
```

| 角色 | 标签 | 角色细项 | 颜色 |
|------|------|----------|------|
| arbitrator | 仲裁员 | 首席仲裁员、仲裁员、边裁 | #722ed1 |
| party | 当事人 | 申请人、被申请人、第三人 | #1890ff |
| secretary | 仲裁秘书 | 仲裁秘书 | #fa8c16 |
| controller | 主控 | 导演/上帝视角、仲裁秘书兼任、当事人兼任 | #52c41a |

#### CollaborationMode — 人机协同模式（4种）

```typescript
type CollaborationMode = "human_lead" | "ai_lead" | "full_ai" | "full_human";
```

| 模式 | 标签 | 说明 |
|------|------|------|
| human_lead | 人主AI辅 | 用户主导创作内容、提出方案、参与程序，AI仅被动辅助修改或提建议 |
| ai_lead | 人辅AI主 | AI主导参与仲裁程序，人仅做必要的修改、确认和消息发动动作 |
| full_ai | 全AI | 全部由智能体AI能力参与，人不介入 |
| full_human | 全人 | 全部由人参与，智能体仅做消息通道使用，不辅助 |

#### EventType — 事件类型（9种）

```typescript
type EventType =
  | "stage_change"              // 阶段变更
  | "party_change"              // 当事人变更
  | "procedure_change"          // 程序变更
  | "tribunal_change"           // 仲裁庭变更
  | "claim_change"              // 仲裁请求变更
  | "rule_change"               // 规则变更
  | "collaboration_mode_change" // 协同模式变更
  | "procedural_application"    // 程序申请
  | "procedural_decision";      // 程序决定
```

### 4.2 数据结构

#### MootCaseData — 案件详情

```typescript
interface MootCaseData {
  case_id: string;
  case_name: string;
  case_description: string;
  status: string;                          // "draft" | "active" | "closed"
  current_stage: CaseStage;
  current_stage_label: string;
  rules: string[];                         // 支持多条仲裁规则
  controller_participant_id: string | null; // 主控智能体
  participants: MootParticipant[];
  events: MootCaseEvent[];
  messages: MootMessage[];
  created_at: number;
  updated_at: number;
  current_speaker: string | null;
}
```

#### MootParticipant — 参与者

```typescript
interface MootParticipant {
  participant_id: string;
  agent_id: string;            // 关联的智能体ID
  display_name: string;
  role: RoleCategory;
  role_detail: string;         // 角色细项，如"首席仲裁员"、"申请人"
  collaboration_mode: CollaborationMode;
  joined_at: number;
  active: boolean;             // 逻辑删除标记
}
```

#### MootMessage — 消息

```typescript
interface MootMessage {
  id: string;
  participant_id: string;
  agent_id: string;
  display_name: string;
  role: RoleCategory;
  content: string;
  stage: CaseStage;            // 发言时所处的案件阶段
  timestamp: number;
  is_system: boolean;          // 系统消息标记
}
```

#### MootCaseEvent — 案件事件

```typescript
interface MootCaseEvent {
  event_id: string;
  event_type: EventType;
  description: string;
  data: Record<string, unknown>;
  timestamp: number;
  actor_participant_id: string | null;
}
```

### 4.3 辅助数据类型（前端定义）

#### CaseTemplate — 案件模板

```typescript
interface CaseTemplate {
  template_id: string;           // 模板ID
  name: string;                  // 模板名称
  description: string;           // 模板描述
  case_name: string;             // 默认案件名称
  case_description: string;      // 默认案件描述
  rules: string[];               // 默认适用规则列表
  default_participants: {        // 默认参与者配置
    role: string;                // RoleCategory
    role_detail: string;         // 角色细项
    display_name: string;        // 显示名称
  }[];
}
```

**预设模板**：买卖合同纠纷、建设工程纠纷、借款合同纠纷、股权纠纷、知识产权许可纠纷、空白案件

#### ArbitrationRule — 仲裁规则

```typescript
interface ArbitrationRule {
  rule_id: string;               // 规则ID
  name: string;                  // 中文名称
  name_en: string;               // 英文名称
  edition: string;               // 版本号
  description: string;           // 规则说明
}
```

**内置规则体系**：北京仲裁委员会2026版1+1+n（主规则 + 程序规定 + 特殊程序）、CIETAC/SCIA/SHIAC等

#### DocumentTemplate — 文档模板

```typescript
interface DocumentTemplate {
  doc_type: string;              // 文书类型标识
  name: string;                  // 中文名称
  name_en: string;               // 英文名称
  description: string;           // 说明
}
```

**支持文书**：裁决书、部分裁决书、程序决定书、管辖权决定书、回避决定书、调解书、临时措施决定

#### ScoringDimension / ScoreResult — 评分维度与结果

```typescript
interface ScoringDimension {
  dimension_id: string;          // 维度ID
  name: string;                  // 中文名称
  name_en: string;               // 英文名称
  description: string;           // 维度说明
}

interface ScoreResult {
  dimension_id: string;          // 维度ID
  dimension_name: string;        // 维度名称
  score: number;                 // 1-10分
  reason: string;                // AI评语
}
```

**评分维度**：法律推理、程序合规、证据展示、辩论技巧、职业素养（5个维度）

---

## 4. API 接口

### 4.1 基础 CRUD

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/moot/create` | 创建仲裁案 |
| GET | `/moot/cases` | 列出所有案件 |
| GET | `/moot/{case_id}` | 获取案件详情 |
| DELETE | `/moot/{case_id}` | 删除案件 |

### 4.2 参与者管理

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/moot/{case_id}/participants` | 添加参与者 |
| PATCH | `/moot/{case_id}/participants/{pid}` | 更新参与者（协同模式/角色细项/激活状态） |
| DELETE | `/moot/{case_id}/participants/{pid}` | 移除参与者（逻辑删除） |

### 4.3 阶段与消息

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/moot/{case_id}/stage` | 切换案件阶段（可切换到任意阶段） |
| POST | `/moot/{case_id}/events` | 添加案件事件 |
| POST | `/moot/{case_id}/speak` | 以某参与者身份发言 |
| POST | `/moot/{case_id}/auto-speak` | 触发AI自动发言 |
| GET | `/moot/{case_id}/stream` | SSE 实时事件流 |

### 4.4 动态案件变更

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/moot/{case_id}/add-party` | 案件进行中新增当事人 |
| POST | `/moot/{case_id}/procedure-change` | 变更仲裁规则/程序 |
| POST | `/moot/{case_id}/tribunal-change` | 变更仲裁庭组成 |
| POST | `/moot/{case_id}/claim-change` | 变更仲裁请求 |
| POST | `/moot/{case_id}/procedural-application` | 提交程序申请 |

### 4.5 模板与规则查询

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/moot/templates` | 获取案件模板列表 |
| GET | `/moot/rules` | 获取仲裁规则列表 |
| GET | `/moot/document-templates` | 获取文档模板列表 |
| GET | `/moot/scoring-dimensions` | 获取评分维度列表 |

### 4.6 AI文书生成与评分

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/moot/{case_id}/generate-document` | AI生成法律文书 |
| POST | `/moot/{case_id}/score` | AI评分参与者表现 |

**generate-document 请求体**：
```json
{ "doc_type": "award", "participant_id": "p_xxx" }
```

**score 请求体**：
```json
{ "participant_id": "p_xxx", "dimension_id": "legal_reasoning" }
```

> `dimension_id` 可选，不传则对所有5个维度评分

### 4.7 SSE 事件流格式

连接 `GET /moot/{case_id}/stream` 后，服务端推送以下类型的事件：

```json
// 消息事件
{ "type": "moot_message", "id": "...", "participant_id": "...", "content": "...", ... }

// 阶段变更
{ "type": "stage_change", "old_stage": "filing", "new_stage": "service", "old_stage_label": "立案", "new_stage_label": "送达", "timestamp": ... }

// 发言者变更
{ "type": "speaker_change", "current_speaker": "p_xxx", "current_speaker_name": "张三", "timestamp": ... }

// 案件事件
{ "type": "case_event", "event_id": "...", "event_type": "party_change", "description": "...", "data": {}, "timestamp": ... }
```

---

## 5. 前端组件架构

### 5.1 页面状态

```
MootPage
├── 列表视图（currentCase === null）
│   ├── 空状态提示
│   ├── 案件卡片列表
│   └── 新建仲裁案弹窗（含模板选择 + 规则选择器）
│
└── 案件视图（currentCase !== null）
    ├── 顶部栏（案件名、阶段标签、当前发言者、操作按钮）
    ├── 阶段条（16个阶段可视化，可点击切换）
    ├── 主体区域
    │   ├── 消息列表
    │   └── 输入区（参与者选择 + 文本框 + 发言按钮）
    ├── 侧边栏
    │   ├── 案件信息
    │   ├── 操作按钮（生成文书 / 评分）
    │   ├── 参与者列表（含协同模式标签、操作菜单）
    │   ├── 案件进展甘特图 + 时间轴
    └── 弹窗集合
        ├── 添加参与者（智能体选择器）
        ├── 新增当事人（案件进行中，智能体选择器）
        ├── 提交程序申请
        ├── 变更仲裁规则（规则下拉选择器）
        ├── 变更仲裁庭
        ├── 变更仲裁请求
        ├── 生成法律文书（7种文书模板 + AI生成 + 复制功能）
        └── 参与者评分（5维评分 + 进度条可视化 + AI评语）
```

### 5.2 核心状态变量

```typescript
const [cases, setCases] = useState<MootCaseListItem[]>([]);        // 案件列表
const [currentCase, setCurrentCase] = useState<MootCaseData | null>(null); // 当前案件
const [messages, setMessages] = useState<MootMessage[]>([]);       // 消息列表
const [selectedParticipant, setSelectedParticipant] = useState<string>(""); // 当前发言者
const [inputText, setInputText] = useState("");                    // 输入文本
const [loading, setLoading] = useState(false);                     // 全局加载态

// 模板与规则
const [caseTemplates, setCaseTemplates] = useState<CaseTemplate[]>([]);     // 案件模板列表
const [arbitrationRules, setArbitrationRules] = useState<ArbitrationRule[]>([]); // 仲裁规则列表
const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");   // 选中的模板ID

// 智能体选择器
const [availableAgents, setAvailableAgents] = useState<AgentSummary[]>([]); // 可用智能体列表

// 文书生成
const [docTemplates, setDocTemplates] = useState<DocumentTemplate[]>([]);   // 文档模板列表
const [docGenModalOpen, setDocGenModalOpen] = useState(false);
const [docGenLoading, setDocGenLoading] = useState(false);
const [generatedDoc, setGeneratedDoc] = useState<string>("");              // AI生成的文书内容
const [selectedDocType, setSelectedDocType] = useState<string>("award");    // 选中的文书类型

// 评分系统
const [scoringDimensions, setScoringDimensions] = useState<ScoringDimension[]>([]); // 评分维度
const [scoreModalOpen, setScoreModalOpen] = useState(false);
const [scoreLoading, setScoreLoading] = useState(false);
const [scoreResults, setScoreResults] = useState<ScoreResult[]>([]);       // 评分结果
const [selectedScoreParticipant, setSelectedScoreParticipant] = useState<string>(""); // 待评分参与者
```

### 5.3 关键计算属性

```typescript
// 活跃参与者（过滤掉已退出的）
const activeParticipants = useMemo(
  () => currentCase?.participants.filter((p: MootParticipant) => p.active) || [],
  [currentCase],
);

// 已触发的阶段集合（从事件历史中提取）
const visitedStages = useMemo(() => { ... }, [currentCase]);

// 阶段下拉菜单（全部16个阶段，当前阶段标注"(当前)"）
const stageMenuItems = useMemo<MenuProps["items"]>(() => { ... }, [currentCase, handleAdvanceStage]);

// 案件模板下拉选项
const templateOptions = useMemo(
  () => caseTemplates.map((t) => ({ value: t.template_id, label: t.name + " — " + t.description })),
  [caseTemplates],
);

// 仲裁规则下拉选项（含版本号）
const ruleOptions = useMemo(
  () => arbitrationRules.map((r) => ({ value: r.name, label: r.name + "（" + r.edition + "）" })),
  [arbitrationRules],
);

// 智能体选择下拉选项（含描述截断）
const agentSelectOptions = useMemo(
  () => availableAgents.map((a) => ({
    value: a.id,
    label: a.name + (a.description ? " — " + a.description.slice(0, 30) : ""),
  })),
  [availableAgents],
);

// 甘特图数据（从 stage_change 事件计算各阶段时间跨度）
const ganttData = useMemo(() => {
  // 从事件中提取 stage_change 事件
  // 计算每个阶段的 start/end 时间戳
  // 第一个阶段从 created_at 开始，最后一个阶段到当前时间
  // 返回 { stage, label, start, end }[]
}, [currentCase]);
```

### 5.4 SSE 连接管理

```typescript
const connectSSE = useCallback((caseId: string) => {
  if (eventSourceRef.current) eventSourceRef.current.close();
  const es = new EventSource(mootApi.streamUrl(caseId));
  es.onmessage = (event) => {
    const data = JSON.parse(event.data);
    switch (data.type) {
      case "moot_message":   // 追加消息 + 更新案件时间
      case "stage_change":   // 更新当前阶段 + 状态
      case "speaker_change": // 更新当前发言者
      case "case_event":     // 追加事件到列表
    }
  };
  eventSourceRef.current = es;
}, []);
```

---

## 6. 阶段条（Stage Bar）交互设计

### 6.1 视觉状态

| 状态 | 图标 | 样式 | 含义 |
|------|------|------|------|
| 已触发（visited） | ✓ | 绿色，opacity 0.8 | 曾经经历过的阶段 |
| 当前（current） | ● | 主题色高亮，放大1.3倍 | 当前所处阶段 |
| 未触发 | ○ | 灰色，opacity 0.5 | 尚未经历过的阶段 |

### 6.2 交互行为

- **所有阶段节点均可点击**，点击后调用 `handleAdvanceStage(stage)` 切换到该阶段
- hover 时显示高亮背景 + 微上浮效果（`transform: translateY(-1px)`）
- 案件已结案（`status === "closed"`）时不可点击
- 当前阶段不可点击（已在当前阶段）

### 6.3 visitedStages 计算逻辑

`visitedStages` 从案件事件历史中提取，而非简单按数组索引判断。这样支持非线性流程场景：

1. 案件从"立案"跳到"开庭"（跳过中间阶段）
2. 案件从"开庭"回退到"答辩"（补充程序）
3. 此时"立案"、"开庭"、"答辩"都标记为已触发

---

## 7. 人机协同模式

### 7.1 模式切换入口

- 侧边栏参与者卡片 → 设置图标 → 下拉菜单
- 菜单中列出四种模式及其说明
- 切换后调用 `mootApi.updateParticipant()` 更新

### 7.2 模式对行为的影响

| 模式 | 用户操作 | AI行为 | 发言方式 |
|------|---------|--------|---------|
| 人主AI辅 | 用户手动输入内容 | AI仅提供建议/修改 | 手动发言 |
| 人辅AI主 | 用户确认/修改AI输出 | AI主动生成内容 | AI自动发言 + 用户确认 |
| 全AI | 无需用户操作 | AI完全自主 | AI自动发言 |
| 全人 | 用户完全手动 | 不辅助 | 手动发言 |

### 7.3 AI自动发言

点击参与者菜单中的"AI自动发言"按钮，调用 `mootApi.autoSpeak()`。后端会：

1. 检查智能体是否存在
2. 构建上下文（近期消息、案件事件、角色信息、当前阶段）
3. 调用智能体对话接口生成回复
4. 将回复作为消息广播给所有SSE订阅者

---

## 8. 动态案件变更

仲裁案件在推进过程中可能发生多种变更，前端通过"案件变更"下拉菜单提供入口：

### 8.1 新增当事人

- 场景：案件进行中出现第三人加入、当事人变更等
- API：`POST /moot/{case_id}/add-party`
- 后端同时创建 `party_change` 事件

### 8.2 变更仲裁规则

- 场景：简易程序转普通程序、调仲对接、数字经济程序等
- API：`POST /moot/{case_id}/procedure-change`
- 支持多条规则（逗号/换行分隔输入）
- 后端同时创建 `rule_change` 事件

### 8.3 变更仲裁庭

- 场景：1人庭变3人庭、仲裁员回避/退出后更换
- API：`POST /moot/{case_id}/tribunal-change`
- 后端创建 `tribunal_change` 事件

### 8.4 变更仲裁请求

- 场景：增加、变更或减少仲裁请求
- API：`POST /moot/{case_id}/claim-change`
- 后端创建 `claim_change` 事件

### 8.5 提交程序申请

- 场景：管辖权异议、回避申请、鉴定申请、合并审理申请等
- API：`POST /moot/{case_id}/procedural-application`
- 支持选择申请类型和填写申请内容

---

## 9. 后端编排器（Orchestrator）

### 9.1 数据持久化（SQLite）

使用 SQLite 单文件数据库持久化所有案件数据，存储路径 `~/.aiarb/moot/moot.db`。

#### 数据库表结构

```sql
-- 案件主表
CREATE TABLE moot_cases (
    case_id           TEXT PRIMARY KEY,
    case_name         TEXT NOT NULL DEFAULT '仲裁案',
    case_description  TEXT NOT NULL DEFAULT '',
    status            TEXT NOT NULL DEFAULT 'draft',
    current_stage     TEXT NOT NULL DEFAULT 'draft',
    rules             TEXT NOT NULL DEFAULT '[]',        -- JSON 数组
    controller_participant_id TEXT,
    current_speaker   TEXT,
    created_at        REAL NOT NULL,
    updated_at        REAL NOT NULL
);

-- 参与者表
CREATE TABLE moot_participants (
    participant_id    TEXT PRIMARY KEY,
    case_id           TEXT NOT NULL REFERENCES moot_cases(case_id) ON DELETE CASCADE,
    agent_id          TEXT NOT NULL,
    display_name      TEXT NOT NULL,
    role              TEXT NOT NULL,                      -- RoleCategory enum
    role_detail       TEXT NOT NULL DEFAULT '',
    collaboration_mode TEXT NOT NULL DEFAULT 'ai_lead',   -- CollaborationMode enum
    joined_at         REAL NOT NULL,
    active            INTEGER NOT NULL DEFAULT 1
);

-- 消息表
CREATE TABLE moot_messages (
    id                TEXT PRIMARY KEY,
    case_id           TEXT NOT NULL REFERENCES moot_cases(case_id) ON DELETE CASCADE,
    participant_id    TEXT NOT NULL,
    agent_id          TEXT NOT NULL,
    display_name      TEXT NOT NULL,
    role              TEXT NOT NULL,
    content           TEXT NOT NULL DEFAULT '',
    stage             TEXT NOT NULL,                      -- CaseStage enum
    timestamp         REAL NOT NULL,
    is_system         INTEGER NOT NULL DEFAULT 0
);

-- 事件表
CREATE TABLE moot_events (
    event_id              TEXT PRIMARY KEY,
    case_id               TEXT NOT NULL REFERENCES moot_cases(case_id) ON DELETE CASCADE,
    event_type            TEXT NOT NULL,                  -- EventType enum
    description           TEXT NOT NULL DEFAULT '',
    data                  TEXT NOT NULL DEFAULT '{}',     -- JSON 对象
    timestamp             REAL NOT NULL,
    actor_participant_id  TEXT
);

-- 索引
CREATE INDEX idx_participants_case ON moot_participants(case_id);
CREATE INDEX idx_messages_case ON moot_messages(case_id, timestamp);
CREATE INDEX idx_events_case ON moot_events(case_id, timestamp);
```

#### MootStore 类

```python
# 单例模式，延迟初始化
store = MootStore.get_instance()  # 默认 ~/.aiarb/moot/moot.db
store = MootStore.get_instance(db_dir=Path("/custom/path"))  # 自定义路径

# 核心方法
store.create_case(case)                    # INSERT 案件
store.get_case(case_id) -> MootCase | None # SELECT 案件 + JOIN 参与者/消息/事件
store.list_cases() -> List[MootCase]       # SELECT 全部案件
store.update_case(case_id, **kwargs)       # UPDATE 案件字段
store.delete_case(case_id)                 # DELETE CASCADE

store.add_participant(participant, case_id)
store.update_participant(participant_id, **kwargs)

store.add_message(msg)
store.get_messages(case_id) -> List[MootMessage]

store.add_event(event, case_id)
store.get_events(case_id) -> List[CaseEvent]
```

#### 异步适配

所有 store 操作都是同步的（`threading.Lock` 保护），orchestrator 通过 `asyncio.to_thread()` 调用：

```python
case = await asyncio.to_thread(store.get_case, case_id)
await asyncio.to_thread(store.add_message, msg)
await asyncio.to_thread(store.update_case, case_id, updated_at=now)
```

#### WAL 模式

数据库启用 WAL（Write-Ahead Logging）模式，支持并发读写：
- SSE 订阅者读取数据时，写入操作不会被阻塞
- `PRAGMA busy_timeout=5000` 避免锁竞争超时
- `PRAGMA foreign_keys=ON` 确保级联删除

#### 关键设计决策

| 决策 | 原因 | 影响范围 |
|------|------|----------|
| **单例模式** | 全局共享一个 SQLite 连接，避免多连接的锁竞争 | `MootStore.get_instance()` 延迟初始化，整个进程共享同一实例 |
| **`threading.Lock`** | SQLite 单连接不是线程安全的，需要显式加锁保护所有写操作 | 所有 CRUD 方法内部 `with self._lock` 包裹 |
| **`asyncio.to_thread()`** | 同步 SQLite 操作不能阻塞 FastAPI 的异步事件循环 | orchestrator 层所有 store 调用均通过 `await asyncio.to_thread(store.xxx, ...)` |
| **WAL 模式** | 允许 SSE 订阅者并发读取，不被写入操作阻塞 | `PRAGMA journal_mode=WAL`，配合 `busy_timeout=5000` |
| **`_UNSET` 哨兵** | 区分"未传入参数"和"显式传入 None"，支持清除 `controller_participant_id` 等可选字段 | `update_case()` 和 `update_case_fields()` 中 `controller_participant_id`/`current_speaker` 默认值为 `_UNSET` 而非 `None` |
| **外键级联删除** | 删除案件时自动清理关联的参与者、消息和事件 | `FOREIGN KEY (case_id) REFERENCES moot_cases(case_id) ON DELETE CASCADE` |

### 9.2 SSE 广播机制

SSE 队列仍使用内存存储（`_queues`），不持久化。服务重启后客户端需重新连接。

```python
_queues: Dict[str, List[asyncio.Queue]] = {}  # 每个案件一个队列列表

async def subscribe(case_id) -> asyncio.Queue: ...
async def unsubscribe(case_id, q) -> None: ...
async def _broadcast(case_id, data) -> None: ...
```

每个 SSE 连接对应一个 `asyncio.Queue`，`_broadcast` 向该案件的所有队列推送数据。

### 9.3 auto_speak 流程

```
1. 查找参与者 → 检查是否活跃
2. 检查智能体是否存在（agent_exists）
3. 构建上下文 prompt：
   - 角色信息（名称、角色细项）
   - 案件阶段
   - 案件名称和描述
   - 适用规则
   - 近5条案件事件
   - 近10条对话消息
   - 用户指定的 prompt
4. 调用 chat_with_agent 生成回复
5. 将回复作为消息保存并广播
6. 失败时发送系统消息提示
```

---

## 10. 路由与菜单配置

### 10.1 前端路由

```typescript
// builtinRoutes.tsx
{ id: "core.moot", path: "/moot", component: MootPage }
```

### 10.2 菜单配置

```typescript
// builtinMenu.ts
{
  id: "core.moot",
  parentId: "core",
  label: navLabel("nav.moot", "仲裁实训"),
  icon: Users,           // lucide-react 团队图标
  route: "core.moot",
}
```

### 10.3 后端路由

```python
# app/routers/__init__.py
from .moot import router as moot_router
router.include_router(moot_router)  # prefix="/moot"
```

---

## 11. 国际化

### 11.1 i18n 键

| 键 | 中文 | 英文 |
|----|------|------|
| nav.moot | 仲裁实训 | Arbitration Moot |
| moot.title | 仲裁实训 | Arbitration Moot |
| moot.createCase | 新建仲裁案 | New Case |
| moot.createTitle | 新建仲裁案 | Create Arbitration Case |
| moot.caseName | 案件名称 | Case Name |
| moot.caseDescription | 案件描述 | Case Description |
| moot.rules | 仲裁规则 | Arbitration Rules |
| moot.noCases | 暂无仲裁案，请创建新案件开始仲裁实训 | No cases yet |
| moot.noMessages | 暂无消息，添加参与者后开始对话 | No messages yet |
| moot.addParticipant | 添加参与者 | Add Participant |
| moot.back | 返回列表 | Back |

---

## 12. 已知限制与后续计划

### 12.1 当前限制

1. **智能体快速创建**：当智能体管理模块不可用时，使用生成的占位ID
2. **阶段条溢出**：16个阶段在窄屏下可能溢出，已添加横向滚动
3. **消息去重**：SSE 可能推送重复消息，前端通过 ID 去重

### 12.2 后续计划（按难易程度排序）

| # | 功能 | 难度 | 状态 | 说明 |
|---|------|------|------|------|
| 1 | 案件模板 | ★☆☆ | ✅ 已完成 | 6种预设模板 + 创建案件时模板选择 + 自动填充 + 自动添加默认参与者 |
| 2 | 多语言仲裁规则 | ★★☆ | ✅ 已完成 | 北京仲裁委2026版1+1+n规则体系 + 规则下拉选择器（创建/变更） |
| 3 | 智能体选择器 | ★★☆ | ✅ 已完成 | 调用 agentsApi.listAgents() + Select替代手动输入ID + 搜索过滤 |
| 4 | 甘特图视图 | ★★☆ | ✅ 已完成 | 从 stage_change 事件计算时间跨度 + 侧边栏条形图 + 悬停详情 |
| 5 | 文档模板 | ★★★ | ✅ 已完成 | 7种法律文书 + AI生成(chat_with_agent) + 复制到剪贴板 |
| 6 | 评分系统 | ★★★ | ✅ 已完成 | 5维评分 + AI评分(1-10分+理由) + 进度条可视化 + 综合评分 |

### 12.3 已实现功能详细说明

#### 12.3.1 案件模板

**后端**：
- `models.py`：`CaseTemplate` 模型 + `CASE_TEMPLATES` 预设数据（6种模板）
- `routers/moot.py`：`GET /moot/templates` 端点

**前端**：
- 创建案件弹窗新增"案件模板"下拉选择器
- 选择模板后自动填充：案件名称、案件描述、适用规则
- 创建成功后自动添加模板中的默认参与者（角色+角色细项+显示名称）

**预设模板**：买卖合同纠纷、建设工程纠纷、借款合同纠纷、股权纠纷、知识产权许可纠纷、空白案件

#### 12.3.2 多语言仲裁规则

**后端**：
- `models.py`：`ARBITRATION_RULES` 列表（含北京仲裁委2026版1+1+n体系 + CIETAC/SCIA/SHIAC）
- `routers/moot.py`：`GET /moot/rules` 端点

**前端**：
- 创建案件弹窗：规则字段改为 `Select mode="tags"`，支持从下拉选择或手动输入
- 变更规则弹窗：同样使用规则下拉选择器，打开时自动填充当前规则

**北京仲裁委2026版1+1+n规则体系**：
- 1 = 仲裁规则（主规则）
- 1 = 程序规定（通用程序规定）
- n = 简易程序规定、金融仲裁规则、紧急仲裁员程序规定、国际商事仲裁规则等

#### 12.3.3 智能体选择器

**前端**：
- 组件挂载时调用 `agentsApi.listAgents()` 获取智能体列表
- 添加参与者弹窗：`agent_id` 字段从 `<Input>` 改为 `<Select showSearch>`
- 新增当事人弹窗：同样使用智能体选择器
- 支持搜索过滤（按名称和描述匹配）

#### 12.3.4 甘特图视图

**前端**：
- `ganttData` 计算属性：从 `stage_change` 事件提取各阶段时间跨度
- 侧边栏"案件进展"区域新增甘特图条形图
- 每个阶段用对应颜色的条形表示，宽度按时间比例计算
- 鼠标悬停显示阶段名称和时间范围
- 最后一个阶段延伸到当前时间

#### 12.3.5 文档模板（AI文书生成）

**后端**：
- `models.py`：`DOCUMENT_TEMPLATES` 列表（7种法律文书）
- `orchestrator.py`：`generate_document()` 函数
  - 构建包含案件信息、参与者、近期事件和对话的 prompt
  - 调用 `chat_with_agent()` 生成文书内容
  - AI失败时回退到模板填充模式
- `routers/moot.py`：`GET /moot/document-templates` + `POST /moot/{case_id}/generate-document`

**前端**：
- 侧边栏"案件信息"区域新增"生成文书"按钮
- 文书生成弹窗：选择文书类型 → 点击生成 → 展示AI生成的文书内容
- 支持复制到剪贴板

#### 12.3.6 评分系统（AI评分）

**后端**：
- `models.py`：`SCORING_DIMENSIONS` 列表（5个评分维度）
- `orchestrator.py`：`score_participant()` 函数
  - 逐维度调用 `chat_with_agent()` 评分（1-10分 + 理由）
  - 解析AI返回的"评分|理由"格式
  - AI失败时返回默认分数5分
- `routers/moot.py`：`GET /moot/scoring-dimensions` + `POST /moot/{case_id}/score`

**前端**：
- 侧边栏"案件信息"区域新增"评分"按钮
- 评分弹窗：选择参与者 → 点击开始评分 → 展示评分结果
- 综合评分（5维平均分）大字展示
- 每个维度用进度条可视化（绿色≥7/黄色≥5/红色<5）
- 底部展示各维度AI评语