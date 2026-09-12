---
name: arbitration-moot-simulation
description: >-
  模拟仲裁技能：组织多个内置仲裁智能体（仲裁员、申请人、被申请人、仲裁秘书）进行模拟仲裁庭审，以上帝视角评判案件可能的走向，评估胜诉率、各方主体表现，并生成美观的结构化报告。当用户需要模拟仲裁、模拟庭审、预测案件走向、评估胜诉率、组织模拟法庭时触发。
metadata:
  aiarb:
    emoji: "⚖️"
  requires:
    require_bins: []
    require_envs: []
tags: ['仲裁核心', '案件分析']
---

# 模拟仲裁技能

## 概述

本技能通过编排 AIArb 内置的四个仲裁智能体，模拟一场完整的商事仲裁庭审过程。默认智能体作为**庭审导演**，依次调度各角色智能体发言，最终以**上帝视角**综合评判案件走向、胜诉概率与各方表现，并输出结构化的美观报告。

---

## 适用场景

### 应该使用

- 用户需要模拟仲裁庭审过程
- 用户想预测案件的走向和可能结果
- 用户需要评估各方胜诉率
- 用户想对比不同策略下的仲裁结果
- 用户要求组织模拟法庭/模拟仲裁
- 用户提到"模拟仲裁""模拟庭审""案件推演""胜诉率评估"

### 不应使用

- 用户只想了解仲裁程序知识（直接回答即可）
- 用户需要撰写裁决书（使用 `arbitration-award-drafting` 技能）
- 用户需要核阅裁决书（使用 `arbitration-award-review` 技能）
- 案件材料严重不足，无法构成有效模拟（应先要求用户补充材料）

---

## 前置条件

### 必需的内置智能体

本技能依赖以下四个内置仲裁智能体，由 AIArb 自动创建：

| 智能体 ID | 名称 | 角色定位 |
|---|---|---|
| `arbitrator` | 仲裁员 | 居中裁判，审查证据、认定事实、适用法律 |
| `claimant` | 申请人 | 从申请人立场出发，主张请求、举证质证 |
| `respondent` | 被申请人 | 从被申请人立场出发，抗辩防御、反诉质证 |
| `casemanager` | 仲裁秘书 | 程序管理、记录要点、维持庭审秩序 |

### 必需的工具

- `list_agents()` — 查询可用智能体
- `chat_with_agent(...)` — 与各智能体进行对话编排
- `write_file(...)` — 输出最终报告文件

---

## 工作流程

> **核心原则：导演式编排，逐轮推进，上帝视角总结**

---

### 阶段一：案件材料接收与结构化

**目标**：将用户提供的案件材料结构化为模拟仲裁的输入。

**步骤**：

1. 接收用户提供的案件材料（仲裁申请书、答辩书、证据清单、合同文本等）
2. 提取关键信息并结构化：
   - **案件基本信息**：案由、仲裁请求、反诉请求（如有）
   - **当事人信息**：申请人、被申请人基本信息
   - **争议焦点**：归纳核心争议点（1-5 个）
   - **证据清单**：各方主要证据及证明目的
   - **法律适用**：涉及的主要法律条文
3. 形成结构化的《案件摘要表》，作为后续各智能体的输入

**输出**：内部记录案件摘要，不单独输出给用户

---

### 阶段二：庭审准备

**目标**：通知各智能体角色，使其进入模拟庭审状态。

**步骤**：

1. 调用 `list_agents()` 确认四个内置智能体可用
2. 依次向各智能体发送庭审准备通知：

```text
list_agents()

chat_with_agent(
  to_agent="casemanager",
  text="[Agent default requesting] 模拟仲裁庭审准备。案件信息如下：[案件摘要]。请你作为仲裁秘书，准备庭审程序安排，确认庭审流程、时限和注意事项。",
)

chat_with_agent(
  to_agent="claimant",
  text="[Agent default requesting] 模拟仲裁庭审准备。案件信息如下：[案件摘要]。请你作为申请人代理人，准备陈述意见、举证方案和主要论点。",
)

chat_with_agent(
  to_agent="respondent",
  text="[Agent default requesting] 模拟仲裁庭审准备。案件信息如下：[案件摘要]。请你作为被申请人代理人，准备答辩意见、抗辩方案和主要论点。",
)

chat_with_agent(
  to_agent="arbitrator",
  text="[Agent default requesting] 模拟仲裁庭审准备。案件信息如下：[案件摘要]。请你作为仲裁员，审阅案件材料，归纳争议焦点，准备庭审调查提纲。",
)
```

