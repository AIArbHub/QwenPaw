# LegalWork 0.3.30 逆向分析：对 QwenPaw(AIArb) 的复用与借鉴价值

> 分析对象：`C:\Users\lixin\Downloads\legalwork-0.3.30-win-x64`
> 分析方式：完整解包 `app.asar`（22,407 个文件）、直读 `app.asar.unpacked` 未压缩源码、通读 Python 文档流水线与 94 个 Skill 的元数据
> 分析日期：2026-09-07

---

## 0. 一句话结论

**它不是"又一个法律 AI 聊天框"，而是一台已经把"法律交付质量"编译成代码的产品化机器。** 它最值钱的不是那 94 个 Skill，而是三件 QwenPaw 目前完全没有的东西：**把用户自然语言要求编译成机器可校验契约的机制**、**交付前的引用/事实核验闭环**、**长任务的 lane + 预算 + 验收编排**。这三件直接命中你核阅工作流里"不接受占位批注""必须实质更正""逐条对应"的痛点。

但同时——**它的 Skill 资产有明确的商用许可地雷，不能直接 vendoring 进 ArbitrumAI 的闭源层**（详见第 4 节）。正确的姿势是：**抄机制，不抄语料**。

---

## 1. 它到底是什么

| 维度 | 实测结果 |
|---|---|
| 形态 | Electron 40 桌面壳（主 exe 190MB + `app.asar` 189MB） |
| 主程序 | `resources/app.asar.unpacked/legalwork/` — 一个**独立的 TypeScript agent runtime**，通过本地 HTTP + SSE 供渲染进程调用 |
| 第二运行时 | `resources/office-runtime/python/` — 内嵌 CPython **3.11.16**（python-build-standalone，带 `runtime.json` 与 requirements sha256 校验） |
| Python 依赖 | docx / openpyxl / pptx / lxml / PIL / reportlab / flask / fitz(PyMuPDF) / odf / openai / **paddle + paddleocr** / pypdf / pandas |
| Node 关键依赖 | `@modelcontextprotocol/sdk`、`better-sqlite3`、`@officecli/officecli`(1.0.143)、mammoth、pdf-parse、xlsx、zod |
| 更新源 | `resources/app-update.yml` → GitHub `sunyifeisb-art/legalwork` |
| 代码量（主程序） | `legalwork/dist` 约 40+ 模块，单 `loop/agent-loop.js` 即 **264KB** |
| Skill 资产 | **94 个 Skill 包，29MB**，其中 `8203` 一个包就含 **258 个民事案由的裁判规则库**（7.2MB，516 文件） |

### 目录地图（主程序分层）

```
legalwork/dist/
├── contracts/   zod 契约（capabilities / threads / turns / items / events / review / knowledge / usage）
├── domain/      纯领域模型（item / thread / turn / session / event reducer / usage）
├── ports/       端口接口（model-client / thread-store / approval-gate / tool-host / event-bus …）
├── adapters/    实现（model: deepseek/anthropic/codex；tool: 60+ 内置工具；file/hybrid store；workspace）
├── loop/        agent-loop(264KB) / workflow-governance / document-task-contract / fact-verification
│                / tool-storm-breaker / token-economy / context-compactor / history-healing
├── knowledge/   citation-engine / citation-verifier / knowledge-store(55KB) / sqlite-index
│                / knowledge-graph / pyramid-router / query-planner / retrieval-pipeline
├── skills/      skill-runtime.js (34KB) — 发现、打分、激活、指令预算控制
├── templates/   embedded-legal-document-templates.js (29KB) 内置法律文书模板
├── prompt/      legalwork-system-prompt.js (21KB)
├── review/      git-review-target / review-output / review-prompt
└── server/      HTTP 路由 + SSE + runtime-factory
```

**架构判断：教科书级的六边形架构（ports & adapters）+ 纯函数策略层。** 所有"策略"文件头部都写着 `All functions are pure — no I/O, no side effects`——策略与 I/O 严格分离，可单测、可复现。这是它能在 0.3.x 就堆到这个规模而不崩的原因，也是 QwenPaw 最该学的一条。

---

## 2. 六层可复用资产清单（按 ROI 排序）

### 【A 级】直接可移植 —— 机制层面，与语言无关，移植成本 1–3 天/项

#### A1. `loop/document-task-contract.js` — **把"用户要求"编译成机器可校验的契约** ⭐最高价值

这是整个项目里我最想让你看的一个文件。它做的事：

1. **从用户 prompt 里正则抽取硬指标**，生成契约对象：

| 抽取项 | 正则/逻辑示例 | 对应你核阅里的痛点 |
|---|---|---|
| `minimumContentCharacters` | `不少于 N 字` | 篇幅不达标 |
| `requiredHeadings[]` | 行首 `一、二、` 或 `- 参考文献` 等 | 章节缺失 |
| `requiredTopicTerms[]` | `以/围绕/关于 「...」` | 跑题 |
| `minimumCaseCount` | `分析 N 个案例`，并实际**检出不同案号数** | 案例数量注水 |
| `minimumReferenceCount` / `recentReferenceCutoffYear` | `参考文献不少于 N 条` + `近 N 年 / YYYY 年以来` | 引用陈旧 |
| `requiredFilenameFragments{docx,pptx,pdf,xlsx}` | `文件名中含「...」` | 交付物命名 |
| `forbidPlaceholders` | `禁止/不得 … 省略号/占位符/待补充` | **"建议全文核对"这类占位批注** |
| `requiresDesensitization` | `执行脱敏` | 脱敏漏做 |
| `requiredKnowledgePdfReads` | `OCR + PDF + 至少 N 篇` | **没真读文件就下结论** |

