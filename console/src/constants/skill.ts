// ─── Skill Hub URL prefixes ───────────────────────────────────────────────────

export const SUPPORTED_SKILL_URL_PREFIXES = [
  "https://platform.agentscope.io/skills/",
  "https://skills.sh/",
  "https://clawhub.ai/",
  "https://skillsmp.com/",
  "https://lobehub.com/",
  "https://market.lobehub.com/",
  "https://github.com/",
  "https://modelscope.cn/skills/",
];

export function isSupportedSkillUrl(url: string): boolean {
  return SUPPORTED_SKILL_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

// ─── Search / filter ──────────────────────────────────────────────────────────

/** Prefix used to distinguish tag-filter tokens from plain text queries */
export const SKILL_TAG_FILTER_PREFIX = "tag:";

// ─── Preset skill categories ───────────────────────────────────────────────

/**
 * Preset category list for skill tagging.
 * The first tag of a skill is treated as its primary category for grouping.
 * Users can also type custom tags in the tag input.
 */
export const SKILL_PRESET_CATEGORIES: readonly string[] = [
  "仲裁核心",
  "案件分析",
  "法律检索",
  "法律推理",
  "证据与事实",
  "文书起草",
  "案件管理",
  "合规与风险",
  "数据合规",
  "文档处理",
  "知识产权",
  "沟通协作",
  "知识管理",
  "系统工具",
] as const;

