# 项目长期笔记：QwenPaw（AIArb fork）

## 身份
- 阿里 AgentScope 团队 **QwenPaw** 的 fork，非自研。pip 包名 `aiarb`，Apache 2.0，v2.2.0b5。
- 远端 origin：github.com/AIArbHub/QwenPaw　上游 upstream：github.com/agentscope-ai/QwenPaw
- 工作分支：`arb260901-2`（历史 arb 系列分支）

## 定位方向
把通用个人 Agent 工作台改造成**仲裁垂直**方向（与用户 ArbitrumAI / AI Arb 品牌一致）。
差异化定位建议：**"不出域的仲裁文书工作台"**（本地优先 + 多角色会签 + 人工可接管）。

## 关键结构
- `src/aiarb/` 32 万行；`app/`（渠道、API、crons、kb_curator、group_chats）、`agents/`（agent 循环、context/scroll、memory、skills、tools）
- 上下文：`agents/context/scroll/manager.py` — Scroll Context，持久化不摘要
- 循环控制：`loop/gates/` — StopGate（budget/completion/doom_loop/rubric/limits/iteration）
- 法律化资产：`knowledge_base/`（四库，目前空壳）、`agents/skills/kb_arbitration-{zh,en}`、`agents/tools/search_knowledge.py`、`app/kb_curator/`（策展流水线）
- 前端：`console/` React18 + Vite + antd5 + zustand + Tauri2；文档站 `website/` Vite + Tailwind4 + shadcn

## 已定决策（2026-09-07）
1. 目标用户 = 仲裁员 / 律师 / 仲裁秘书**个人**（非机构）→ 多租户、计费、等保/ISO 27001 全部降级 P2+
2. 数据边界 = 仲裁规则公开可内置；案例走公开源（临时仲裁、采安仲裁公众号等）；**以用户本地上传为主**
3. fork 策略 = **b+a**（本地 patch + 定期 rebase），不抽离独立包
4. 技术路线 = 只做**数据层 / 规则层 / 应用层**，不训模型、不微调

## 关键路径
- 规范文档：`knowledge_base/SCHEMA.md`（文档头）、`SOURCES.md`（版权边界）、`CITATION.md`（引用与防幻觉）
- Skill：`agents/skills/arb_award_review-{zh,en}`（核心）、`arb_case_analysis`、`arb_document_draft`、`arb_kb_curate`
- fork 维护：`docs/fork-maintenance.md`
- 同步工具：`scripts/sync_kb_scaffold.py`（知识库 seed 只补缺失，规范文件需此脚本同步到 ~/.aiarb）
- 方法论资产：`docs/methodology/裁决书AI双轨协同写作方法-机构规则框架下.md`（用户自撰，211 行）

## 重要事实
- 真实数据在**用户本地** `~/.aiarb/knowledge_base/`（12 份 PDF + parsed/desensitized + _wiki），**不在仓库里**；仓库内 knowledge_base 是空壳。评估进度时两边都要看。
- 内置技能目录自动发现，但需在 Console → 技能 导入 pool 后才生效。
- 双轨协同核心边界：结构化数据（案号、当事人、程序节点、费用数额）**不得由 AI 生成**，只做格式与表述；AI 只用于诉辩归纳、事实梳理、说理辅助、文字优化。
- **AI 意见背书（法发〔2026〕10号，2026-09-07）第19条**：诉讼参与人提交 AI 生成的诉讼文书、案例检索报告等须先核实真实准确 + 说明 AI 辅助情况 + 对真实性担责——这是"AI 辅助+人核终审"双轨模式的司法背书，对裁决核阅与法律 AI 工具定位有强制约束。
- **新法时间轴（防止用过时版）**：仲裁法 2025 修订 2026-03-01 施行；新公司法 2024-07-01 施行（88条第1款不溯及）；建工解释（二）法释〔2026〕12号 2026-06-30 施行；民间借贷利率上限=LPR 4倍（2020 二修版）。
- 知识库 laws/rules/templates 已由空壳补成实质库：仲裁法+民诉法+纽约公约+民法典各编核心+约 15 部司法解释全文（含最新 AI 意见/建工解释二/公司法时间效力）。

## 已知风险
1. **Fork 漂移**：上游日更（PR 已 #7438），本地已改 20 文件，合并成本滚雪球
2. 法律四库为空 → 有检索入口无内容，产出会降级成通用大模型水平
3. 无多租户 / 计费 / 配额 / 合规认证，阻断机构级落地
4. 覆盖率门禁 50%，近半代码无回归保护

## 竞品参照
- **AlphaClaw（iCourt）**：OpenClaw 底座 + 6 亿法律数据 + 205 Skill + 30 万法律人；重心在诉讼，**仲裁空白**
- **Harvey**：$11B 估值 / $190M ARR / 2.5 万定制 Agent；无中文、无中国仲裁、无自助定价
- **OpenClaw**：389k star，生态成熟度远高于 QwenPaw（35k）；QwenPaw 优势在国内渠道与本地模型
- **LegalWork 0.3.30**（本地已解包分析，详见 `docs/legalwork-0.3.30-复用分析.md`）：Electron + 内嵌 Python + 六边形架构的诉讼向法律 Agent，94 Skill + 258 案由裁判规则库。**可复用的是机制不是语料**：任务契约（prompt→机器可校验门禁）、引用核验、lane 编排、LDIR、脱敏方法论。7 个 skill 为 CC BY-NC 4.0，60 个来源不明，均不可商用。其仲裁空白（无裁决书类型、无法条硬规则校验）正是本项目差异位。
