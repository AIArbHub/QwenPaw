# QwenPaw（AIArb fork）项目体检与竞品对比分析

日期：2026-09-07　｜　分支：`arb260901-2`　｜　上游：`agentscope-ai/QwenPaw`（v2.2.0b5）
结论性质：只分析，不改动代码

---

## 0. 一句话结论

**这是一个成熟度很高的通用 Agent 底座（32 万行 Python + 18.4 万行前端），但法律化只做到了"约束层"，没做到"数据层"。**
横向对比，它的底座能力与 AlphaClaw、Harvey 同代甚至更完整；但垂直壁垒（法律数据、领域工作流、分发渠道）三项几乎为零——这三项恰恰是法律 AI 真正的胜负手。
最致命的事实：`knowledge_base/laws|rules|cases|templates` 四个库合计 **2.5 KB，全是 README 占位**。

---

## 1. 项目本体

### 1.1 它是什么

| 项 | 事实 |
|---|---|
| 身份 | 阿里 AgentScope 团队 QwenPaw 的 fork，远端 `AIArbHub/QwenPaw`，上游 `agentscope-ai/QwenPaw` |
| 原项目 | QwenPaw = Qwen Personal Agent Workstation，Apache 2.0，GitHub 约 35k star，pip 包 `aiarb` |
| 当前版本 | v2.2.0b5（上游 PR 编号已到 #7438，迭代极高频） |
| 本地状态 | 分支 `arb260901-2`，**20 个文件未提交**（+707 / −48 行），无未跟踪新文件 |
| 已做改造 | 见 1.3 |

### 1.2 规模

| 部分 | 规模 |
|---|---|
| `src/aiarb/` | **321,583 行 Python**，38 个顶层模块；`app/` 95,332 行、`agents/` 82,310 行（占 55%） |
| `console/` | 184,198 行 / 965 文件（React 18 + Vite + antd 5 + zustand + i18next，Tauri 2 桌面端） |
| `tests/` + `e2e/` | 259,203 + 34,942 行（测试与源码接近 1:1） |
| `plugins/` | 257,028 行 / 793 文件，5 类（apps / bundle / channel / tool / middleware） |
| `website/` | 168 篇 md 文档，Vite + Tailwind 4 + shadcn/ui |

### 1.3 已经完成的法律化改造（有价值，但都停在"引导层"）

| 改造 | 位置 | 完成度 |
|---|---|---|
| 共享知识库四库（laws/rules/cases/templates） | `src/aiarb/knowledge_base/` | **空壳**，仅 README + INDEX.md（2.5 KB） |
| 仲裁知识库检索 Skill | `agents/skills/kb_arbitration-{zh,en}/SKILL.md` | 单文件提示词，规定"先检索、不得编造法条、标注依据" |
| 知识库检索工具 | `agents/tools/search_knowledge.py` | **已实现**，可从全局目录 + `knowledge_paths` 只读根检索 |
| KB Curator 策展人 | `app/kb_curator/`（928 行） | 已实现：staging → 大模型整理 → outbox → 按类目发布入四库；本次本地改动 +136 行 |
| 系统提示强制约束 | `app/migration.py:1354` | 明写"涉及法条/仲裁规则/机构程序/案例/模板先检索，**严禁凭记忆编造**" |
| 群聊 Human-in-the-Loop | `app/group_chats/runtime.py`（+104 行） | 双控制点拦截、Pending Registry、inject/interrupt/edit API |
| 多聊天架构 | console 前端 | URL 驱动标签栏 + 单运行时切换 |

判断：检索通道、策展流水线、防幻觉约束都通了，**唯一缺的是内容本身**。这是好消息——管道已就绪，灌数据即可见效。

---

## 2. 架构：真正的亮点

1. **Scroll Context**（`agents/context/scroll/manager.py`，2,025 行）
   每轮对话 write-through 落 sqlite，超阈值后中段进 EvictionIndex、保留尾段，recall 时按索引回捞——**不做有损摘要**。这一点对法律场景极关键：裁决书核阅要求逐字可追溯，任何"总结掉"的上下文都是事故。
2. **Loop Engineering / StopGate**（`loop/gates/`，2,327 行）
   budget / completion / doom_loop / rubric / limits / iteration 等门控可组合，Mission Mode 支持长程自主任务。AlphaClaw 宣传的"自主拆解任务"在这里有同等实现。
3. **四平台 Sandbox + 五层安全**：Seatbelt / Bubblewrap+Landlock / Windows AppContainer，加 Tool Guard、File Guard、Skill Scanner、Access Policy。法律数据敏感，这是硬指标。
4. **ReMe 三层记忆**：MEMORY.md 文件层 → 轻量 ReMe → 云端长期；配合 Scroll 构成"不遗忘"。
5. **渠道与端**：17+ IM 渠道（钉钉/飞书/企业微信/QQ/微信…）+ Tauri 桌面 + Textual TUI + 38 个 model provider。国内渠道覆盖是它相对 OpenClaw 的明确优势。
6. **工程素养**：TODO/FIXME 仅 42 处，bare except 为 0。