3. 记录各智能体的准备回复
4. 从 `casemanager` 的回复中提取庭审程序安排
5. 从 `arbitrator` 的回复中提取归纳的争议焦点

**重要**：
- 每次对话都要记录返回的 `[SESSION: ...]` 中的 `session_id`
- 后续同角色的对话需传入对应的 `session_id` 以保持上下文
- 如果智能体不可用，告知用户需要先初始化仲裁智能体

---

### 阶段三：模拟庭审（核心环节）

**目标**：按照标准仲裁庭审程序，编排各智能体依次发言，完成模拟庭审。

#### 庭审程序（严格按照以下顺序）

**第一环节：开庭准备与身份核实**

```text
chat_with_agent(
  to_agent="arbitrator",
  session_id="<仲裁员session_id>",
  text="[Agent default requesting] 请主持开庭程序：宣布开庭、核实当事人身份、告知仲裁权利义务、询问回避申请。",
)
```

**第二环节：申请人陈述**

```text
chat_with_agent(
  to_agent="claimant",
  session_id="<申请人session_id>",
  text="[Agent default requesting] 请陈述仲裁请求、事实与理由。注意：清晰列明请求项、事实依据和法律依据。",
)
```

**第三环节：被申请人答辩**

```text
chat_with_agent(
  to_agent="respondent",
  session_id="<被申请人session_id>",
  text="[Agent default requesting] 请进行答辩。针对申请人的仲裁请求，提出抗辩意见和事实理由。如有反诉，一并提出。",
)
```

**第四环节：举证质证（多轮）**

交替进行申请人和被申请人的举证与质证：

```text
# 申请人举证
chat_with_agent(
  to_agent="claimant",
  session_id="<申请人session_id>",
  text="[Agent default requesting] 请出示你的证据，说明证据名称、来源、证明目的。",
)

# 被申请人质证
chat_with_agent(
  to_agent="respondent",
  session_id="<被申请人session_id>",
  text="[Agent default requesting] 请对申请人刚才出示的证据进行质证。从真实性、合法性、关联性三个维度发表意见。",
)

# 被申请人举证
chat_with_agent(
  to_agent="respondent",
  session_id="<被申请人session_id>",
  text="[Agent default requesting] 请出示你的证据，说明证据名称、来源、证明目的。",
)

# 申请人质证
chat_with_agent(
  to_agent="claimant",
  session_id="<申请人session_id>",
  text="[Agent default requesting] 请对被申请人刚才出示的证据进行质证。从真实性、合法性、关联性三个维度发表意见。",
)
```

**第五环节：仲裁庭调查**

```text
chat_with_agent(
  to_agent="arbitrator",
  session_id="<仲裁员session_id>",
  text="[Agent default requesting] 请进行仲裁庭调查。就案件事实中的疑点向当事人发问，梳理需要进一步查明的事实。",
)
```

**第六环节：辩论**

```text
# 申请人辩论
chat_with_agent(
  to_agent="claimant",
  session_id="<申请人session_id>",
  text="[Agent default requesting] 请发表辩论意见。围绕争议焦点，从事实认定和法律适用两个层面展开论述。",
)

# 被申请人辩论
chat_with_agent(
  to_agent="respondent",
  session_id="<被申请人session_id>",
  text="[Agent default requesting] 请发表辩论意见。围绕争议焦点，从事实认定和法律适用两个层面展开论述。",
)
```

**第七环节：最后陈述**

```text
chat_with_agent(
  to_agent="claimant",
  session_id="<申请人session_id>",
  text="[Agent default requesting] 请发表最后陈述。",
)

chat_with_agent(
  to_agent="respondent",
  session_id="<被申请人session_id>",
  text="[Agent default requesting] 请发表最后陈述。",
)
```

**第八环节：庭审小结**

```text
chat_with_agent(
  to_agent="casemanager",
  session_id="<仲裁秘书session_id>",
  text="[Agent default requesting] 请做庭审小结：确认庭审程序已完成，归纳庭审要点，宣布闭庭。",
)
```

