# 知识库文档规范（Schema）

本知识库**所有**入库文件必须带以下 YAML 文档头。缺来源的文件**不予入库**——这是防幻觉的第一道闸门。

## 通用字段（四库必填）

```yaml
---
title: 文件标题
category: laws | rules | cases | templates
source: 来源 URL 或本地路径
source_type: official | public-web | user-upload | curated
institution: 发布/作出机构
version: 版本或年份
effective_date: 施行或发布日（YYYY-MM-DD）
jurisdiction: 中国大陆 | 中国香港 | 新加坡 | 国际 | 其他
retrieved: 采集日期（YYYY-MM-DD）
copyright: 版权状态说明
confidence: verified | draft
tags: [关键词]
---
```

### 字段说明

| 字段 | 取值 | 说明 |
|---|---|---|
| `source_type` | `official` | 官方机构公开发布（官网、公报） |
| | `public-web` | 公开网络渠道整理（公众号、行业媒体） |
| | `user-upload` | 用户本地上传材料 |
| | `curated` | KB Curator 策展流水线产出 |
| `confidence` | `verified` | 已与原文逐字核对 |
| | `draft` | 待核对，**引用时必须提示用户复核** |
| `copyright` | 见 `SOURCES.md` | 必须明确标注，不可留空 |

## 分类扩展字段

### laws（法律）

```yaml
law_level: 法律 | 行政法规 | 司法解释 | 地方性法规 | 国际公约
```

### rules（仲裁规则）

```yaml
institution_abbr: CIETAC | BAC/BIAC | SHIAC | SCIA | HKIAC | SIAC | ICC | LCIA
rule_type: 仲裁规则 | 仲裁员守则 | 费用表 | 简易程序规则 | 紧急仲裁员程序
```

### cases（案例）

```yaml
case_no: 案号（无则填 无）
decision_date: 裁决/判决日期
cause: 案由
issues: [争议焦点]
holding: 一句话裁判要旨
redacted: true | false
```

`redacted: true` 表示已脱敏。**未脱敏的案件材料禁止入库共享库**，只可留在用户私有工作区。

### templates（文书模板）

```yaml
doc_type: 申请书 | 答辩书 | 反请求书 | 程序令 | 裁决书 | 代理意见 | 其他
applicable_institution: 适用机构（通用则填 通用）
```

## 命名规范

| 类别 | 命名 | 示例 |
|---|---|---|
| laws | `<名称>-<年份>.md` | `中华人民共和国仲裁法-2017.md` |
| rules | `<机构缩写>-仲裁规则-<年份>.md` | `CIETAC-仲裁规则-2024.md` |
| cases | `<机构>-<案号或主题>-<年份>.md` | `BAC-违约金调整-2023.md` |
| templates | `<文书类型>.md` | `仲裁申请书.md` |

## 正文书写要求

1. **逐字录入，不改写**。条文、规则条款必须与原文一致，不做"优化"。
2. **保留编号体系**。条、款、项编号原样保留，便于精确引用。
3. **附来源定位**。长文件在章节处标注原文页码或条款号。
4. **不写结论性发挥**。知识库存事实与原文，推理交给 Agent 在回答时做。
5. **发现冲突时标注**，不自行取舍：用 `> 注：与 X 版本存在冲突，待核对` 标记。

## 禁止事项

- **禁止凭记忆生成**法律条文、规则条款、案号、裁判要旨。
- **禁止整篇复制**受版权保护的公开案例原文（只入结构化整理，见 `SOURCES.md`）。
- **禁止**把未脱敏的真实当事人信息、未决案件材料写入共享库。
- 检索不到时，如实回答"知识库中暂无对应内容"，**不得补全**。
