# AIArb 控制台全面升级 PRD

## 1. 项目概述

### 1.1 背景说明
AIArb 是一款仲裁法律领域的智能辅助平台，本次升级旨在整合并增强核心功能模块，提升用户体验，实现本地化数据持久化，并优化文档处理引擎配置。

### 1.2 项目目标
- 恢复并优化记忆中心功能
- 整合技能/技能池/技能市场为统一 tab 页面
- 将知识库改造为 RAG 聚合页
- 增强模拟仲裁功能（视角选择、策略预测、人机协同、案件导入）
- 增强案件管理功能（结构化信息、材料分区、标签管理、本地文件夹扫描、内部智能体）
- 完善文档引擎设置（可视化配置、一键安装引导、C端设计）
- 实现数据本地化持久化存储（SQLite）

---

## 2. 功能模块详细说明

### 2.1 记忆中心 (Memory)

#### 功能描述
恢复记忆中心菜单项，支持用户管理和查看智能体的记忆数据。

#### 实现要点
- 菜单 ID: `core.memory`
- 路由: `/memory`
- 图标: `Brain`
- 位置: 仲裁业务工具组

---

### 2.2 技能统一页面 (Unified Skills)

#### 功能描述
将技能（Skills）、技能池（Skill Pool）、技能市场（Skill Market）整合为一个统一页面，使用 tab 切换。

#### 实现要点
- 路由: `/skills`
- Tab 选项:
  - 技能 (skills)
  - 技能池 (skill-pool)
  - 技能市场 (market)
- 复用设计版 (`console/src/pages/Design/Skills/index.tsx`) 的 tab 结构
- 兼容性: 保留 `/skill-pool` 路由并重定向到 `/skills?tab=pool`

---

### 2.3 知识库 RAG 聚合页 (Knowledge Desk)

#### 功能描述
将知识库改造为 RAG 聚合页，支持文件上传、自动 RAG、预览、编辑、版本管理、传统检索、AI 自然语言检索。

#### 功能特性
1. **文件上传**: 支持 md、word、html、json、ppt、pdf 等格式
2. **自动 RAG**: 上传后自动进行 RAG 处理
3. **预览/编辑**: 集成 `MarkdownCopy` 组件
4. **版本管理**: 通过 drawer 查看文档版本
5. **双模式检索**:
   - 正则/关键词检索（本地过滤）
   - AI 语义检索（调用 `deskApi.semanticSearch`）
6. **分类与标签**:
   - 默认分类: 仲裁法律、规则、案例、实务文章
   - 支持自定义标签
7. **本地文件夹集成**: 通过 modal 扫描本地文件夹导入文件引用

#### 页面布局
- 三栏布局: Sidebar | Main Content | AI Panel
- Sidebar: 分类筛选、标签筛选、统计信息
- Main Content: 上传区、文档网格、搜索结果
- AI Panel: AI 问答辅助

#### 技术实现
- 文件类型: `SearchResult` { type, doc_id, name, content, score, source }
- 搜索模式切换: `searchMode` (regex | ai)
- 文件 ID 处理: `file_path.replace(/[/.\\]/g, "_")`

---

### 2.4 模拟仲裁 (Moot)

#### 功能描述
增强模拟仲裁功能，支持多智能体辅助、视角选择、策略预测、人机协同模式和案件导入。

#### 功能特性
1. **视角选择** (`ViewPerspective`):
   - god: 上帝视角（全局观察）
   - claimant: 申请人视角
   - respondent: 被申请人视角
   - arbitrator: 仲裁员视角
   - secretary: 仲裁秘书视角

2. **策略分析** (`strategyApi.analyzeStrategy`):
   - 己方策略建议（名称、描述、风险等级、预期结果）
   - 对方策略预测（参与者、预测策略、置信度）
   - 胜率预测（分数、分析、关键因素）
   - AI 建议
   - 风险评估
   - Drawer 展示分析结果

3. **人机协同模式** (`COLLABORATION_MODE_LABELS`):
   - full_ai: AI全自动（观摩模式）
   - ai_lead: AI主导（辅助模式）
   - human_lead: 人主导（实训模式）
   - full_human: 纯人工（考试模式）

4. **案件导入** (`strategyApi.importFromCase`):
   - 从案件管理导入案件基本信息
   - 创建为独立的模拟仲裁案
   - 数据相互独立

5. **庭审阶段流程** (`TRIAL_STAGE_FLOW`):
   - opening: 开庭准备
   - pleading: 陈述与答辩
   - evidence: 举证质证
   - debate: 辩论
   - closing: 最后陈述
   - deliberation: 合议与裁决
   - closed: 结案

#### API 接口
- `POST /moot/{case_id}/analyze-strategy`: 策略分析
- `POST /moot/import-from-case`: 案件导入
- `GET /moot/cases-for-import`: 获取可导入案件列表