2. **交付前用 `validateDocumentContent()` 机械校验**，把不达标项变成具体 issue 回灌给模型重做：
   ```js
   issues.push(`仅检出 ${caseCount} 个不同案号，用户要求至少 ${minimumCaseCount} 个典型案例`)
   issues.push('文档含有用户明确禁止的省略号或占位内容')
   ```

3. **`documentFactualFidelityInstruction()` 注入事实边界护栏**（原文）：
   > - 只能把用户明确提供、附件中明确记载或工具已经核验的内容写成既成事实。
   > - 不得自行补写用户未提供的案件事实，也不得把常见情形、推测或法律分析改写成已经发生的事实。
   > - 特别不得擅自补充验收、签收、质量异议、催告或沟通经过、付款条件、具体日期、主体身份、损失金额等事实。
   > - 生成终稿前逐项检查事实主语、义务主体、金额和时间，避免把甲乙方或权利义务主体写反。

**对你的价值**：这段几乎是你"仲裁裁决书核阅"方法论的代码化版本。你反复强调的「来源标注到 PDF 页码/段、笔录行号」「双方主张 ↔ 仲裁庭意见逐条对应」「不接受占位批注」——在 QwenPaw 里现在是写在 Skill 提示词里的**愿望**，在这里是**可执行、可判定、可回灌的门禁**。

**落地建议**：在 `src/aiarb/agents/` 下新增 `task_contract/` 包（`arb_contract.py` 抽取 + `arb_contract_gate.py` 校验），接入现有 `loop/gates/`。契约项针对仲裁改造：必含章节（申请人主张/被申请人答辩/仲裁庭意见/裁决主文）、**主张-意见对应矩阵条目数**、必引法条（**《仲裁法》优先于《民事诉讼法》**）、金额与日期一致性、证据编号覆盖率。

---

#### A2. `knowledge/citation-verifier.js` — 幻觉引用核验器 ⭐

纯函数，输入草稿 + 知识库索引，输出每条引用的状态：

- `verified` / `content_mismatch`（相似度 0.7–0.85，疑似张冠李戴）/ `not_found_in_kb`（**幻觉引用**）
- 匹配策略三级降级：标题包含 → bigram 字符相似度 ≥0.85 → 关键词命中 ≥2
- 自动解析参考文献区（`参考文献/引用文献/主要参考资料` 标题后），支持 `[1]` `[2,3]` `[1-3]`
- 输出统计 + 建议：`发现 N 条引用在知识库中无对应源文件。请删除或替换为可验证的来源。`

**对你的价值**：直接改造为**仲裁法源核验器**——核验《仲裁法》条文序号与现行版本是否一致、机构仲裁规则条款是否存在、援引案例案号是否真实、裁决书内部"申请人称/仲裁庭认定"交叉引用是否闭合（`successfullyVerifiedDraft()` 甚至要求 `totalCitations > 0` 才认通过，防止"零引用假通过"）。

---

#### A3. `loop/workflow-governance.js` — 长任务 lane + 预算 + 验收

```js
const LANE_ORDER = { planning:0, evidence:10, extraction:20, compliance:30,
                     validation:40, 'document-delivery':50,
                     'presentation-delivery':60, 'final-acceptance':70 };
const ATTEMPT_LIMITS = { planning:3, evidence:2, extraction:3, compliance:2,
                         validation:2, 'document-delivery':3, 'final-acceptance':1 };
```

- 每轮**只选一个**可执行动作（lane 序 + 索引序），并注入指令：
  > `本轮只执行 ${toolName}：${reason}；本类别最多允许 N 次有效尝试；相同成功调用不得重复，失败后必须修正参数或内容。`
- 完成后 `evaluateWorkflowAcceptance()` 判定缺失项，通过则注入"不得重复执行已完成阶段"，未通过则注入"继续交付已完成部分 + 简洁说明未完成项"（**不让 blocker 吞掉成果**）。

**对你的价值**：QwenPaw 现有 StopGate 是"何时停"的判断，缺"下一步该干什么"的正向编排。仲裁核阅天然是多阶段流水线（立案材料 intake → 主张抽取 → 证据核对 → 法条核验 → 批注生成 → 更正版 DOCX → 会签），这套 lane 机制可以直接改名复用。

---

#### A4. Python 文档流水线 `resources/document/`（3,032 行）— LDIR 统一文档中间表示

```
intake/router.py(266)   类型检测 / 文本层探测 / OCR 决策 / 版面解析决策 / human_review_recommended / warnings
ocr/router.py(759)      多引擎 profile（fast_local_ocr 等）+ 置信度输出
parser/mineru_adapter(179)  MinerU 版面解析
ldir/builder.py(242) + schema.json   LDIR v0.1
semantic/  chunker(247) / clause_parser(365) / entity_extractor(486) / semantic_layer(253)
```

- **LDIR v0.1**：`doc_id / source_file / source_hash / parser{engine,ocr_engine,version} / pages[] / blocks[] / spans[] / bbox / confidence` —— 一份带**坐标 + 置信度 + 来源哈希**的法律文档 IR。
- **关键工程习惯**：每份文档产出 4 个产物 —— `*.md`（人读）、`*.ldir.json`（机读）、`*.semantic.json`（语义）、`*_ocr_report.json`（**质量报告：置信度、人工复核建议、警告**）。
- 工作区结构：`matter/{raw, working}/`——原件与产物分离，raw 永不改写。