**重要规则**：
- 每个环节完成后，简要记录该环节的要点
- 如某一环节需要多轮（如多组证据的质证），可重复调用
- 注意传递正确的 `session_id` 以保持各角色的上下文连续性
- 不要在角色之间混淆 session_id

---

### 阶段四：上帝视角综合评判

**目标**：以中立的上帝视角，综合庭审全过程，评判案件走向、胜诉率和各方表现。

**步骤**：

1. 整理各环节记录，形成完整的庭审纪要
2. 向仲裁员智能体请求评议意见：

```text
chat_with_agent(
  to_agent="arbitrator",
  session_id="<仲裁员session_id>",
  text="[Agent default requesting] 庭审已结束。请你作为仲裁员进行评议：1) 事实认定结论；2) 法律适用分析；3) 裁决意见（含对各仲裁请求的支持/驳回意见）；4) 裁决主文草案。请使用请求权基础分析方法。",
)
```

3. 以**上帝视角**（而非任何单一角色），综合分析：
   - 案件整体走向预判
   - 各方胜诉率评估
   - 各方主体表现评价
   - 关键影响因子分析
   - 风险提示

---

### 阶段五：生成结构化报告

**目标**：将上帝视角的分析结果输出为美观的结构化报告。

**输出格式**：生成 HTML 格式的报告文件（可浏览器打开），同时生成 Markdown 版本。

#### HTML 报告模板

报告需包含以下模块，使用美观的卡片式布局：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>模拟仲裁报告 - [案件名称]</title>
    <style>
        :root {
            --primary: #1a56db;
            --primary-light: #dbeafe;
            --success: #059669;
            --success-light: #d1fae5;
            --warning: #d97706;
            --warning-light: #fef3c7;
            --danger: #dc2626;
            --danger-light: #fee2e2;
            --neutral: #6b7280;
            --neutral-light: #f3f4f6;
            --bg: #f8fafc;
            --card: #ffffff;
            --border: #e5e7eb;
            --text: #1f2937;
            --text-secondary: #6b7280;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
            background: var(--bg);
            color: var(--text);
            line-height: 1.8;
            padding: 24px;
        }
        .container { max-width: 900px; margin: 0 auto; }
        .header {
            background: linear-gradient(135deg, #1e3a8a, #1a56db);
            color: white;
            padding: 40px 32px;
            border-radius: 16px;
            margin-bottom: 24px;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
        }
        .header h1 { font-size: 28px; margin-bottom: 8px; }
        .header .subtitle { opacity: 0.85; font-size: 15px; }
        .header .meta {
            display: flex;
            gap: 24px;
            margin-top: 16px;
            font-size: 14px;
            opacity: 0.8;
        }
        .header .meta span::before { content: "● "; }
        .card {
            background: var(--card);
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
            border: 1px solid var(--border);
        }
        .card-title {
            font-size: 18px;
            font-weight: 700;
            margin-bottom: 16px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .card-title .icon {
            width: 28px; height: 28px;
            border-radius: 8px;
            display: flex; align-items: center; justify-content: center;
            font-size: 14px;
        }
        /* 胜诉率仪表盘 */
        .win-rate-container {
            display: flex;
            gap: 24px;
            flex-wrap: wrap;
        }
        .win-rate-item {
            flex: 1;
            min-width: 200px;
            text-align: center;
            padding: 20px;
            border-radius: 12px;
            border: 1px solid var(--border);
        }
        .win-rate-bar {
            width: 100%;
            height: 12px;
            background: var(--neutral-light);
            border-radius: 6px;
            margin: 12px 0 8px;
            overflow: hidden;
        }
        .win-rate-fill {
            height: 100%;
            border-radius: 6px;
            transition: width 0.6s ease;
        }
        .win-rate-fill.claimant { background: var(--success); }
        .win-rate-fill.respondent { background: var(--danger); }
        .win-rate-value { font-size: 32px; font-weight: 800; }
        .win-rate-label { font-size: 14px; color: var(--text-secondary); }
        /* 评分卡片 */
        .score-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 16px;
        }
        .score-item {
            text-align: center;
            padding: 16px;
            border-radius: 10px;
            background: var(--neutral-light);
        }
        .score-item .label { font-size: 14px; color: var(--text-secondary); margin-bottom: 8px; }
        .score-item .value { font-size: 24px; font-weight: 700; }
        .score-item .stars { font-size: 14px; margin-top: 4px; }
        /* 表格 */
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 14px;
        }
        th, td {
            padding: 12px 16px;
            text-align: left;
            border-bottom: 1px solid var(--border);
        }
        th {
            background: var(--neutral-light);
            font-weight: 600;
            color: var(--text-secondary);
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        tr:hover { background: var(--neutral-light); }
        /* 标签 */
        .badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
        }
        .badge-success { background: var(--success-light); color: var(--success); }
        .badge-warning { background: var(--warning-light); color: var(--warning); }
        .badge-danger { background: var(--danger-light); color: var(--danger); }
        .badge-neutral { background: var(--neutral-light); color: var(--neutral); }
        /* 进度时间线 */
        .timeline { position: relative; padding-left: 24px; }
        .timeline::before {
            content: '';
            position: absolute;
            left: 8px; top: 0; bottom: 0;
            width: 2px;
            background: var(--border);
        }
        .timeline-item {
            position: relative;
            padding: 0 0 20px 16px;
        }
        .timeline-item::before {
            content: '';
            position: absolute;
            left: -20px; top: 4px;
            width: 12px; height: 12px;
            border-radius: 50%;
            background: var(--primary);
            border: 2px solid white;
            box-shadow: 0 0 0 2px var(--border);
        }
        .timeline-item .title { font-weight: 600; font-size: 15px; }
        .timeline-item .desc { font-size: 14px; color: var(--text-secondary); margin-top: 4px; }
        /* 信息块 */
        .info-block {
            padding: 12px 16px;
            border-radius: 8px;
            margin-bottom: 8px;
        }
        .info-block.primary { background: var(--primary-light); border-left: 4px solid var(--primary); }
        .info-block.success { background: var(--success-light); border-left: 4px solid var(--success); }
        .info-block.warning { background: var(--warning-light); border-left: 4px solid var(--warning); }
        .info-block.danger { background: var(--danger-light); border-left: 4px solid var(--danger); }
        .footer {
            text-align: center;
            padding: 24px;
            color: var(--text-secondary);
            font-size: 13px;
        }
        @media (max-width: 600px) {
            .win-rate-container { flex-direction: column; }
            .header .meta { flex-direction: column; gap: 4px; }
        }
    </style>