#### UI 组件
- 视角选择器: `Select` 组件
- 策略分析按钮: `Button` with `ThunderboltOutlined`
- 策略分析 Drawer: 包含胜率预测（环形图）、策略列表、AI 建议等
- 案件导入 Modal: 显示可导入案件列表

---

### 2.5 案件管理 (Cases)

#### 功能描述
增强案件管理功能，支持结构化信息、材料分区权限控制、文件标签管理、本地文件夹扫描、内部智能体（全能视角）。

#### 功能特性

1. **案件结构化信息**:
   - 案号 (case_number)
   - 仲裁机构 (arbitration_institution)
   - 争议类型 (dispute_type)
   - 争议金额 (claim_amount)
   - 仲裁程序 (arbitration_procedure): 普通程序、简易程序、特别程序、国际商事仲裁程序
   - 适用规则 (arbitration_rules)
   - 立案日期 (filing_date)
   - 开庭日期 (hearing_date)
   - 案情摘要 (case_summary)
   - 当事人信息 (parties): 支持申请人和被申请人，包含代理人信息

2. **材料分区权限** (`MaterialZone`):
   - shared: 共有材料（所有人可见）
   - claimant: 申请人独享（仅申请人方可见）
   - respondent: 被申请人独享（仅被申请人方可见）
   - arbitrator: 仲裁员独享（仅仲裁员可见）
   - secretary: 仲裁秘书独享（仅仲裁秘书可见）
   - 智能体调取时根据分区划分权限

3. **文件标签管理**:
   - 分区 (zone): 权限控制
   - 分类 (category): 仲裁申请书、答辩书、证据材料、代理词等
   - 自定义标签 (custom_tags): 用户可自由添加
   - 备注 (description)

4. **AI 整理文件** (`casesApi.aiOrganize`):
   - AI 自动分析文件并分配材料分区
   - 自动分类文件
   - 支持预览模式（不实际修改）和执行模式（已备份）
   - 显示整理方案和原因

5. **内部智能体（全能视角）**:
   - 默认以全能视角运行，可查看案件全部材料
   - 支持问答和文书写作任务
   - 生成的文档默认为 docx 格式
   - 置信度和参考文件列表
   - 支持问答模式和文书模式切换

6. **本地文件夹扫描** (`casesApi.scanFolder`):
   - 扫描根文件夹，智能识别可创建为案件的子文件夹
   - 显示建议的案件名称和文件数量
   - 支持批量创建多个案件
   - 不改变本地文件存储结构，仅创建案件引用

#### SQLite 持久化
使用 `CasesStore` (SQLite) 持久化以下数据:
- 案件结构化信息 (`case_structured_info`, `case_parties` 表)
- 文件标签 (`case_file_tags` 表)
- AI 整理结果 (`case_ai_organize_results` 表)
- AI 聊天历史 (`case_ai_chat_messages` 表)
- 引擎配置 (`engine_config` 表)
- 处理历史记录 (`processing_history` 表)
- 扫描结果 (`case_scan_results` 表)

#### UI 组件
- 案件卡片: 显示案号、结构化信息概览、标签、索引状态
- 详情 Drawer: 包含概览、文件列表、AI对话、实体注册表、时间线等 tab
- 文件标签编辑 Modal: 设置分区、分类、自定义标签
- 结构化信息编辑 Modal: 表单编辑案件信息
- AI 整理 Modal: 预览或执行 AI 整理
- 扫描文件夹 Modal: 显示扫描结果并批量创建案件

---

### 2.6 文档引擎设置 (Engine Settings)

#### 功能描述
完善文档引擎设置，提供可视化配置、一键安装引导、C端设计风格。

#### 功能特性
1. **引擎状态可视化**:
   - 引擎就绪度百分比（进度圆环）
   - MinerU、Tesseract、MarkItDown、LLM脱敏、本地模型状态卡片
   - 颜色编码: 就绪(绿色)、未配置(黄色)、运行中(蓝色)

2. **快速设置**:
   - 默认解析模式: 自动 / 云端优先 / 仅本地
   - 脱敏策略: 仅正则 / 正则+LLM / 仅LLM
   - 原始文件存储: 加密存储 / 明文存储 / 不保存

3. **一键安装引导** (`INSTALL_GUIDES`):
   - MinerU 客户端安装步骤
   - Tesseract OCR 安装步骤
   - 本地脱敏模型安装步骤
   - Download 按钮和测试连接按钮
   - 步骤指引 (Steps 组件)

4. **详细配置 Drawer**:
   - MinerU 引擎配置: 服务地址、状态
   - Tesseract OCR 配置: 识别语言
   - 脱敏引擎配置: 正则规则、LLM补充、本地模型
   - 安全策略配置: 原始文件存储策略

5. **处理历史与预览**:
   - 显示最近处理记录
   - 文件信息预览（处理引擎、耗时、页数、含图片/表格）
   - 解析内容预览

6. **C端设计风格**:
   - 卡片式布局，图标友好
   - 色彩渐变背景引导
   - 步骤指引和安装向导
   - 可视化进度和状态指示