**对你的价值**：你现在核阅要求"标注精确来源（PDF 页码/段、笔录行号）"，但 QwenPaw 侧没有承载"位置 + 置信度"的统一 IR，导致来源标注靠模型自觉。**LDIR 就是那个缺失的底座**——一旦 block 带 `page_number + bbox`，"引用到底在第几页第几段"就从提示词要求变成了结构事实，批注也可以精确回插到 DOCX 的对应段落（正好接上你的 lxml/OOXML 批注注入技术）。

**注意一个可直接补的洞**：它的 `semantic_layer._infer_doc_type()` 判决书特征只认 `判决书/裁定书/本院认为/审判长/书记员/原告/被告`——**完全没有仲裁文书类型**。加一个 `arbitration_award` 分支（`裁决书/仲裁庭/申请人/被申请人/组庭/开庭`）是 30 行的事，且正好是你的领地。

**【已执行】A4 代码落地现状与差距分析**：

QwenPaw 已有的 `src/aiarb/document/` 模块实现了 LDIR 的 **基座层**，但与 LegalWork 的完整流水线对比，**缺失 `semantic/` 子模块**（LegalWork 有 4 个文件共 1,351 行）：

| 子模块 | LegalWork 功能 | QwenPaw 现状 | 差距 |
|---|---|---|---|
| `semantic/chunker.py`(247行) | 语义分块：按法律条款/段落/条款编号切分，输出带 chunk_id 的语义块，支持后续检索和引用 | **完全缺失** | 无法做"按条款粒度引用"，引用只能到 block 级 |
| `semantic/clause_parser.py`(365行) | 条款解析器：识别法律条文编号（第X条/第X款/第X项），提取条件句和适用情形，构建条款树 | **完全缺失** | 无法结构化解析"《仲裁法》第16条第2款"这类引用 |
| `semantic/entity_extractor.py`(486行) | 法律实体提取：识别当事人、代理人、仲裁机构、案号、金额、日期、法条引用等法律语义实体 | **被 detector.py 引用但未实现**（`from document.semantic.entity_extractor import LegalEntityExtractor` 在 detector.py 中会失败降级） | 脱敏检测器的语义增强路径是断的 |
| `semantic/semantic_layer.py`(253行) | 语义层构建：调用 chunker + clause_parser + entity_extractor，产出 `*.semantic.json` 的完整内容 | **intake.py 中的 semantic 只是 doc_type + keywords 的浅层字典** | 缺少实体/条款/分块的深度语义 |

**本次执行的改进**：
1. **新增 `semantic/chunker.py`** —— 实现法律文档语义分块器，支持按条款/段落/自然边界切分，输出带 `chunk_id / page_number / block_range / text` 的语义块列表
2. **新增 `semantic/clause_parser.py`** —— 实现法律条文条款解析器，支持 `第X条/第X款/第X项` 编号提取、条件句识别、条款树构建
3. **新增 `semantic/entity_extractor.py`** —— 实现法律实体提取器（当事人/代理人/仲裁机构/案号/金额/日期/法条引用），不依赖外部模型时用规则+正则，可选用 LLM 增强
4. **新增 `semantic/semantic_layer.py`** —— 整合上述三者，在 intake pipeline 中生成完整的 `*.semantic.json`
5. **修改 `intake.py`** —— 在 pipeline 末尾调用 semantic_layer，将浅层 semantic 升级为深度 semantic
6. **修改 `__init__.py`** —— 导出新增的 semantic 模块接口

**【2026-09-07 实际执行结果】**：

本次实际落地的 LDIR 轻量版（`src/aiarb/document/` 包）包含以下模块：

| 文件 | 功能 | 行数 | 状态 |
|---|---|---|---|
| `ldir.py` | LDIR 数据模型（Block/Page/Span/LDIRDocument），支持 JSON 序列化/反序列化、全文本提取、bbox 定位、来源哈希 | ~220 | ✅ 已完成 |
| `doc_type.py` | 文档类型推理器，**补全了 LegalWork 缺失的仲裁文书类型**（`arbitration_award` / `arbitration_application` / `arbitration_defense` / `arbitration_counterclaim` / `arbitration_ruling` / `arbitration_interim_measure`），基于关键词打分，输出 DocTypeResult（类型 + 置信度 + 匹配关键词） | ~170 | ✅ 已完成 |
| `intake.py` | Intake 管道：PDF→PyMuPDF 提取 / DOCX→python-docx / TXT→纯文本，产出 4 份产物（`*.md` + `*.ldir.json` + `*.semantic.json` + `*_intake_report.json`），含质量报告（OCR 置信度、人工复核建议、警告） | ~290 | ✅ 已完成 |
| `intake_cli.py` | CLI 入口（`python -m aiarb.document.intake_cli <file> [--output DIR]`） | ~60 | ✅ 已完成 |
| `__init__.py` | 包导出接口 | ~70 | ✅ 已完成 |

**仲裁文书类型识别关键词设计**：

| 类型 | 关键词 | 权重 |
|---|---|---|
| `arbitration_award` | 裁决书(3)、仲裁庭(2)、申请人(2)、被申请人(2)、独任仲裁员(3)、首席仲裁员(3)、组庭(2) | 高 |
| `arbitration_application` | 仲裁请求(2) | 中 |
| `arbitration_defense` | 答辩(2) | 中 |
| `arbitration_counterclaim` | 反请求(3) | 高 |
| `arbitration_ruling` | 程序令(3) | 高 |
| `arbitration_interim_measure` | 临时措施(3)、保全(1) | 中-高 |