</head>
<body>
<div class="container">

    <!-- 报告头部 -->
    <div class="header">
        <h1>⚖️ 模拟仲裁报告</h1>
        <div class="subtitle">[案件名称] — 上帝视角案件推演</div>
        <div class="meta">
            <span>模拟日期：[日期]</span>
            <span>案由：[案由]</span>
            <span>仲裁机构：[仲裁机构名称]</span>
        </div>
    </div>

    <!-- 案件概况 -->
    <div class="card">
        <div class="card-title"><span class="icon">📋</span> 案件概况</div>
        <table>
            <tr><th>项目</th><th>内容</th></tr>
            <tr><td>申请人</td><td>[申请人信息]</td></tr>
            <tr><td>被申请人</td><td>[被申请人信息]</td></tr>
            <tr><td>仲裁请求</td><td>[仲裁请求摘要]</td></tr>
            <tr><td>反诉请求</td><td>[反诉请求摘要或"无"]</td></tr>
            <tr><td>争议焦点</td><td>[争议焦点列表]</td></tr>
            <tr><td>涉及法律</td><td>[主要法律条文]</td></tr>
        </table>
    </div>

    <!-- 胜诉率评估 -->
    <div class="card">
        <div class="card-title"><span class="icon">📊</span> 胜诉率评估</div>
        <div class="win-rate-container">
            <div class="win-rate-item">
                <div class="win-rate-label">申请人胜诉率</div>
                <div class="win-rate-value" style="color: var(--success);">[X]%</div>
                <div class="win-rate-bar"><div class="win-rate-fill claimant" style="width: [X]%"></div></div>
            </div>
            <div class="win-rate-item">
                <div class="win-rate-label">被申请人胜诉率</div>
                <div class="win-rate-value" style="color: var(--danger);">[Y]%</div>
                <div class="win-rate-bar"><div class="win-rate-fill respondent" style="width: [Y]%"></div></div>
            </div>
        </div>
        <div style="margin-top: 16px;">
            <div class="info-block primary">
                <strong>胜诉率分析：</strong>[对胜诉率分布的专业分析，包括影响胜诉率的关键因素]
            </div>
        </div>
    </div>

    <!-- 案件走向预判 -->
    <div class="card">
        <div class="card-title"><span class="icon">🎯</span> 案件走向预判</div>
        <div class="timeline">
            <div class="timeline-item">
                <div class="title">最可能裁决路径</div>
                <div class="desc">[对案件最可能裁决结果的详细描述]</div>
            </div>
            <div class="timeline-item">
                <div class="title">替代裁决路径</div>
                <div class="desc">[次要可能的裁决结果及触发条件]</div>
            </div>
            <div class="timeline-item">
                <div class="title">关键转折点</div>
                <div class="desc">[可能导致裁决方向变化的关键因素]</div>
            </div>
        </div>
    </div>

    <!-- 各方主体表现评价 -->
    <div class="card">
        <div class="card-title"><span class="icon">👥</span> 各方主体表现评价</div>
        <table>
            <tr>
                <th>评价维度</th>
                <th>申请人</th>
                <th>被申请人</th>
                <th>仲裁员</th>
            </tr>
            <tr>
                <td>法律论证</td>
                <td><span class="badge [等级]">[评分]</span></td>
                <td><span class="badge [等级]">[评分]</span></td>
                <td><span class="badge [等级]">[评分]</span></td>
            </tr>
            <tr>
                <td>证据组织</td>
                <td><span class="badge [等级]">[评分]</span></td>
                <td><span class="badge [等级]">[评分]</span></td>
                <td>—</td>
            </tr>
            <tr>
                <td>策略运用</td>
                <td><span class="badge [等级]">[评分]</span></td>
                <td><span class="badge [等级]">[评分]</span></td>
                <td>—</td>
            </tr>
            <tr>
                <td>庭审表现</td>
                <td><span class="badge [等级]">[评分]</span></td>
                <td><span class="badge [等级]">[评分]</span></td>
                <td><span class="badge [等级]">[评分]</span></td>
            </tr>
            <tr>
                <td>综合评分</td>
                <td><strong>[X]/10</strong></td>
                <td><strong>[X]/10</strong></td>
                <td><strong>[X]/10</strong></td>
            </tr>
        </table>
        <div style="margin-top: 16px;">
            <div class="info-block success">
                <strong>申请人亮点：</strong>[申请人在庭审中的突出表现]
            </div>
            <div class="info-block danger">
                <strong>申请人不足：</strong>[申请人在庭审中的不足之处]
            </div>
            <div class="info-block success">
                <strong>被申请人亮点：</strong>[被申请人在庭审中的突出表现]
            </div>
            <div class="info-block danger">
                <strong>被申请人不足：</strong>[被申请人在庭审中的不足之处]
            </div>
        </div>
    </div>

    <!-- 争议焦点分析 -->
    <div class="card">
        <div class="card-title"><span class="icon">🔍</span> 争议焦点深度分析</div>
        <div class="timeline">
            <div class="timeline-item">
                <div class="title">焦点一：[焦点标题]</div>
                <div class="desc">
                    <strong>申请人主张：</strong>[申请人观点]<br>
                    <strong>被申请人抗辩：</strong>[被申请人观点]<br>
                    <strong>仲裁员倾向：</strong>[仲裁员倾向性意见]<br>
                    <strong>上帝视角研判：</strong>[中立分析结论]
                </div>
            </div>
            <!-- 重复多个焦点 -->
        </div>
    </div>

    <!-- 风险提示 -->
    <div class="card">
        <div class="card-title"><span class="icon">⚠️</span> 风险提示</div>
        <div class="info-block warning">
            <strong>程序风险：</strong>[可能存在的程序性风险]
        </div>
        <div class="info-block warning">
            <strong>实体风险：</strong>[可能存在的实体认定风险]
        </div>
        <div class="info-block warning">
            <strong>证据风险：</strong>[证据方面的风险点]
        </div>
        <div class="info-block danger">
            <strong>最大不确定性：</strong>[案件最大的不确定因素]
        </div>
    </div>

    <!-- 裁决预测 -->
    <div class="card">
        <div class="card-title"><span class="icon">📝</span> 裁决预测</div>
        <table>
            <tr><th>仲裁请求</th><th>支持概率</th><th>预测金额</th><th>理由</th></tr>
            <tr>
                <td>[请求项1]</td>
                <td><span class="badge badge-success">高</span></td>
                <td>[金额]</td>
                <td>[简要理由]</td>
            </tr>
            <tr>
                <td>[请求项2]</td>
                <td><span class="badge badge-warning">中</span></td>
                <td>[金额]</td>
                <td>[简要理由]</td>
            </tr>
            <tr>
                <td>[请求项3]</td>
                <td><span class="badge badge-danger">低</span></td>
                <td>[金额]</td>
                <td>[简要理由]</td>
            </tr>
        </table>
        <div style="margin-top: 16px;">
            <div class="info-block primary">
                <strong>裁决主文预测：</strong>
                [预测的裁决主文内容]
            </div>
        </div>
    </div>

    <!-- 模拟庭审纪要 -->
    <div class="card">
        <div class="card-title"><span class="icon">📜</span> 模拟庭审纪要</div>
        <div class="timeline">
            <div class="timeline-item">
                <div class="title">第一环节：开庭准备</div>
                <div class="desc">[庭审准备阶段要点]</div>
            </div>
            <div class="timeline-item">
                <div class="title">第二环节：申请人陈述</div>
                <div class="desc">[申请人陈述要点]</div>
            </div>
            <div class="timeline-item">
                <div class="title">第三环节：被申请人答辩</div>
                <div class="desc">[被申请人答辩要点]</div>
            </div>
            <div class="timeline-item">
                <div class="title">第四环节：举证质证</div>
                <div class="desc">[举证质证要点]</div>
            </div>
            <div class="timeline-item">
                <div class="title">第五环节：仲裁庭调查</div>
                <div class="desc">[调查要点]</div>
            </div>
            <div class="timeline-item">
                <div class="title">第六环节：辩论</div>
                <div class="desc">[辩论要点]</div>
            </div>
            <div class="timeline-item">
                <div class="title">第七环节：最后陈述</div>
                <div class="desc">[最后陈述要点]</div>
            </div>
            <div class="timeline-item">
                <div class="title">第八环节：庭审小结</div>
                <div class="desc">[庭审小结]</div>
            </div>
        </div>
    </div>

    <!-- 免责声明 -->
    <div class="footer">
        <p>本报告由 AIArb 模拟仲裁技能自动生成，仅供参考，不构成法律意见。</p>
        <p>生成时间：[时间戳] | 智能体版本：AIArb Moot Simulation v1.0</p>
    </div>