---

## 3. 工程债与风险

| 风险 | 证据 | 影响 |
|---|---|---|
| **Fork 漂移（最大风险）** | 上游日更，PR 已到 #7438；本地已自建 20 文件改动 | 合并成本滚雪球，一次大版本升级可能数人日 |
| **巨型文件耦合** | `deprecated_browser/browser_control.py` 5,629 行、`config/config.py` 3,904 行、`dingtalk/channel.py` 3,845 行、`matrix/channel.py` 3,488 行 | 改动局部功能易牵连 |
| **覆盖率门禁偏低** | `fail_under=50`，注释承认 CI 实测 51.59% | 近半代码无回归保护 |
| **依赖 kitchen-sink** | 56 个主依赖（playwright / transformers / onnxruntime / modelscope / pywebview / 9+ 渠道 SDK） | 安装体积、启动速度、攻击面 |
| **死代码** | `deprecated_browser/` 5,884 行仍打包发布 | 无谓负担 |
| **无多租户 / 计费 / 配额** | 全局搜索无 tenant / billing / subscription / quota 实现 | 直接阻断 SaaS 化 |
| **A2A 未通用化** | 仅 xiaoyi 渠道私有实现 | 跨框架互操作弱 |
| 宽泛 `except Exception` | 1,609 处（占 0.5%，非裸捕获） | 存在静默吞错点 |

---

## 4. 竞品格局

### 4.1 Harvey（美国，企业级法律 AI）

- 估值 **$11B**（2026-03，GIC + Sequoia 领投，$200M），累计融资 $1.22B
- ARR **$1.9 亿**（2025 年底）→ $190M（2026-01）；13 万+ 律师、1,300 组织、60+ 国、AmLaw 100 中 60–75 家
- 产品：Assistant / Vault（单库 1 万份批量分析）/ Knowledge / **Harvey Agents（25,000+ 定制 Agent）** / Contract Intelligence / Command Center / Shared Spaces / M365 集成（2026-06）
- 护城河：律所合作训练数据（A&O、Reed Smith）+ **嵌入式法律工程师团队** + SOC 2 II / ISO 27001 / ISO 42001 / GDPR + iManage / NetDocuments / SharePoint / Westlaw / LexisNexis 深度集成
- 软肋：**无自助、无公开定价**（约 $1–1.2K/user/月）、部署 4–12 周、**不覆盖中文与中国仲裁**、数据 residency 无中国大陆

### 4.2 AlphaClaw（iCourt，最直接竞品，也是最好对标）

- 2026 年 8 月上线，"法律龙虾"，**基于 OpenClaw 开源底座**（工作区路径 `~/.openclaw-alphaclaw/workspace`）——与本项目"QwenPaw 底座 + 仲裁知识"**完全同一路径**
- 四大能力：全生态工具调度（Alpha 数据库 / AlphaGPT / 律所 OA / AlphaNote）/ **Skill 商店 205 个**（官方 15 + 校友共享 77 + 全球精选 113，含清华智能法治研究院授权）/ AI 知识库 + 长期记忆 + 自我复盘 / 定时任务（heartbeat + cron）
- 资产：**6 亿+ 法律大数据**、AlphaGPT（北京网信办大模型备案）、13 年、30 万法律人、近 2 万家律所
- 场景覆盖：案件材料智能阅读、文书起草与校对（区分"必须修改"/"建议修改"）、多视角合同审查、类案检索
- **已开放免费试用**，且有《法律 Agent 及 Skill 搭建指南》做市场教育
- **软肋：产品重心在诉讼**（起诉状 / 答辩状 / 证据 / 类案），**仲裁几乎空白**——Skill 库中仅"法律/诉讼可视化"顺带提了一句适用于仲裁

### 4.3 底座层：QwenPaw vs OpenClaw

| | QwenPaw | OpenClaw |
|---|---|---|
| Star | 35k | 389k |
| 语言 / 许可 | Python，Apache 2.0 | TypeScript，NOASSERTION |
| 发布节奏 | 1 天 | 4 天 |
| 渠道 | 钉钉/飞书/QQ/微信/企微（国内强） | WhatsApp/Telegram/Slack/Teams（国际强） |
| 定位 | Team-ready，支持多工作区 | Solo-first |
| 插件生态 | 成长期 | 成熟 |
| 安全分 | 72 | 72 |

---

## 5. 对比总表