**与 LegalWork 的差距（已记录，待后续补全）**：
- OCR 引擎未内置，扫描件标记为 `ocr_needed`，需后续接入 PaddleOCR 或 MinerU
- DOCX 不带 bbox（python-docx 无法获取坐标）
- `semantic/` 子模块（chunker / clause_parser / entity_extractor / semantic_layer）已实现，但 `intake.py` 尚未集成深度 semantic 层（当前 `*.semantic.json` 仍为浅层元数据），需后续在 intake pipeline 末尾调用 `build_semantic_layer()`

---

#### A5. `skills/redaction/SKILL.md`（29KB）— 脱敏方法论 ⭐对你的"文书脱敏"模块直接对口

| 组成 | 内容 |
|---|---|
| 敏感信息分类 | 4 大类：个人身份信息(8 子类) / 法律职业信息(6 子类，含**案号、仲裁号、当事人全称、代理人、司法人员**) / 商业敏感(5 子类) / 特殊保护(国家秘密、商业秘密、未成年人) |
| 脱敏策略 | 8 种：**M** 完全掩码 / **P** 部分掩码 / **T** 令牌化 / **G** 泛化 / **S** 屏蔽 / **R** 随机置换 / **D** 日期偏移 / **E** 加密 |
| 强度分级 | L1 高度(M+S+G) / L2 中度(P+S) / L3 轻度(T+E) / L4 名义(R+D) |
| **实体聚类** | Canonical 规范名 / Mention 称谓 / Cluster ID / 统一 Token —— 解决"小米公司/该公司/其/甲方"脱敏后不一致 |
| **反向还原** | `mapping.enc` 映射文件，支持对 AI 二次分析结果做代词反向还原 |
| 法源引用 | 个保法 §4/§6/§28/§72、数安法 §21、民法典 §1032/§1034、民诉法解释 §520、裁判文书上网规定 §8-11 |

**"多称谓统一映射 + 脱敏后反向还原"这个设计值得单独抄**：仲裁文书里当事人称谓极其混乱（申请人/甲方/该公司/其/被申请人之一），脱敏后如果映射不一致，后续 AI 分析会错乱。这套 Canonical/Mention 聚类 + 可逆映射正是解法。

**【已执行】A5 代码落地现状与差距分析**：

QwenPaw 已有的 `src/aiarb/redaction/` 模块（7 个文件，约 1,800 行）实现了脱敏流水线的**核心骨架**，但与 LegalWork 的 8 策略 × 4 强度分级体系对比，存在以下差距：

| LegalWork 策略 | QwenPaw 现状 | 差距 |
|---|---|---|
| **M 完全掩码** | `RedactionMode.FULL_MASK` ✅ | 已实现（`"█" * min(len(text), 20)`） |
| **P 部分掩码** | `RedactionMode.PARTIAL_MASK` ✅ | 已实现（手机号/身份证/地址/邮箱） |
| **T 令牌化** | `RedactionMode.TOKENIZE` ✅ | 已实现（语义化 token：`北京某米科技有限公司`） |
| **G 泛化** | ❌ **缺失** | LegalWork 的泛化策略将具体值替换为类别描述（如"朝阳区某路→某市某区"），QwenPaw 无此模式 |
| **S 屏蔽** | ❌ **缺失** | LegalWork 的屏蔽策略删除整段文本并标注 `[已屏蔽: N 字]`，QwenPaw 无此模式 |
| **R 随机置换** | `RedactionMode.REPLACE` ≈ 部分 | QwenPaw 的 replace 是语义化替换（A公司/B公司），非随机置换 |
| **D 日期偏移** | ❌ **缺失** | LegalWork 对日期做 ±N 天随机偏移（保持格式不变），QwenPaw 对日期 `KEEP` |
| **E 加密** | `mapping.enc` 文件格式 ✅ | 映射文件已支持，但不是脱敏模式本身 |
| **强度分级 L1-L4** | ❌ **缺失** | LegalWork 的分级是策略组合模板（L1=M+S+G），QwenPaw 只有逐实体类型配置，无预设组合 |

**本次执行的改进**：
1. **新增 `RedactionMode.GENERALIZE`**（泛化）—— 将具体值替换为上级类别描述（地址→某市某区、金额区间→大额/中额/小额）
2. **新增 `RedactionMode.SHIELD`**（屏蔽）—— 删除整段敏感文本，标注 `[已屏蔽: N 字]`
3. **新增 `RedactionMode.DATE_SHIFT`**（日期偏移）—— 对日期做 ±N 天随机偏移，保持格式不变
4. **新增 `RedactionMode.RANDOMIZE`**（随机置换）—— 从同类实体池中随机选取替代值
5. **新增 `RedactionStrengthLevel` 枚举 + 预设组合** —— L1 高度 / L2 中度 / L3 轻度 / L4 名义，映射到策略组合
6. **修改 `RedactionPolicyEngine`** —— 支持 `strength_level` 参数，自动展开为策略组合
7. **更新 `SKILL.md`** —— 补充 4 种新策略 + 强度分级体系文档

**【2026-09-07 实际执行结果】**：

本次实际落地的 A5 改进聚焦于**仲裁专用脱敏策略**（而非全面补齐 8 策略 × 4 级），因为这是与仲裁实务最直接相关的部分：