</div>
</body>
</html>
```

**输出文件**：
1. **HTML 报告**：`模拟仲裁报告_[案件名称].html` — 可直接用浏览器打开，美观展示
2. **Markdown 报告**：`模拟仲裁报告_[案件名称].md` — 纯文本版，便于编辑和分享

---

## 执行规则

### 智能体编排规则

1. **先查询后调用**：始终先执行 `list_agents()` 确认可用智能体，不要猜 ID
2. **Session 管理**：每个智能体的首次对话会返回 `[SESSION: ...]`，后续对话必须传入 `session_id`
3. **角色隔离**：不同角色的 `session_id` 不可混用
4. **导演视角**：默认智能体是庭审导演，不参与当事人的辩论
5. **顺序控制**：严格按照庭审程序的八个环节依次推进
6. **超时处理**：如果某个智能体响应超时，重试一次；如果仍失败，跳过该环节并标注

### 评判规则

1. **请求权基础分析**：采用请求权基础分析方法，从请求权构成要件逐一分析
2. **胜诉率计算**：基于以下因素综合评估：
   - 请求权基础是否成立（权重 40%）
   - 证据充分性（权重 25%）
   - 法律适用准确性（权重 20%）
   - 程序合规性（权重 10%）
   - 庭审策略运用（权重 5%）
3. **表现评价维度**：法律论证、证据组织、策略运用、庭审表现
4. **评级标准**：
   - ⭐⭐⭐⭐⭐ 优秀（9-10 分）
   - ⭐⭐⭐⭐ 良好（7-8 分）
   - ⭐⭐⭐ 一般（5-6 分）
   - ⭐⭐ 不足（3-4 分）
   - ⭐ 差（1-2 分）

### 输出规则

1. **HTML 报告**必须包含完整的 CSS 样式，可直接在浏览器中打开查看
2. 所有占位符 `[...]` 必须替换为实际内容
3. 百分比、评分等数值必须基于庭审分析给出，不可随意编造
4. 报告生成后，使用 `send_file_to_user` 将文件发送给用户

---

## 对话编排模板

以下是完整的对话编排流程模板（简写版），实际执行时根据案件情况调整：

```text
# 步骤1：查询可用智能体
list_agents()