#### API 接口
- `GET /api/knowledge/desensitize/status`: 获取引擎状态
- `POST /api/knowledge/desensitize/config`: 更新配置
- `GET /api/knowledge/processing-history`: 获取处理历史

#### UI 组件
- 引擎就绪 Banner: 渐变背景、进度圆环、状态标签
- 引擎卡片: 图标、状态徽章、配置按钮
- 快速设置区域: Select 组件
- 统计卡片: 解析数量、脱敏数量、平均耗时
- 最近处理列表: List 组件带状态图标
- 配置 Drawer: 表单编辑、测试连接
- 安装引导 Drawer: Steps 组件、下载按钮
- 处理历史 Drawer: List 组件、预览功能
- 预览 Drawer: 文件信息和解析内容 tab

---

## 3. 数据持久化设计

### 3.1 SQLite 数据库架构

#### Moot Store (现有模块)
- 位置: `~/.aiarb/moot/moot.db`
- 表:
  - `moot_cases`: 案件基本信息
  - `moot_participants`: 参与者信息
  - `moot_messages`: 对话消息
  - `moot_events`: 案件事件
  - `moot_file_blobs`: 文件 Blob 存储
  - `moot_case_files`: 案件文件
  - `moot_case_links`: 案件链接
  - `moot_copilot_messages`: Copilot 消息

#### Cases Store (新增模块)
- 位置: `~/.aiarb/cases/cases.db`
- 表:
  - `case_structured_info`: 案件结构化信息
  - `case_parties`: 当事人信息
  - `case_file_tags`: 文件标签（分区、分类、自定义标签）
  - `case_ai_organize_results`: AI 整理结果
  - `case_ai_chat_messages`: AI 聊天历史
  - `engine_config`: 引擎配置
  - `processing_history`: 处理历史记录
  - `case_scan_results`: 扫描结果

### 3.2 持久化特性
- WAL 模式: 支持并发读写
- 外键约束: 确保数据一致性
- 线程锁: 保护并发访问
- 自动备份: AI 整理时自动备份

---

## 4. UI/UX 设计原则

### 4.1 C端设计风格
- 简洁直观的操作流程
- 图标化元素和色彩引导
- 步骤指引和安装向导
- 可视化进度和状态反馈

### 4.2 布局统一
- 页面头部: `PageHeader` 组件
- 抽屉式详情: `Drawer` 组件
- 三栏布局: Sidebar | Main | AI Panel（知识库、案件管理）
- 响应式设计: 适配不同屏幕尺寸

### 4.3 色彩规范
- 主题色: `var(--ant-color-primary)`
- 状态色: 成功(green)、警告(orange)、错误(red)、默认(gray)
- 分区色: 
  - shared: #1890ff
  - claimant: #52c41a
  - respondent: #f5222d
  - arbitrator: #722ed1
  - secretary: #fa8c16

---

## 5. 技术栈

### 5.1 前端
- React 18+
- TypeScript
- Ant Design 5.x
- React Router
- Zustand (状态管理)

### 5.2 后端
- Python 3.8+
- FastAPI
- SQLite 3
- Pydantic (数据校验)

### 5.3 核心依赖
- MinerU: 文档解析
- Tesseract: OCR
- MarkItDown: Markdown 解析
- llama.cpp: 本地模型

---

## 6. 非功能需求

### 6.1 性能
- 页面响应时间 < 500ms
- 数据库查询 < 100ms
- 文件上传支持大文件分片

### 6.2 可用性
- C端用户友好的操作界面
- 一键安装和配置引导
- 清晰的错误提示

### 6.3 安全性
- 原始文件加密存储
- 云端 LLM 仅接触脱敏文本
- 文件访问权限控制

### 6.4 可维护性
- 模块化代码结构
- 清晰的 API 接口
- SQLite 数据持久化

---

## 7. 交付物清单

- [x] 恢复记忆中心菜单项
- [x] 统一技能/技能池/技能市场页面
- [x] 知识库 RAG 聚合页
- [x] 增强模拟仲裁功能
- [x] 增强案件管理功能
- [x] 完善文档引擎设置
- [x] SQLite 持久化层
- [x] 开发说明文档
- [x] PRD 文档

---

## 8. 风险与限制

### 8.1 已知风险
1. MinerU 安装可能受网络限制
2. 本地模型需要较高硬件配置
3. 大文件处理可能影响性能

### 8.2 限制
1. 部分功能依赖外部 API（如 MinerU）
2. SQLite 在高并发场景下性能可能受限
3. 本地文件夹扫描需要用户授权

---

## 9. 未来规划

1. 支持更多文件格式解析
2. 优化 AI 对话模型选择
3. 增加批量操作功能
4. 支持云端同步配置
5. 增强可视化图表展示

---

**文档版本**: v1.0
**最后更新**: 2024年
**维护者**: AIArb 团队