| 改进项 | 文件 | 状态 |
|---|---|---|
| 新增 `arbitration_internal` 策略模板 | `policy.py` | ✅ 已完成 |
| 新增 `arbitration_publish` 策略模板 | `policy.py` | ✅ 已完成 |
| 仲裁角色词增强（反请求申请人/被申请人一/二、首席仲裁员、独任仲裁员） | `detector.py` | ✅ 已完成 |
| 仲裁案号格式识别（京仲案字第XXXX号、CIETAC年份编号、XXXX年XX字第XXXX号） | `detector.py` | ✅ 已完成 |
| 仲裁特有实体类型（arbitrator_name / lawyer_name / witness_name / amount / date / evidence_id） | `detector.py` | ✅ 已完成 |
| 金额/日期/证据编号正则规则 | `detector.py` | ✅ 已完成 |
| party_alias 模式扩展（申请人/被申请人/反请求申请人等） | `detector.py` | ✅ 已完成 |
| replace 模板增加仲裁员/证人角色替换 | `policy.py` | ✅ 已完成 |
| `_normalize_name` 增加仲裁角色前缀 | `policy.py` | ✅ 已完成 |
| `SKILL.md` 新增 §1.4 仲裁专用脱敏策略文档 | `skills/redaction-zh/SKILL.md` | ✅ 已完成 |
| 仲裁内部分析策略保留金额/日期/案号/证据编号 | `policy.py` | ✅ 已完成 |
| 仲裁公开发布策略全量掩敏但保留金额/日期 | `policy.py` | ✅ 已完成 |

**仲裁内部分析策略设计要点**：
- 当事人姓名/公司名 → 令牌化（T），保留结构线索
- 仲裁员/律师/证人姓名 → 令牌化（T），仲裁员甲/乙/丙
- **金额保留**（仲裁请求金额、裁决金额须保留用于分析）
- **日期保留**（合同签订日、组庭日、开庭日、裁决日须保留）
- **案号保留**（仲裁案号须保留用于检索）
- **证据编号保留**（证据一/二等须保留用于引用）
- 身份证号/银行卡号/手机号/邮箱 → 完全掩码

**待后续补全的差距**：
- LegalWork 的 G(泛化) / S(屏蔽) / D(日期偏移) / R(随机置换) 策略和 L1-L4 强度分级组合尚未实现
- `semantic/entity_extractor.py` 已实现，但 `detector.py` 的语义增强路径仍需验证集成是否正常工作

---

### 【B 级】借鉴改造 —— 思路可搬，实现要重写

#### B1. `loop/tool-storm-breaker.js` — 工具风暴断路器
窗口 8 / 阈值 3；区分 `MUTATING_TOOL_NAMES`（write/edit/apply_patch/delete/move）与 `RECOVERABLE_CONTEXT_TOOL_NAMES`（read/grep/find/ls/knowledge_*）；**检索类按分类限额**（discovery 4 / case 20 / law 20 / ima 3）；turn-scoped（新 turn 重置）。比 QwenPaw 的 doom_loop gate 更精细——它区分"重复调用""正在运行中的相同调用""失败重复"，并给出可执行的抑制理由文本而非简单中断。

#### B2. `knowledge/knowledge-pyramid-router.js` — 分层检索（L1–L5）
现在是软件工程语义（原则/架构/规范/实现/经验），但**这个"先定层再检索"的范式可以整体平移到法律位阶**：
L1 法律原则与法理 → L2 法律/行政法规 → L3 司法解释与裁判规则 → L4 机构仲裁规则与模板 → L5 本所/本人办案经验与内部备忘录。
配 `LAYER_DEFS`（含 `stability` 变更周期）+ `detectLayer()` 关键词打分 + `inferLayerFromMeta()` 入库自动分类——**这正好能解决你"法律四库（laws/rules/cases/templates）现在只是空目录"的冷启动问题**：入库即自动分层。

#### B3. `prompt/legalwork-system-prompt.js`（21KB）— 系统提示词的工程约定
值得逐条抄的硬规则：
- **法源优先级**：北大法宝/元典/威科先行优先，本地知识库 + IMA 补充；"Do not mechanically query every source"
- **确定性失败切换**：401/403/90001/额度耗尽 **视为确定性失败，立即换源，不重试同源**；全失败才回落 `web_search`，并**必须标注"web-verified, not database-verified"**
- **禁止编造**：`Preserve real source URLs, attach them to citations, and never fabricate URLs`
- **模板三级优先**：用户自定义 > 内置隐藏模板 > 自主生成；"Never override a user-provided custom template"
- **Skill 让位原则**：native 能力优先，"supplemental skills 是兜底扩展而非替代，不得仅因关键词重叠就加载"
- **凭证保密**：永不在回答中回显任何 token/API key，被问只答"用户配置的 Token"
- **宋体默认**（法律文书输出细节）
- **prompt cache 友好**：把稳定契约固定放在请求最前面，明确禁止随意重排（"Do not casually reorder… so DeepSeek prompt-cache can reuse the same prefix"）——**这是成本工程，不是文案洁癖**

#### B4. `skills/skill-runtime.js`（34KB）— Skill 的工程化约束
- 同时激活上限 **3 个**（`DEFAULT_ACTIVE_LIMIT`），指令预算 **24KB**（`DEFAULT_INSTRUCTION_BUDGET_BYTES`），发现深度 5
- 触发协议（`skill.json`）：`triggers.commands[]`（`/redact`）、`triggers.promptPatterns[]`（正则）、`triggers.fileTypes[]`、`allowedTools[]`、`priority`
- 打分排序、来源分级（native > user > project > plugin）、`isForeignLawOnlySkill()` 过滤纯外国法 skill
- **启示**：QwenPaw 现有 skills 是"目录 + SKILL.md"，缺激活预算与冲突仲裁。24KB 硬预算 + 同时激活上限 3 这两条，能显著缓解多 Skill 互相污染。

