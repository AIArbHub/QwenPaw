/**
 * Utility functions for document type colors and labels.
 */

/** Map document type IDs to antd tag colors. */
export function docTypeColor(docType: string): string {
  const colorMap: Record<string, string> = {
    arbitration_award: "red",
    arbitration_application: "orange",
    arbitration_defense: "gold",
    arbitration_counterclaim: "volcano",
    arbitration_ruling: "magenta",
    arbitration_interim_measure: "purple",
    court_judgment: "blue",
    court_ruling: "cyan",
    contract: "green",
    legal_opinion: "geekblue",
    evidence: "lime",
    other: "default",
  };
  return colorMap[docType] || "default";
}

/** Map entity type to a display color. */
export function entityColor(entityType: string): string {
  const colorMap: Record<string, string> = {
    person_name: "magenta",
    company_name: "blue",
    party_alias: "geekblue",
    id_number: "red",
    phone_number: "orange",
    email: "gold",
    address: "green",
    bank_account: "volcano",
    case_number: "purple",
    license_plate: "lime",
    wechat_id: "cyan",
    alipay_id: "cyan",
    ip_address: "cyan",
    arbitrator_name: "magenta",
    lawyer_name: "magenta",
    witness_name: "magenta",
    amount: "geekblue",
    date: "geekblue",
    evidence_id: "lime",
  };
  return colorMap[entityType] || "default";
}

/** Map redaction mode to a display color. */
export function modeColor(mode: string): string {
  const colorMap: Record<string, string> = {
    mask: "blue",
    replace: "orange",
    tokenize: "green",
    irreversible: "red",
    full_mask: "red",
    partial_mask: "gold",
    keep: "default",
    configurable: "volcano",
    generalize: "purple",
    shield: "magenta",
    randomize: "cyan",
    date_shift: "lime",
  };
  return colorMap[mode] || "default";
}

/** Format a redaction mode for display. */
export function formatMode(mode: string): string {
  const labelMap: Record<string, string> = {
    "RedactionMode.MASK": "掩码",
    "RedactionMode.REPLACE": "替换",
    "RedactionMode.TOKENIZE": "Token化",
    "RedactionMode.IRREVERSIBLE": "不可逆",
    "RedactionMode.FULL_MASK": "全掩码",
    "RedactionMode.PARTIAL_MASK": "部分掩码",
    "RedactionMode.KEEP": "保留",
    "RedactionMode.CONFIGURABLE": "可配置",
    "RedactionMode.GENERALIZE": "泛化",
    "RedactionMode.SHIELD": "屏蔽",
    "RedactionMode.RANDOMIZE": "随机置换",
    "RedactionMode.DATE_SHIFT": "日期偏移",
  };
  return labelMap[mode] || mode;
}
