# LegalWork `main` 源码深度对比分析

> 对比对象：
> - **A. `legalwork-0.3.30-win-x64`**（上一轮拆解的打包二进制，解包在 `resources/app.asar.unpacked/legalwork/dist/`）
> - **B. `D:\Project\legalwork-main`**（本轮分析的未打包开源**源码仓库**）
> - **C. QwenPaw / ArbitrumAI**（你方项目，复用视角）
>
> 结论先行：B 是 A 的**开源源码版**，可读性、完整度、许可证清晰度都远优于 A。但许可证（PolyForm Noncommercial 1.0.0）构成对商用复用的硬红线——这把上一轮"抄机制不抄语料"的建议进一步收紧为"只学不抄 / 谈授权 / clean-room 自研"。

---

## 0. 一句话定位

`legalwork-main` = LegalWork 的 **GitHub 开源源码仓库**（monorepo：Electron 桌面端 + 内嵌 TS 运行时 + Python OCR/脱敏/技能流水线 + 93 个技能包）。0.3.30 是它某个时间点的**打包成品**。源码版的真正价值不在"更多功能"，而在于：① 许可证与来源彻底透明；② 机制以带类型与注释的源码呈现，可精确学习；③ 暴露了打包版看不出的新增层（delegation / data-compliance / review / 缓存-前缀纪律）。

---

## 1. 许可证：决定"能不能抄"的红线（本轮最关键发现）

`LICENSE` 开头即 PolyForm Noncommercial License 1.0.0，第 9–11 行：

> Commercial use, commercial distribution, SaaS or hosted service use, resale, or integration into commercial products requires a **separate written commercial license** from the copyright holder.

第 14–18 行还注明：教育/公益教学机构可用于**非商业**的教学、研究、课程、实验、学习/参考，**但不得 pass-through**（不能向下游客户/合作伙伴/商业项目/托管服务/再分发/再许可延伸）。并声明"Portions derived from Kun (KunAgent/Kun)"。

### 对 ArbitrumAI（商用 SaaS / Premium-BUSL / 闭源）的含义

| 行为 | 是否允许 |
|------|----------|
| 读源码、学习架构、写分析报告（你正在做的） | ✅ 明确允许（noncommercial reference/learning） |
| 把任何 `.ts`/`.py` 代码并入 ArbitrumAI | ❌ 需版权方**单独书面商用授权** |
| 复用 `skills/` 下 93 个技能（含 8203 案由库）的文案/语料 | ❌ 同上；且 8203 等多数技能来源不明，叠加 NC/ND 风险 |
| 仅借鉴**设计思想/算法思路**做干净重写（clean-room） | ⚠️ 灰色但惯例可接受——思想不受版权保护，但需避免复制表达层（注释/结构/命名） |
| 联系版权方谈商业授权后使用 | ✅ 唯一合规的商用路径 |

**对上一轮建议的修正**：上一轮结论是"抄机制不抄语料"。现在许可证把整个仓库（含机制代码）都罩在 NC 下——**机制也不能直接抄**。正确姿态变为三条之一：① 只学不改写进产品；② 谈商业授权；③ 按本文档提炼的设计，**独立 clean-room 实现**（这正是 QwenPaw 本就走的"b+a 本地 patch + 定期 rebase"路线，应坚持）。

---

## 2. 仓库形态对比：main 源码 vs 0.3.30 打包版

| 维度 | 0.3.30 打包版 | main 源码版 |
|------|--------------|------------|
| 形态 | Electron 二进制 + `app.asar.unpacked` 内 compiled JS | monorepo 源码（TS + Python），`git` 不可用（git log 退出 128） |
| 许可证 | 未随包暴露 | **PolyForm NC 1.0.0**（`LICENSE` 53KB，含 Kun 派生声明） |
| 文档 | 无 | `CLAUDE.md`(9KB) / `DESIGN.md`(Vercel 设计系统) / `PROJECT_STRUCTURE.md` / `README.md`(70KB) |
| 运行时语言 | 内嵌 CPython **3.11.16** | `requirements.txt` 目标 **3.12**（paddlepaddle 3.3.1 / paddleocr 3.7 / PyMuPDF 1.27） |
| 主程序结构 | `dist/loop` `dist/knowledge` `dist/prompt` `dist/contracts` `dist/skills` | `apps/desktop-legalwork/legalwork/src/` 完整六边形分层 |
| 技能数量 | 94 个（含 8203） | 91 个顶层 + `8203`（257 个案由裁判规则库，515 文件） |
| 仲裁相关 | 仅法院视角（撤销裁决、确认协议效力、承认执行外国裁决） | 同上 + 8203 案由库有"仲裁程序案件/申请撤销仲裁裁决/申请承认和执行外国仲裁裁决"等**知识条目**，但**无裁决书起草/核阅 skill** |
| 新增层（源码独有） | — | `delegation/`（子代理编排）、`services/data-compliance-task-service.ts`（自带 Python venv）、`review/`、`cache`/`telemetry`、`loop/token-economy.ts`、`loop/auto-model-router.ts`、`knowledge/legal-external-search.ts`（直连人大法库 NPC） |
| 脱敏/ OCR | `document/`、`redaction/` 已是 Python 包 | 同源，且 `redact_agent.py` 已抽出独立 CLI（`text/file/pdf/batch/detect/eval/restore`） |