# 步骤2：庭审准备（4次 chat_with_agent，各角色初始化）
chat_with_agent(to_agent="casemanager", text="...")
chat_with_agent(to_agent="claimant", text="...")
chat_with_agent(to_agent="respondent", text="...")
chat_with_agent(to_agent="arbitrator", text="...")
# 记录4个 session_id

# 步骤3：模拟庭审（8个环节，约10-14次 chat_with_agent）
# 环节1：仲裁员开庭
chat_with_agent(to_agent="arbitrator", session_id="<arbitrator_sid>", text="...")
# 环节2：申请人陈述
chat_with_agent(to_agent="claimant", session_id="<claimant_sid>", text="...")
# 环节3：被申请人答辩
chat_with_agent(to_agent="respondent", session_id="<respondent_sid>", text="...")
# 环节4：举证质证（4次）
chat_with_agent(to_agent="claimant", session_id="<claimant_sid>", text="...举证")
chat_with_agent(to_agent="respondent", session_id="<respondent_sid>", text="...质证")
chat_with_agent(to_agent="respondent", session_id="<respondent_sid>", text="...举证")
chat_with_agent(to_agent="claimant", session_id="<claimant_sid>", text="...质证")
# 环节5：仲裁庭调查
chat_with_agent(to_agent="arbitrator", session_id="<arbitrator_sid>", text="...")
# 环节6：辩论
chat_with_agent(to_agent="claimant", session_id="<claimant_sid>", text="...辩论")
chat_with_agent(to_agent="respondent", session_id="<respondent_sid>", text="...辩论")
# 环节7：最后陈述
chat_with_agent(to_agent="claimant", session_id="<claimant_sid>", text="...")
chat_with_agent(to_agent="respondent", session_id="<respondent_sid>", text="...")
# 环节8：庭审小结
chat_with_agent(to_agent="casemanager", session_id="<casemanager_sid>", text="...")