| 维度 | **AIArb（本项目）** | **AlphaClaw** | **Harvey** |
|---|---|---|---|
| Agent 底座 | 强（QwenPaw，32 万行，Scroll+StopGate+Sandbox） | 强（OpenClaw） | 强（自研） |
| 法律数据 | **0**（四库空壳） | **6 亿+ 条** | 判例 + Westlaw/LexisNexis + 客户语料 |
| 领域工作流 | **1 个引导 Skill** | **205 个 Skill** | **25,000 定制 Agent + 法律工程师** |
| 分发渠道 | 无 | 30 万法律人 / 2 万律所 | AmLaw 100 中 60 家 / 500+ 法务部 |
| 垂直模型 | 无 | AlphaGPT（已备案） | 律所专属训练 |
| 合规认证 | 无（仅本地部署优势） | 大模型备案 | SOC 2 II / ISO 27001 / 42001 / GDPR |
| 商业化 | **无计费/配额/多租户** | 免费试用 + 订阅 | 企业合同，六位数/年 |
| 数据主权 | **最强**（纯本地，可私有化） | 云端为主 | 云端（EU/US/AU residency） |
| 开源可控 | **Apache 2.0，可任意改造** | 闭源 | 闭源 |
| 中文 / 中国仲裁 | 有场景理解，**无数据** | 强（但偏诉讼） | **无** |

---

## 6. 优劣势判断

### 优势（真实、可打）

1. **本地优先 + 数据不出域**：仲裁案件材料保密性要求极高，某仲裁机构/仲裁员场景不可能接受把未决裁决书上传到第三方云。这是 Harvey 结构性做不到、AlphaClaw 不愿做的点，是唯一能正面打的牌。
2. **上下文无损（Scroll Context）**：裁决书核阅要求逐字逐句、可回溯到 PDF 页码，Scroll 的"不摘要、只索引"比任何 summarization 方案都更契合。
3. **群聊 HITL 已落地**：多角色（申请人/被申请人/仲裁庭）多方交互 + 人工接管/编辑/审批按钮——这天然就是仲裁庭合议与文书会签的形态，别人没有。
4. **KB Curator 策展流水线已通**：数据灌入有自动化通道，不是纯人工搬砖。
5. **开源可改**：Apache 2.0，不受供应商路线图限制。

### 劣势（必须正视）

1. **四库空壳**是头号问题：有检索入口没内容，Agent 再"不得编造"也答不准，实际产出必然降级为通用大模型水平。
2. **只有 1 个仲裁 Skill** vs AlphaClaw 205 个：工作流 Know-how 未产品化。
3. **零商业化基建**：无多租户、无计费、无配额、无权限体系（Hub 只有单机 admin token）。
4. **Fork 维护成本**：上游日更 + 本地已改 20 文件，漂移风险持续放大。
5. **无合规背书**：SOC 2 / ISO 27001 / 等级保护均无，进入机构客户会被卡。
6. **底座非差异化**：底座能力三家同代，且 OpenClaw 生态（389k star）比 QwenPaw（35k）成熟一个数量级——底座选谁都不构成壁垒。

---

## 7. 战略建议（按优先级）

**1）放弃通用法律 AI，锁死"仲裁垂直"。**
通用赛道 AlphaClaw 有 6 亿数据 + 205 Skill + 30 万用户，正面无胜算。但仲裁是它的空白：机构规则（CIETAC / 某仲裁机构-BIAC / SHIAC / HKIAC / ICC / SIAC）、程序令、裁决书核阅、仲裁庭合议——这些它都没有。Harvey 在中国更无覆盖。**仲裁是两家巨头之间的真空。**

**2）最快见效的动作：灌数据，别再写代码。**
管道（search_knowledge + KB Curator + 防幻觉约束）已经全通。按 `INDEX.md` 既定规范灌入：
- `laws/`：《仲裁法》《民事诉讼法》《民法典》合同编、承认与执行（纽约公约）
- `rules/`：CIETAC 2024、某仲裁机构/BIAC、SHIAC、HKIAC、ICC、SIAC 现行规则（注意机构版权，先用公开文本 + 自撰摘要）
- `cases/`：从你已有的 案例编号A001 / 案例编号A002 / 案例编号A003 核阅成果反推裁判要旨与争议焦点（脱敏后）
- `templates/`：仲裁申请书、答辩书、程序令、裁决书模板
这是把"引导层"变成"能力层"的唯一路径，见效速度远快于任何功能开发。

**3）把你的核阅方法论变成 Skill，而不是停留在文档。**
"裁决书核阅 v1.6"的方法论（逐字核对、来源标注到 PDF 页码/段、双方主张↔证据交叉核对、引《仲裁法》不引《民诉法》、实质更正版 DOCX）应当落成 3–5 个可执行 Skill。这正好是别人拿不走的资产，也是从"1 个 Skill"追近"205 个 Skill"的唯一杠杆——比数量比不过，比深度可以。