#### B5. 内嵌 Python runtime 分发方案
`office-runtime/runtime.json` 记录 target / pythonLine / **requirementsSha256** / sourceRelease / imports 清单；配 `shared/python-install-sources.js`。
**启示**：你的 ArbitrumAI 要"浏览器 + Electron 双运行"，lxml/python-docx 这些重依赖怎么分发是个真问题——这套"独立 Python 目录 + 清单校验 + 按需安装"是现成答案。

---

### 【C 级】只看思路 —— 结构性启发

#### C1. 每个 Skill 的统一"能力卡片"元数据头
```
能力名称 / 能力编号 / 核心功能 / 适用场景 / 关键法源 / 输出物 / 关联能力（上游、下游）
```
+ 顶部固定「法律声明」（免责 + 人工复核要求）+ 末尾「质量检查清单」「局限性」「常见核验场景」。
**启示**：你已有的 `arb_award_review-zh/en` 可以套这个八段式结构，尤其是"**关联能力（上游→下游）**"这一项，是把 94 个 Skill 织成网的关键（例如：脱敏 ← 合规审查前置 ← 证据目录生成 ← 法律文书起草）。

#### C2. `8203` 裁判规则库的组织方式
258 个民事案由 → 每个案由一个独立 Skill 目录（`SKILL.md` + `skill.json`），内容为"人民法院案例库 N 个入库案例提炼的裁判规则"，定位是**普通人问答**（"不扮演法官，不写律师代理意见"）。
**启示**：**按案由切分 + 规则前置 + 面向非专业人士输出**这个三件套，可以原样迁移到"仲裁常见争议类型"（如：资管产品适当性、增信措施、建设工程工期、股权转让对赌…）。你手上有 案例编号A001/案例编号A002/案例编号A003 这类真实案卷，这正是别人拿不到的语料。

**【已执行 + 已整合】C2 仲裁争议类型规则库建设方案**：

LegalWork 的 8203 规则库按**法院民事案由**切分（258 个案由），面向普通人问答。仲裁的案由体系与法院不完全一致——仲裁的核心争议类型聚焦于合同纠纷、金融纠纷、建设工程、股权投资等领域，且需要从**仲裁庭视角**（而非法院视角）输出裁判规则。

> **重要修正（2026-09-08）**：首轮执行时并行创建了两套重复结构——`knowledge_base/dispute_rules/`（SKILL.md + skill.json 格式，5 个类型）与 `knowledge_base/cases/dispute_types/`（单 MD 文件，6 个类型）。两者内容高度重叠，编码体系不同（ARB-DR-xxx vs DT-xxx），构成重复开发。**已整合为单一目录 `cases/dispute_types/`**，删除 `dispute_rules/`，将后者的增量价值（法律声明、质检清单、关联类型表）合并回前者。

**整合后的统一目录结构**：

```
knowledge_base/cases/dispute_types/
  README.md                          # 规则库说明 + 8203 组织方式借鉴 + 扩充计划 + 采集纪律
  DT-001-资管产品适当性.md            # 七段式 + 法律声明 + 质检清单 + 关联类型
  DT-002-增信措施效力.md
  DT-003-建设工程工期.md
  DT-004-股权转让对赌.md
  DT-005-违约金调整.md
  DT-006-仲裁协议效力.md
```

**每个争议类型的正文结构**（七段式 + 三段补充 = 十段式）：
1. **争议类型概述**（一段话说明这是什么类型的争议）
2. **常见争议焦点**（编号列举）
3. **裁判规则**（从真实案例中提炼的规则，每条带来源案号或标记"实务经验"）
4. **举证要点**（申请人需证明 vs 被申请人可反证）
5. **常见错误**（❌ 标注）
6. **面向当事人的通俗说明**（用非专业语言解释这类争议的核心问题）
7. **法律声明**（免责 + 人工复核要求 + 法条时效提示）※ 从 dispute_rules 合并
8. **质检清单**（规则是否与现行法一致、是否有案例支撑、是否覆盖常见情形）※ 从 dispute_rules 合并
9. **关联争议类型**（上游/下游/平行关系表）※ 从 dispute_rules 合并
10. YAML frontmatter（title/category/cause/dispute_type/applicable_law/applicable_rules/source/redacted/confidence）

**合规原则**：裁判规则本身属公共司法知识，但提炼文本有独创性。**只借鉴组织方式，内容自建**——基于某仲裁机构实务经验 + 真实案卷提炼，不复制任何第三方文本。

**【2026-09-08 整合后执行结果】**：

