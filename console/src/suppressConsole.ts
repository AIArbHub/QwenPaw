if (typeof window !== "undefined") {
  const originalError = console.error;
  const originalWarn = console.warn;

  const SUPPRESSED_PATTERNS_ERROR = [
    ":first-child",
    "pseudo class",
    "[getThemeColors]",
    "forwardRef render functions accept exactly two parameters",
    "overlayClassName",
    "Each child in a list should have a unique",
    "flushSync was called from inside a lifecycle",
    "[antd: Card] `bodyStyle` is deprecated",
  ];

  const SUPPRESSED_PATTERNS_WARN = [
    ":first-child",
    "pseudo class",
    "potentially unsafe",
    "[CodeHighlighter] Failed to load language",
  ];

  function matchesPatterns(msg: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      if (msg.includes(pattern)) return true;
    }
    return false;
  }

  console.error = function (...args: unknown[]) {
    const msg = args[0]?.toString() || "";
    if (
      matchesPatterns(msg, SUPPRESSED_PATTERNS_ERROR) ||
      (msg.includes("AbortError") && msg.includes("signal is aborted"))
    ) {
      return;
    }
    originalError.apply(console, args as []);
  };

  console.warn = function (...args: unknown[]) {
    const msg = args[0]?.toString() || "";
    if (matchesPatterns(msg, SUPPRESSED_PATTERNS_WARN)) {
      return;
    }
    originalWarn.apply(console, args as []);
  };
}