**4）把"本地优先 + 群聊 HITL"做成主叙事。**
对外不打"法律 AI"，打**"不出域的仲裁文书工作台"**：材料本地处理、多角色会签、人工可接管每一步。这是 Harvey 与 AlphaClaw 结构性无法复制的定位，且直接命中仲裁保密刚需。

**5）fork 策略：走 b+a（本地 patch + 定期 rebase）。** 已定，见第 8 节。关键是配套纪律：法律化改动优先"新增文件"而非"修改上游文件"，patch 面最小化，以降低 rebase 冲突。

**6）商业化基建：降级为后置项。** 目标用户是个人（仲裁员/律师/秘书），不是机构——**多租户、组织、计费、等保/ISO 27001 全部降为 P2 之后**。个人工具阶段只需：单机数据备份、导出、用量可见。等进入机构客户再补。

---

## 8. 决策（2026-09-07 已定）

### 决策 1：目标用户 = 仲裁员 / 律师 / 仲裁秘书（**个人**）

- **不做**机构内部部署，因此**砍掉**多租户、组织体系、计费配额、等保/ISO 27001 认证（原建议 6 降级为 P2+）。
- 产品形态：**个人专业工具（prosumer）**，单机运行、本地优先、数据不出域。
- 直接影响：
  - "数据主权"从加分项升为**核心卖点**——个人用户的未决案件材料同样不能上云。
  - 群聊 HITL 的语义要调整：不是"机构会签流程"，而是**单人驱动的多角色推演**（一人分饰申请人/被申请人/仲裁庭做对抗式核阅）。这个用法对个人价值极高，且仍是竞品空白。
  - 获客路径：不走机构采购，走个人口碑 + 专业社群（仲裁员圈层、律师社群）。

### 决策 2：数据来源与版权边界

| 数据 | 来源策略 | 版权判定 |
|---|---|---|
| 仲裁规则文本 | 各机构官网公开发布，**可直接内置** | 机构公开文本，无实质障碍；入库时登记来源 URL + 版本日期 |
| 案例数据 | ①公开渠道检索（临时仲裁、采安仲裁公众号等）②**以用户本地上传为主** | 公开案例仅入库**事实与要旨的结构化整理**，不整篇复制原文 |
| 用户自有材料 | 本地上传，不出域 | 用户自有，敏感性最高，仅本地处理 |
| 法条 | 官方发布文本 | 法律法规不受著作权保护，可内置；但编排与注释需注意 |

- **执行纪律（写入 CITATION.md）**：所有入库文件头部必须有来源、机构、版本/施行日期、适用地域四项元数据；无来源即不入库。
- **绝不凭记忆生成法条/规则条文**——这是本项目自身 `migration.py:1354` 的硬约束，数据灌入时必须遵守。

### 决策 3：fork 走 **b+a**（本地 patch + 定期 rebase）

不抽离成独立包（放弃方案 c），保留直接改底座的灵活性。代价是需要纪律约束，见 `docs/fork-maintenance.md`：
- 法律化改动优先**新增文件**（skills、knowledge_base、docs），尽量不改上游热点文件
- 每轮 rebase 前先导出 patch 清单，冲突集中在 `config.py` / `runtime.py` / `channel.py` / `provider_catalog.py`
- 通用性修复尽量回馈上游（a 的部分），减少长期持有

### 决策 4：只做**应用层 + 数据层 + 规则层**，不训模型

- 不训练、不微调。能力全部来自：检索增强（RAG over 本地知识库）+ 工作流 Skill + 提示词约束。
- 这与 AlphaClaw 的 AlphaGPT 不构成正面冲突——它的优势在数据量，我们的优势在**垂直深度 + 本地不出域**。
- 模型层保持 provider 中立（已有 38 个 provider），用户自备 API Key 或本地模型。

### 决策后的三个战略调整

1. **优先级重排**：灌数据（P0）→ 核阅 Skill（P0）→ 案例/模板库（P1）→ 多角色推演（P1）→ 商业化（P2+）。
2. **主叙事定为"个人仲裁文书工作台（不出域）"**，而非"法律 AI 平台"。
3. **关键成功指标改为**：能否用真实裁决书跑通"上传 → 核阅 → 批注 DOCX → 修订建议"闭环，而不是功能数量。

---

## 附：数据来源

- 项目代码与 git 历史（本地 `arb260901-2` 分支，2026-09-07 状态）
- Harvey：harvey.ai 官网及融资公告、The AI Agent Index、HokAI 评测、招商证券行业研报
- AlphaClaw：iCourt 法秀产品文、中国日报网、新华报业网、腾讯网（2026-08/09）
- QwenPaw vs OpenClaw：clawclones.com 对比、topbusinesssoftware、CSDN 评测