# 步骤4：仲裁员评议
chat_with_agent(to_agent="arbitrator", session_id="<arbitrator_sid>", text="...评议")

# 步骤5：生成报告
write_file("模拟仲裁报告_[案件名].html", html_content)
write_file("模拟仲裁报告_[案件名].md", md_content)
send_file_to_user("模拟仲裁报告_[案件名].html")
send_file_to_user("模拟仲裁报告_[案件名].md")
```

---

## 注意事项

1. **智能体可用性**：如果 `list_agents()` 返回的列表中缺少某个仲裁智能体，应告知用户该智能体未创建，建议重启 AIArb 以触发自动创建
2. **案件材料不足**：如果用户提供的材料过于简略，应在阶段一主动追问关键信息（仲裁请求、基本事实、争议焦点），确保模拟有效
3. **多轮质证**：如果案件证据较多，可适当增加举证质证轮次，但每轮需明确标注证据编号
4. **报告内容真实性**：报告中的所有分析结论必须基于庭审中各智能体的实际发言内容，不可凭空编造
5. **中立性**：上帝视角分析必须保持中立客观，不偏袒任何一方
6. **Token 消耗**：本技能涉及约 15-20 次智能体对话，Token 消耗较大，执行前应提醒用户

---

## 更新日志

| 版本 | 日期 | 变更 |
|---|---|---|
| 1.0 | 2026-08-15 | 初始版本：完整的模拟仲裁编排流程、上帝视角评判、HTML 美观报告 |