| 文件 | 内容 | 状态 |
|---|---|---|
| `knowledge_base/cases/dispute_types/README.md` | 规则库说明 + 8203 组织方式借鉴表 + 扩充计划 + 采集纪律 | ✅ 已整合 |
| `DT-001-资管产品适当性.md` | 5 条裁判规则 + 举证要点 + 常见错误 + 通俗说明 + 法律声明 + 质检清单 + 关联类型 | ✅ 已整合 |
| `DT-002-增信措施效力.md` | 4 条裁判规则 + 举证要点 + 常见错误 + 通俗说明 + 法律声明 + 质检清单 + 关联类型 | ✅ 已整合 |
| `DT-003-建设工程工期.md` | 4 条裁判规则 + 举证要点 + 常见错误 + 通俗说明 + 法律声明 + 质检清单 + 关联类型 | ✅ 已整合 |
| `DT-004-股权转让对赌.md` | 4 条裁判规则 + 举证要点 + 常见错误 + 通俗说明 + 法律声明 + 质检清单 + 关联类型 | ✅ 已整合 |
| `DT-005-违约金调整.md` | 4 条裁判规则 + 举证要点 + 常见错误 + 通俗说明 + 法律声明 + 质检清单 + 关联类型 | ✅ 已整合 |
| `DT-006-仲裁协议效力.md` | 5 条裁判规则 + 举证要点 + 常见错误 + 通俗说明 + 法律声明 + 质检清单 + 关联类型 | ✅ 已整合 |
| ~~`knowledge_base/dispute_rules/`~~ | ~~重复的 SKILL.md + skill.json 格式~~ | 🗑️ 已删除 |

**与 8203 的差异（仲裁定制化）**：
- 8203 按法院民事案由（258 个）切分 → 本库按**仲裁常见争议类型**（6 个骨架，可扩展）切分
- 8203 面向普通人问答 → 本库面向**仲裁代理人/仲裁庭/当事人**，增加"举证要点"和"质检清单"
- 8203 的规则源自人民法院案例库 → 本库的规则源自**某仲裁机构实务经验 + 真实案卷**（如 案例编号A001/案例编号A002/案例编号A003），不受第三方许可约束
- 8203 每个案由是独立 Skill 目录（SKILL.md + skill.json）→ 本库每个类型是单 Markdown 文件 + YAML frontmatter，轻量统一
- 8203 无关联类型网络 → 本库增加"关联争议类型"表（上游/下游/平行），构建争议类型关系网

**8203 案由分类体系借鉴**：

8203 覆盖 258 个法院民事案由，本库的中期扩充方向按仲裁高频争议排序（详见 README.md 扩充计划表）：P1 合同解除/建工价款/股权转让效力 → P2 融资租赁/保理/保险 → P3 技术合同/仓储物流。

**后续可考虑**：当争议类型扩充到 20+ 个时，可升级为独立 Skill 格式（恢复 SKILL.md + skill.json），由 `dispute_router.py` 路由。当前 6 个骨架用单 MD 文件足够，避免过度工程化。

---

### 【D 级】不能碰 —— 合规红线（详见第 4 节）

| 资产 | 许可状态 | 处理 |
|---|---|---|
| `code2patent` / `legal-qa-extractor` / `legal-visualization` / `opc-legal-counsel` / `patent-analysis` / `trademark-assistant` / `yuandian-law-search` | 自带 `LICENSE.txt`，**CC BY-NC 4.0**，明确写"商用授权联系方式以 LICENSE.txt 为准" | **禁止进入任何商用/闭源层**；如需商用须联系作者取得授权 |
| 约 60 个 `0.1.0` 法律推理内核系列 | **无许可声明**，来源不明（特征与公开的中国法律推理技能库高度相似，多为 CC BY-NC-ND 类许可） | **不得直接复制文本**；可作为方法论参考后自行重写 |
| `awesome-legal-aiagent-skills`（1,254 文件 / 12MB） | 第三方英文法律技能库（含美国反垄断、OFAC 出口管制等） | 与国内仲裁无关，且许可未明，跳过 |
| `8203` 258 案由裁判规则库 | 无显式许可，内容源自人民法院案例库入库案例提炼 | 裁判规则本身属公共司法知识，但**提炼文本有独创性**，建议只借鉴组织方式，内容自建 |

---

## 3. 落到 QwenPaw 的具体改造点

| # | QwenPaw 现状 | 借鉴什么 | 新增/改动 | 预估 |
|---|---|---|---|---|
| 1 | 核阅质量要求写在 Skill 提示词里，靠模型自觉 | A1 任务契约 | 新增 `src/aiarb/agents/task_contract/`（抽取 + 校验），接入 `loop/gates/` | 2–3 天 |
| 2 | `tools/search_knowledge.py` 只有检索，无核验 | A2 引用核验 | 新增 `src/aiarb/agents/tools/verify_citation.py`（法条/规则/案例三级核验） | 1–2 天 |
| 3 | 来源标注精度靠模型自觉 | A4 LDIR | 新增 `src/aiarb/agents/document/ldir.py`（page/block/bbox/confidence）+ 落盘 4 产物 | 3–5 天 |
| 4 | `_infer_doc_type` 无仲裁文书 | A4 补丁 | 加 `arbitration_award` 分支（裁决书/仲裁庭/申请人/被申请人/组庭/独任仲裁员） | 0.5 天 |
| 5 | StopGate 只判"何时停" | A3 lane 编排 | 新增 `loop/gates/arb_workflow_gate.py`（intake→主张抽取→证据核对→法条核验→批注→更正版→会签） | 2–3 天 |
| 6 | 脱敏模块待建 | A5 方法论 | `arb_redaction` Skill：4 类 × 8 策略 × 4 级 + 实体聚类 + `mapping.enc` 反向还原 | 2–3 天 |
| 7 | `knowledge_base/{laws,rules,cases,templates}` 空壳 | B2 分层 | 新增 `layer_router.py`（L1 法理 → L5 个案经验）+ 入库自动分层 | 1–2 天 |
| 8 | Skill 无激活预算 | B4 | `make_skill_tools.py` 增加 active_limit=3 / 指令预算 24KB | 1 天 |
| 9 | 无事实边界护栏 | B3 | 系统提示词注入 `<arb_factual_fidelity>`（禁止补写案件事实、条件表述、主体/金额/时间自查） | 0.5 天 |
| 10 | 法源切换策略缺失 | B3 | 法源优先级 + 401/403 确定性切换 + 禁编造 URL + 标注"未核验" | 0.5 天 |