---

## 3. 架构：六边形，与打包版一致，源码层更完整

`CLAUDE.md` §4.2 把依赖方向写成不可逆铁律：

```
contracts/(zod) → domain/(纯函数) → ports/(抽象) → cache → telemetry
  → adapters/(实现) → services/(用例编排) → loop/(AgentLoop/ContextCompactor/SteeringQueue)
  → server/(HTTP·SSE) → cli
```

纪律要点（源码证伪了"随手改"）：
- 加新事件/实体/错误类型，先写 `contracts/` 的 zod schema，再逐层向下。
- `domain/` 不得引用 `ports/services/adapters`；`contracts/` 不得碰 `node:fs`/数据库驱动。
- 单一运行时：`legalwork serve` 是唯一 agent 边界，Renderer 只经 `dsGui.runtimeRequest` / `startSse` 通信（删除了 Agent 切换器、provider selector 等 UI）。

**新增/增强层（打包版未见或不可读）**：
- `delegation/delegation-runtime.ts`：`ChildRunRecord` + `ChildRunExecutor`，父线程派生子代理并聚合 usage（含 `cacheHitTokens`/`tokenEconomySavings`）。
- `services/data-compliance-task-service.ts`：数据合规模块，**自带 Python venv 管理**（要求 3.10–3.12），任务类型 `product_type: 'review' | 'desensitize'`。
- `review/` + `services/review-service.ts`：独立 review 提示词与编排（复用 AgentLoop + ContextCompactor + ImmutablePrefix + SteeringQueue）。
- `loop/token-economy.ts`：工具输出上限常量（`MAX_READ_LINES=320`、`MAX_COMMAND_LINES=180`）+ concise 指令，`usage-service.recordTokenEconomySavings` 回写节省量。
- `knowledge/legal-external-search.ts`：直连 **全国人大法库 NPC**（`flk.npc.gov.cn`），与系统提示词的"法律库优先级"闭环。

---

## 4. 四个最值钱的可复用机制（源码确认，带锚点）

### 4.1 文档任务契约 — `loop/document-task-contract.ts`
把用户自然语言需求**编译成机器可校验契约**。关键设计（源码可见注释与类型）：
- `DocumentTaskContract` 类型（`:3-19`）：`minimumContentCharacters / requiredHeadings / requiredTopicTerms / minimumCaseCount / minimumReferenceCount / recentReferenceCutoffYear / requireLegalNormContent / forbidPlaceholders / requiredKnowledgePdfReads / requiresDesensitization`。
- `documentFactualFidelityInstruction`（`:72-85`）：明确"**只能把用户明确提供、附件记载或工具已核验的内容写成既成事实；不得自行补写用户未提供的事实；生成终稿前逐项检查事实主语、义务主体、金额和时间，避免把甲乙方写反**"——这正是你核阅方法论的代码版。
- `forbidPlaceholders`（`:214`）：正则拦截"禁止/不得/不允许 + 省略号/占位符"，`validateDocumentContent`（`:259-319`）机械校验 TBD/TODO/待补充/待完善/此处省略/内容略/详见下文。
- `successfullyVerifiedDraft`（`:363-390`）：要求 `knowledge_citation_verify` 工具 `verificationPassed===true` 且 `totalCitations>0`——**零引用假通过被显式拒绝**。

### 4.2 引用核验器 — `knowledge/citation-verifier.ts`
纯函数（文件头标注 `no I/O, no side effects`）。状态机：`verified | not_found_in_kb | content_mismatch | page_number_suspicious | doi_mismatch`。用 bigram 相似度匹配 KB 文档。**但它是论文向**——解析 `[1][2,3]` 注码 + GB/T 7714 参考文献（`:62,130,154`）。对裁决书场景要改造：把"注码+文献"换成"法条引用+案号引用"，把字符相似度换成**法条/案号硬规则校验**（它目前做不到，是缺口）。

