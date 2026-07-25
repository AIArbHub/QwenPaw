# -*- coding: utf-8 -*-
from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class DesensitizeRule:
    name: str
    pattern: str
    placeholder: str
    group: int = 0


DEFAULT_RULES: list[DesensitizeRule] = [
    DesensitizeRule(
        name="id_card",
        pattern=r"[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]",
        placeholder="ID_{seq:03d}",
    ),
    DesensitizeRule(
        name="phone",
        pattern=r"(?<!\d)1[3-9]\d{9}(?!\d)",
        placeholder="PHONE_{seq:03d}",
    ),
    DesensitizeRule(
        name="phone_with_prefix",
        pattern=r"(?:tel[:：]?\s*|电话[:：]?\s*|手机[:：]?\s*)1[3-9]\d{9}",
        placeholder="PHONE_{seq:03d}",
    ),
    DesensitizeRule(
        name="bank_card",
        pattern=r"(?<!\d)[1-9]\d{14,18}(?!\d)",
        placeholder="BANK_{seq:03d}",
    ),
    DesensitizeRule(
        name="bank_account_full",
        pattern=(
            r"(?:开户行|银行账户|账号|银行卡号|卡号)[:：]?\s*"
            r"(?:中国(?:人民|工商|农业|建设|交通|邮政储蓄|银行)|招商|浦发|中信|光大|民生|华夏|平安|兴业|广发|浙商|渤海|恒丰|徽商)?"
            r"(?:银行)?[^\n]{10,30}"
        ),
        placeholder="BANK_{seq:03d}",
    ),
    DesensitizeRule(
        name="address_full",
        pattern=(
            r"(?:北京市|上海市|天津市|重庆市|"
            r"[\u4e00-\u9fa5]{2,6}省(?:[\u4e00-\u9fa5]{2,5}市|自治州)"
            r"|[\u4e00-\u9fa5]{2,5}市|[\u4e00-\u9fa5]{3,6}自治区)"
            r"[\u4e00-\u9fa5\d\-路街号栋楼层室单元苑区大厦广场中心公寓花园小区新城学府园湾府邸]+"
            r"(?:\d+[号楼]?\d*[单元]?\d*[室房])?"
        ),
        placeholder="ADDR_{seq:03d}",
    ),
    DesensitizeRule(
        name="address_simple",
        pattern=(
            r"(?:住址|住所|地址|居住地|联系地址)[:：]?\s*"
            r"[\u4e00-\u9fa5\d\-路街号栋楼层室单元苑区大厦广场中心公寓花园小区新城学府园湾府邸]{8,50}"
        ),
        placeholder="ADDR_{seq:03d}",
    ),
    DesensitizeRule(
        name="person_name_context",
        pattern=(
            r"(?:原告|被告|申请人|被申请人|上诉人|被上诉人|"
            r"原审原告|原审被告|第三人|委托代理人|法定代理人|"
            r"诉讼代理人|辩护人|证人|鉴定人|翻译人员|"
            r"审判长|审判员|书记员|仲裁员|首席仲裁员|独任仲裁员)"
            r"[：:]\s*([\u4e00-\u9fa5]{2,4})"
        ),
        placeholder="PERSON_{seq:03d}",
        group=1,
    ),
    DesensitizeRule(
        name="person_name_plain",
        pattern=(
            r"(?:当事人|姓名|名称|法定代表人|负责人|经营者|"
            r"户主|车主|持卡人|存款人|投保人|被保险人|受益人|"
            r"甲方|乙方|丙方|丁方)[:：]?\s*([\u4e00-\u9fa5]{2,4})"
        ),
        placeholder="PERSON_{seq:03d}",
        group=1,
    ),
    DesensitizeRule(
        name="case_number",
        pattern=(
            r"\(?\d{4}\)?[\u4e00-\u9fa5]{1,3}"
            r"(?:民初|民终|民再|民监|民提|商初|商终|行初|行终|刑初|刑终)"
            r"(?:字第?)?\s*\d+\s*号"
        ),
        placeholder="CASENO_{seq:03d}",
    ),
    DesensitizeRule(
        name="case_number_arbitration",
        pattern=(
            r"\(?\d{4}\)?(?:深|京|沪|粤|苏|浙|川|鄂|鲁|渝|津|闽|湘|皖|豫|陕|辽|吉|黑|冀|晋|蒙|赣|桂|琼|云贵甘宁青新藏)"
            r"?仲受字第?\s*\d+\s*号"
        ),
        placeholder="CASENO_{seq:03d}",
    ),
    DesensitizeRule(
        name="email",
        pattern=r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}",
        placeholder="EMAIL_{seq:03d}",
    ),
    DesensitizeRule(
        name="company_name",
        pattern=(
            r"(?:公司|企业|集团|有限|股份|合伙|事务所|中心|研究院|协会|商会|基金会)"
            r"[\u4e00-\u9fa5（）()]{2,20}(?:公司|企业|集团|有限|股份|合伙|事务所|中心|研究院|协会|商会|基金会)?"
        ),
        placeholder="COMPANY_{seq:03d}",
    ),
    DesensitizeRule(
        name="vehicle_plate",
        pattern=r"[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤川青藏琼宁][A-HJ-NP-Z][A-HJ-NP-Z0-9]{4,5}[挂学警港澳使领]?",
        placeholder="PLATE_{seq:03d}",
    ),
    DesensitizeRule(
        name="passport",
        pattern=r"[GEP][\d]{8}|[S\d]\d{7}|[D\d]\d{7}|[1-5]\d{8}",
        placeholder="PASSPORT_{seq:03d}",
    ),
    DesensitizeRule(
        name="social_credit_code",
        pattern=r"[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}",
        placeholder="CREDIT_{seq:03d}",
    ),
    DesensitizeRule(
        name="tax_id",
        pattern=r"[1-9]\d{14}|\d{17}[\dXx]",
        placeholder="TAXID_{seq:03d}",
    ),
]


def local_desensitize(
    markdown_text: str,
    rules: list[DesensitizeRule] | None = None,
) -> tuple[str, dict[str, str]]:
    if rules is None:
        rules = DEFAULT_RULES

    backfill_map: dict[str, str] = {}
    counters: dict[str, int] = {}
    result = markdown_text

    for rule in rules:
        for match in re.finditer(rule.pattern, result):
            original = match.group(rule.group)
            if not original or original in backfill_map.values():
                continue
            key = rule.name
            counters[key] = counters.get(key, 0) + 1
            placeholder = rule.placeholder.format(seq=counters[key])
            if placeholder not in backfill_map:
                backfill_map[placeholder] = original
                result = result.replace(original, placeholder, 1)

    return result, backfill_map