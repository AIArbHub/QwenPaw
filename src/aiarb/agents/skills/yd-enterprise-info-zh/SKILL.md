---
name: yd-enterprise-info
description: |
  元典企业信息查询技能（仲裁集成版 https://open.chineselaw.com）。
  封装元典开放平台全部22个企业信息接口，支持自动翻页。
  覆盖：企业基本信息、变更记录、商标、专利、软著、作品著作权、网站备案、
  对外投资/担保、股权出质/冻结、经营异常、严重违法、欠税、行政处罚、
  被执行/失信、涉诉文书/统计、法院公告、开庭公告。
  适合：仲裁案件背景调查、仲裁被申请人资信核查、执行阶段财产线索发现。
version: "26.4.29.1545"
metadata:
  license: "项目许可证"
tags: ['系统工具', '合规与风险']
---

# yd-enterprise-info（元典企业信息查询）仲裁集成版

> **定位**：独立的工商数据获取层 skill，完整封装元典开放平台企业信息接口。

## 触发词

`查工商`、`企业信息`、`查公司`、`enterprise info`、`工商查询`、`查股东`、
`查商标`、`查专利`、`查诉讼`、`查被执行`、`查失信`、`查行政处罚`、
`查对外投资`、`企业背景核查`、`对方当事人资信调查`、`财产线索`、`执行线索`

## 子命令速查

| 子命令 | 说明 | 是否分页 | **仲裁场景** |
|---|---|---|---|
| `search-company` | 按名称检索候选企业 | 否 | 立案前核查被申请人 |
| `base-info` | 基本信息+股东+核心成员+分支机构 | 否 | 当事人主体资格 |
| `change` | 变更记录 | ✅ 自动翻页 | 股权变动追踪 |
| `brand` | 商标信息 | ✅ 自动翻页 | 知识产权争议 |
| `soft-right` | 软件著作权 | ✅ 自动翻页 | 技术合同纠纷 |
| `patent` | 专利信息 | ✅ 自动翻页 | 专利/技术争议 |
| `copyright-work` | 作品著作权 | ✅ 自动翻页 | 著作权争议 |
| `website` | 网站备案 | ✅ 自动翻页 | — |
| `outbound-invest` | 对外投资 | ✅ 自动翻页 | 关联公司追溯 |
| `outbound-guarantee` | 对外担保 | ✅ 自动翻页 | **担保责任追索** |
| `equity-pledge` | 股权出质 | ✅ 自动翻页 | **股权质押通知** |
| `equity-frozen` | 股权冻结 | ✅ 自动翻页 | **财产保全线索** |
| `abnormal` | 经营异常记录 | ✅ 自动翻页 | 主体资格风险 |
| `serious-violation` | 严重违法记录 | ✅ 自动翻页 | 重大违规风险 |
| `tax-arrears` | 欠税公告 | ✅ 自动翻页 | — |
| `admin-penalty` | 行政处罚 | ✅ 自动翻页 | — |
| `executed` | 被执行人信息 | ✅ 自动翻页 | **执行线索【核心】** |
| `dishonest` | 失信被执行人 | ✅ 自动翻页 | **执行线索【核心】** |
| `litigation-doc` | 涉诉文书列表 | ✅ 自动翻页 | **历史诉讼/仲裁记录** |
| `litigation-stat` | 涉诉多维度统计 | 否（聚合） | 争议风险评估 |
| `court-announcement` | 法院公告 | ✅ 自动翻页 | — |
| `court-hearing` | 开庭公告 | ✅ 自动翻页 | — |

## 凭证设置

```bash
export CHINESELAW_API_KEY=你的KEY
# 或通过 --api-key 参数传入
```

## 仲裁场景应用指引

### 场景A：立案前当事人资信审查（推荐）

在提交仲裁申请前，对被申请人进行全面背景调查：

```bash
# Step 1: 检索确认企业
python3 scripts/yd_enterprise_info.py search-company \
  --name "目标公司名称" --top-k 5

# Step 2: 获取基本信息（确认主体资格）
USCC="统一社会信用代码"
python3 scripts/yd_enterprise_info.py base-info \
  --tyshxydm $USCC --output ./raw/chineselaw/ --yes

# Step 3: 执行/失信排查（评估回款能力）
for cmd in executed dishonest; do
  python3 scripts/yd_enterprise_info.py $cmd \
    --tyshxydm $USCC --output ./raw/chineselaw/ --yes
done

# Step 4: 涉诉历史（评估争议倾向）
python3 scripts/yd_enterprise_info.py litigation-stat \
  --tyshxydm $USCC --output ./raw/chineselaw/ --yes
```

**关注要点**：
- 是否有大量被执行/失信记录 → 回款能力存疑
- 是否有频繁涉诉历史 → 争议倾向高
- 股权是否被冻结/质押 → 资产状况
- 是否经营异常/注销 → 主体资格问题

### 场景B：仲裁执行阶段财产线索发现

裁决作出后，申请执行前收集财产线索：

```bash
USCC="被申请人统一社会信用代码"

# 核心执行线索
for cmd in base-info executed dishonest equity-frozen equity-pledge \
           outbound-invest outbound-guarantee; do
  python3 scripts/yd_enterprise_info.py $cmd \
    --tyshxydm $USCC --output ./raw/chineselaw/ --yes
done
```

### 场景C：仲裁中追加当事人/第三人

需要了解关联公司信息时：

```bash
# 对外投资 → 发现子公司/关联公司
python3 scripts/yd_enterprise_info.py outbound-invest \
  --tyshxydm $USCC --output ./raw/chineselaw/ --yes

# 变更记录 → 追踪股权变动
python3 scripts/yd_enterprise_info.py change \
  --tyshxydm $USCC --output ./raw/chineselaw/ --yes
```

## 引用规范（仲裁文书中使用）

1. **明确来源**：
   > 经查询元典开放平台企业信息接口（调用时间 YYYY-MM-DD HH:MM），被申请人{名称}的工商登记信息如下：

2. **冲突即风险**：API数据与被申请人提供材料不一致时，标注🟡或🔴风险

3. **执行线索特别标注**：在财产保全/执行申请文书中，将执行/失信信息作为证据线索引用

## 与原版功能的兼容性

✅ **完全兼容原版**：所有子命令、参数、输出格式与原版一致
✅ **脚本直接复用**：`scripts/yd_enterprise_info.py` 可直接使用
✅ **API凭证通用**：使用同一元典开放平台 API Key

## 积分提示

- 每次 API 调用消耗约 10 积分
- 分页接口每页单独计费
- 建议按需选择子命令，不必每次运行全部