### 4.3 事实核验 — `loop/fact-verification.ts`
把"核实事实"变成可审计账本：`FactVerificationContract`（`:7-13`）+ `validateFactVerificationLedger`（`:244-289`，逐条要求 `statement/verdict/rationale/evidence` 且 evidence 必须有已读取 URL）。`requiresFreshWebSearch`（`:34-45`）区分"时效性前提"与"可选质量门"——避免把时效问题降级成软建议。这对你"事实性回复每条标来源"的要求高度同构。

### 4.4 工具风暴断路器 — `loop/tool-storm-breaker.ts`
`ToolStormBreaker` 类（`:40`）：turn 作用域内的 repeat-loop 守卫。窗口内同 `(toolName, arguments)` 达阈值即抑制（`:130-141`）；研究类工具按 `discovery/case/law/ima` 配额（默认 4/20/20/3，`DEFAULT_RESEARCH_LIMITS` `:28-33`）；`onCompaction()` 允许压缩后恢复只读调用（`:173-182`）。`apply_agent_loop.py` 还揭示了 `isRepeatedNoToolAssistantText` + `charBigramDiceSimilarity` 守卫——打击"我接下来要做 X"式空转循环（`:133-157`）。

### 4.5 脱敏流水线 — `redaction/*`（**最对口你的脱敏模块**）
自包含 Python 包，质量显著高于一般开源脚本：
- `redaction/detector.py`：多方法检测（regex/dictionary/semantic/ner），**实体类型含 `party_alias`（当事人代称）** + `ROLE_KEYWORDS`（原告/被告/申请人/被申请人/甲方/乙方…）+ `PARTY_PRONOUNS`（该公司/其/对方…），并为后续 coreference 聚类预留 `cluster_id`/`alias_of`（`:49-50,76-80`）。
- **关键豁免逻辑**：`_is_public_legal_norm_reference`（`:509-540`）显式**不把公开法律规范标题当隐私脱掉**；`_is_judicial_institution`（`:504-507`）排除法院/检察院/仲裁委员会/公证处。这正好对应你"仲裁裁决书脱敏但不能脱掉法条与仲裁机构"的边界需求。
- `redaction/policy.py`：三策略 `external_client / internal_legal_analysis / public_release` + 五模式 `MASK/REPLACE/TOKENIZE/FULL_MASK/PARTIAL_MASK`。
- `redaction/restorer.py` + `*.mapping.enc`：脱敏后可**反向还原**（同一主体多称谓统一还原）。
- `redaction/renderer_pdf.py`：基于 LDIR bbox 的 **PDF 坐标级涂黑**。
→ 这套是你能"借鉴设计、clean-room 自研"的最佳样本，且仲裁/商事场景的边界它已经想清楚了。

### 4.6 知识层与缓存 — `knowledge/*` + `cache/*`
- `knowledge-sqlite-index.ts`：后端 **sqlite-fts5**，索引内保存 `documentHash`/`sourceMtimeMs` 用于 sync 变更检测。
- `knowledge-retrieval-pipeline.ts`：确定性 **RRF 倒数排名融合**（`RRF_K=60`，非模型改写 query），`MAX_CONTEXT_CHARS=8000 / MAX_SOURCES=12`。
- `cache/immutable-prefix.ts` + `context-compactor.ts` + `request-history-hygiene.ts`：稳定可缓存前缀（tools canonical sort + schema 指纹），每次 model step 前 `verifyImmutablePrefix()` 校验，**静默漂移直接抛 drift 错误**；实测热命中 94–98%。

---

## 5. "仲裁空白"——在源码版依旧是空白（你的护城河）

逐一核验：
- `README.md` 中"仲裁"仅命中 **2** 处，"裁决书 / 仲裁裁决 / 商事仲裁"命中 **0**。
- 顶层**无独立 arbitration skill**；8203 案由库仅有"仲裁程序案件 / 申请撤销仲裁裁决 / 申请承认和执行外国仲裁裁决 / 申请确认仲裁协议效力 / 认可执行港澳台裁决"等**知识条目**，不是起草/核阅能力。
- `templates/embedded-legal-document-templates.ts` 仅 `complaint | answer` 两类、11 个高频诉讼案由（保证保险/机动车/劳动/离婚/金融借款/买卖/民间借贷/融资租赁/信用卡/物业/证券虚假陈述）——**无裁决书模板**。
- 引用核验只做字符相似，**无法条/案号硬规则校验**（见 4.2）。
- `prompt/legalwork-system-prompt.ts` 的文档类型识别 `_infer_doc_type` 仍只认"判决书/裁定书/本院认为/审判长/原告/被告"。