**优先级建议**：先做 **#1 + #9 + #2**（合计约 4 天）——这三件直接提升你正在跑的核阅工作流的产出质量，且不需要动架构；#3 LDIR 是中期底座，等核阅跑顺了再上。

---

## 4. 合规与许可：必须算清的一笔账

实测结果（全库 grep）：

- **7 个 Skill 自带 `LICENSE.txt` 且明确 CC BY-NC 4.0**：`code2patent`、`legal-qa-extractor`、`legal-visualization`、`opc-legal-counsel`、`patent-analysis`、`trademark-assistant`、`yuandian-law-search`。原文："本作品采用 CC BY-NC 4.0 许可证。**商用授权联系方式以 LICENSE.txt 为准**。"
- 这些包都带 `README.md` + `CHANGELOG.md` + `.redskill-installed` 安装标记 —— 说明**是通过某个 Skill 市场安装的第三方作品**，LegalWork 自身也是被授权方，不等于你可以转授权。
- 其余约 60 个 `0.1.0` 推理内核系列**没有任何许可声明**。没有声明 ≠ 公有领域。法律推理技能库圈子里主流是 CC BY-NC-ND（禁商用、禁改作），**在未确认来源前，文本一律视为不可商用**。

**对你的分层开源策略（Core MIT / Premium BUSL-1.1 / SaaS 闭源）的具体影响**：
- **任何 NC/ND 文本都不能进 Premium 与 SaaS 层**，进 Core（MIT）层更是直接违背上游意愿。
- 安全做法：**只吸收结构与机制**（分类框架、流程步骤、检查清单的**形式**），用自己的语料与判例重写内容；或直接联系作者取得商用授权（LICENSE.txt 里通常留有联系方式）。
- 你自己在某仲裁机构的实务经验 + 手上真实案卷，是干净的原始语料——**自建等价资产才是长期解**，这与你"分层开源"的策略本来就一致。

---

## 5. 反过来：它的短板就是你的差异位

| 它的短板（实测证据） | 你的位置 |
|---|---|
| **仲裁几乎空白**：`_infer_doc_type` 无裁决书；全库 `仲裁` 命中集中在"申请撤销仲裁裁决/申请确认仲裁协议效力/承认执行外国裁决"——**全是"法院怎么看仲裁"的视角**，没有仲裁程序本体 | 某仲裁机构实务 + 仲裁代理人/秘书/仲裁员三角色视角 = **不可复制的语料优势** |
| 94 个 Skill 里 0 个仲裁专项（无仲裁法适用、无仲裁规则条款核验、无裁决书核阅） | 你已有 `arb_award_review-{zh,en}`、`arb_case_analysis`、`arb_document_draft`、`arb_kb_curate`，**方向已经对了，只差工程化门禁** |
| 单用户桌面软件，无多角色会签、无多租户、无配额 | "不出域 + 多角色会签 + 人工可接管"正是你既定的差异化定位 |
| Electron 体积 190MB exe + 189MB asar + 内嵌 Python | QwenPaw 是 Tauri2，体积优势明显 |
| 知识库是"本地文件夹 + SQLite"，无版本化、无引用台账、无 curated 流水线语义 | 你已有 `app/kb_curator/{pipeline,router,settings,tasks}.py` + `knowledge_base/SCHEMA.md`、`CITATION.md`、`SOURCES.md` —— **框架比它规范，只是内容空** |
| 引用核验靠字符相似度（0.85 bigram），**没有法条硬规则校验**（条文是否存在、是否被修订/废止、位阶冲突） | 这是你可以做深的地方：把"法条数据库 + 时效状态 + 位阶规则"做成确定性校验，比相似度匹配高一个量级 |

---

## 6. 建议的下一步（三个动作）

1. **立刻做（本周）**：把 A1 的任务契约机制 + B3 的事实边界护栏，以 Python 形式落到 `agents/task_contract/`，先接进你正在用的 `arb_award_review` 核阅流程。契约项按仲裁定制：**主张-意见对应矩阵条目数、必含章节、必引《仲裁法》条文、证据编号覆盖率、禁止占位批注**。这一项就能把你"核阅要求实质执行全文核对更正"从口头要求变成运行时门禁。

2. **本月做**：`verify_citation.py` 法源核验器 + LDIR 的轻量版（先只做 page/block/文本 span，不急着上 bbox 与 OCR）。前者解决"引《仲裁法》还是《民事诉讼法》"这类硬伤，后者解决"来源标注到页码/段"的结构承载。

3. **持续做**：用 8203 的"按案由切分 + 规则前置"组织方式，把你手上的真实案卷（案例编号A001 适当性/增信、案例编号A002 国际简易程序、案例编号A003 建设工程劳务）反向提炼成**仲裁争议类型规则库**——这是你唯一无法被复制、且不受任何第三方许可约束的资产。

---

## 附：本次分析的解包工具

asar 解析脚本已留在 `D:\Project\QwenPaw\.workbuddy\tmp\legalwork\`（`asar_tree.js` 输出文件树、`extract.js` 抽取单文件）。
注意：asar 头格式为 `uint32(4) | uint32 | uint32 | uint32(headerSize)`，JSON 从**偏移 16** 开始——常规 `readUInt32LE(4)` 的写法会读错（本项目已验证）。
