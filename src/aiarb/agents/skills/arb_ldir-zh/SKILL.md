---
能力名称: LDIR 仲裁文档解析
能力编号: ARB-DOC-001
核心功能: 将 PDF/DOCX/TXT 等原始文档解析为带页码/坐标/置信度的统一中间表示（LDIR），并产出 4 份产物
适用场景: 仲裁裁决书核阅、文书起草前置文档分析、证据材料结构化、引用来源定位
关键法源: 无直接法源依赖，为文档工程基础设施
输出物: "*.md（人读文本）、*.ldir.json（机读 LDIR）、*.semantic.json（语义元数据）、*_intake_report.json（质量报告）"
关联能力:
  上游: 无
  下游: arb_award_review-zh（裁决书核阅）、arb_document_draft-zh（文书起草）、redaction-zh（脱敏）
tags: ['仲裁核心']
---

# LDIR 仲裁文档解析

## 概述

LDIR（Legal Document Intermediate Representation）是仲裁文档的统一中间表示。它将原始文件（PDF、DOCX、TXT 等）解析为带 **页码 + 坐标 + 置信度 + 来源哈希** 的结构化文档对象，使引用标注从"提示词要求"变为"结构事实"。

## 仲裁文书类型识别

内置仲裁专项文档类型（LegalWork 原版缺失，本版补全）：

| 类型常量 | 中文 | 关键特征词 |
|---|---|---|
| `arbitration_award` | 仲裁裁决书 | 裁决书、仲裁庭、申请人、被申请人、独任仲裁员、首席仲裁员、组庭 |
| `arbitration_application` | 仲裁申请书 | 仲裁请求、申请书 |
| `arbitration_defense` | 仲裁答辩书 | 答辩 |
| `arbitration_counterclaim` | 仲裁反请求书 | 反请求 |
| `arbitration_ruling` | 仲裁程序令 | 程序令 |
| `arbitration_interim_measure` | 仲裁临时措施 | 临时措施、保全 |

## CLI 用法

```bash
# 解析单个文档，自动保存 4 份产物
python -m aiarb.document.intake_cli "path/to/裁决书.pdf"

# 指定输出目录
python -m aiarb.document.intake_cli "path/to/裁决书.pdf" --output "matter/working/"
```

## Python API

```python
from aiarb.document import intake_document

# 运行 intake pipeline
result = intake_document("path/to/裁决书.pdf")

# 保存 4 份产物到 working/ 目录
result.save_all()

# 访问结构化数据
print(result.ldir.doc_type)           # "arbitration_award"
print(result.ldir.doc_type_confidence) # 0.87
print(result.report.human_review_recommended)  # False

# 获取带页码的纯文本
for page in result.ldir.pages:
    for block in page.blocks:
        print(f"[第{page.page_number}页] {block.text}")

# 定位引用所在的精确位置
for citation in result.ldir.citations:
    print(f"引用: {citation['text']}, 页码: {citation['page_number']}")
```

## 4 份产物

| 产物 | 格式 | 用途 |
|---|---|---|
| `*.md` | 人读 Markdown | 快速浏览文档内容 |
| `*.ldir.json` | 机读 LDIR JSON | 结构化引用、精确回插批注 |
| `*.semantic.json` | 语义元数据 | 文档类型、关键词、置信度 |
| `*_intake_report.json` | 质量报告 | OCR 置信度、人工复核建议、警告 |

## 工作区约定

```
matter/
  raw/          # 原始文件（永不改写）
    裁决书.pdf
  working/      # intake 产物
    裁决书.md
    裁决书.ldir.json
    裁决书.semantic.json
    裁决书_intake_report.json
```

## 质量检查清单

- [ ] 来源哈希（SHA-256）已计算并记录
- [ ] 文档类型已识别且置信度 ≥ 0.4
- [ ] 无"OCR 需要"标记的页面
- [ ] 所有 block 均有 page_number
- [ ] 人工复核标记为 False（或已处理）

## 局限性

- 当前版本不带 OCR 引擎（扫描件标记为 `ocr_needed`）
- DOCX 不带 bbox（python-docx 无法获取坐标）
- 文档类型识别基于关键词打分，非深度学习