结论：它把仲裁当"法院程序的另一端"来处理，而你手上的**商事仲裁裁决书核阅 + 三角色（代理人/秘书/仲裁员）视角 + 本地案卷**，是它结构性拿不到的东西。

---

## 6. 与 QwenPaw / ArbitrumAI 的复用结论（修正版）

### 6.1 许可红线（必读）
**不要复制任何 LegalWork 代码或技能语料进 ArbitrumAI。** 仅两种合规路径：① 联系版权方取得书面商用授权；② 按本文档提炼的设计做独立 clean-room 实现。

### 6.2 可"借鉴设计、自研实现"的清单（概念层，非代码层）
| 机制 | 落点（QwenPaw 现有） | 自研建议 |
|------|----------------------|----------|
| 文档任务契约（`document-task-contract.ts`） | `loop/gates/StopGate` 只管"何时停" | 新增"交付前机械门禁"：最少字数/必含章节/禁止占位符/事实边界指令——直接对齐你核阅要求 |
| 事实边界指令（`documentFactualFidelityInstruction`） | 核阅 skill v1.6 已有类似要求 | 把"不得自行补写事实/避免甲乙写反"固化为运行时注入 |
| 脱敏 party_alias 聚类 + 法律规范豁免（`detector.py`） | 你的脱敏模块 | clean-room 复刻：当事人代称聚类 + 法条/仲裁机构豁免 |
| 工具风暴断路器（`tool-storm-breaker.ts`） | — | 抄思路不抄码：turn 内同参去重 + 研究配额 |
| 缓存前缀纪律（`immutable-prefix.ts`） | — | 若做本地长上下文，借鉴"稳定前缀 + 漂移即报错" |
| 引用核验架构（`citation-verifier.ts`） | — | 改造为**法条/案号硬校验器**（LegalWork 的弱项，正是你的强项） |

### 6.3 不可直接用的
- 任何 `.ts`/`.py` 源文件（PolyForm NC）。
- `skills/` 下 93 个技能文案与 8203 案由库（来源不明 + NC/ND 风险）。
- `knowledge-base/experience-sharing/`：只是其团队内部 Wiki（价值观/案件准备/法律调研…），**非法律语料**，无复用价值。

---

## 7. 下一步建议（落到执行）

1. **先定授权策略**：若打算长期借鉴，让法务评估"联系版权方谈商业授权"vs"纯 clean-room 自研"的成本。这是所有后续动作的前置决策。
2. **自研三件套（约 1–2 周，不动架构）**，直接抬升你现有核阅产出：
   - 交付前机械门禁（字数/章节/占位符/事实边界）——对齐 4.1
   - 法条/案号硬规则引用核验器（补 LegalWork 缺口）——对齐 4.2 改造方向
   - 脱敏 party_alias 聚类 + 法律规范豁免（对齐 4.5，最对口）
3. **护城河加固**：把"商事仲裁裁决书核阅 + 三角色视角"做成 QwenPaw 独有 skill 族，填补 LegalWork 空白；其 8203 案由库的组织方式（按案由切分 + 规则前置）可借鉴**结构**但绝不复制**内容**。
4. 本仓库继续作为"机制设计参考库"保留——它的六边形纪律、缓存前缀、工具断路器，都是你 rebase 上游时值得对照的工程范式。

---

## 附：关键路径速查（main 源码版）
- 许可证 / 架构纪律：`LICENSE`、`CLAUDE.md`、`PROJECT_STRUCTURE.md`
- 文档契约：`apps/desktop-legalwork/legalwork/src/loop/document-task-contract.ts`
- 引用核验：`apps/desktop-legalwork/legalwork/src/knowledge/citation-verifier.ts`
- 事实核验：`apps/desktop-legalwork/legalwork/src/loop/fact-verification.ts`
- 工具断路器：`apps/desktop-legalwork/legalwork/src/loop/tool-storm-breaker.ts`
- 脱敏流水线：`redaction/detector.py`、`redaction/policy.py`、`redaction/pipeline.py`、`redaction/restorer.py`
- 知识/缓存：`knowledge/knowledge-store.ts`、`knowledge/knowledge-sqlite-index.ts`、`knowledge/knowledge-retrieval-pipeline.ts`、`cache/immutable-prefix.ts`
- 子代理/合规/Review：`delegation/delegation-runtime.ts`、`services/data-compliance-task-service.ts`、`services/review-service.ts`
- 技能运行（真运行时）：`apps/desktop-legalwork/legalwork/src/skills/skill-runtime.ts`（977 行）；根 `skill_engine/runner.py` 仅是 prompt 模板加载器（残留硬编码路径 `/Users/xiangyang/Desktop/legalwork/skills`）
