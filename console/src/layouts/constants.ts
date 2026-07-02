// ── URLs ──────────────────────────────────────────────────────────────────

export const PYPI_URL = "https://pypi.org/pypi/aiarb/json";

export const SITE_URL = "https://www.aiarb.cn" as const;

export const GITHUB_URL = SITE_URL;

// ── Timing ────────────────────────────────────────────────────────────────

export const ONE_HOUR_MS = 60 * 60 * 1000;

// ── URL helpers ───────────────────────────────────────────────────────────

export const getWebsiteLang = (lang: string): string =>
  lang.startsWith("zh") ? "zh" : "en";

export const getDocsUrl = (_lang: string): string => SITE_URL;

export const getFaqUrl = (_lang: string): string => SITE_URL;

export const getReleaseNotesUrl = (_lang: string): string => SITE_URL;

export const getFeatureDemosUrl = (_lang: string): string => SITE_URL;

// ── Version helpers ────────────────────────────────────────────────────────

// Filter out pre-release versions; post-releases are treated as stable.
// PEP 440 pre-release suffixes: aN / bN / rcN (or cN) / devN.
export const isStableVersion = (v: string): boolean =>
  !/(\d)(a|alpha|b|beta|rc|c|dev)\d*/i.test(v);

// Compare two PEP 440 version strings. Returns >0 if a>b, <0 if a<b, 0 if equal.
// .postN releases sort after their base version (e.g. 1.0.0.post1 > 1.0.0).
// Pre-release versions (aN, bN, rcN) sort before their base version.
export const compareVersions = (a: string, b: string): number => {
  const normalise = (v: string): number[] => {
    // Handle .postN suffix
    const postMatch = v.match(/\.post(\d+)$/i);
    const postNum = postMatch ? Number(postMatch[1]) : 0;
    const baseVersion = v.replace(/\.post\d+$/i, "");

    // Handle pre-release suffix (e.g., 1.0.1b1 -> base=1.0.1, preType=b, preNum=1)
    const preMatch = baseVersion.match(/^(.+?)(a|alpha|b|beta|rc|c)(\d*)$/i);
    let coreVersion = baseVersion;
    let preType = 0; // 0 = stable, -3 = alpha, -2 = beta, -1 = rc
    let preNum = 0;
    if (preMatch) {
      coreVersion = preMatch[1];
      const preLabel = preMatch[2].toLowerCase();
      preType =
        preLabel === "a" || preLabel === "alpha"
          ? -3
          : preLabel === "b" || preLabel === "beta"
          ? -2
          : -1; // rc or c
      preNum = preMatch[3] ? Number(preMatch[3]) : 0;
    }

    const parts = coreVersion.split(/[.\-]/).map((seg) => Number(seg) || 0);
    // Append: preType (0 for stable, negative for pre-release), preNum, postNum
    return [...parts, preType, preNum, postNum];
  };

  const aN = normalise(a);
  const bN = normalise(b);
  const len = Math.max(aN.length, bN.length);
  for (let i = 0; i < len; i++) {
    const diff = (aN[i] ?? 0) - (bN[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

// ── Update markdown ───────────────────────────────────────────────────────
// TODO
export const UPDATE_MD: Record<string, string> = {
  zh: `### AI Arb如何更新

要更新 AI Arb 到最新版本，可根据你的安装方式选择对应方法：

1. 如果你使用的是一键安装脚本，直接重新运行安装命令即可自动升级。

2. 如果你是通过 pip 安装，在终端中执行以下命令升级：

\`\`\`
aiarb update
\`\`\`

3. 如果你是从源码安装，进入项目目录并拉取最新代码后重新安装：

\`\`\`
cd QwenPaw
git pull origin main
cd console && npm ci && npm run build
cd .. && mkdir -p src/aiarb/console
cp -R console/dist/. src/aiarb/console/
pip install -e .
\`\`\`

4. 如果你使用的是 Docker，拉取最新镜像并重启容器：

\`\`\`
docker pull agentscope/aiarb:latest
docker run -p 127.0.0.1:8088:8088 -v aiarb-data:/app/working -v aiarb-secrets:/app/working.secret -v aiarb-backups:/app/working.backups agentscope/aiarb:latest
\`\`\`

升级后重启服务 aiarb app。`,

  ru: `### Как обновить AI Arb

Чтобы обновить AI Arb, выберите способ в зависимости от типа установки:

1. Если вы устанавливали через однострочный скрипт, повторно запустите установщик для обновления.

2. Если устанавливали через pip, выполните:

\`\`\`
aiarb update
\`\`\`

3. Если устанавливали из исходников, получите последние изменения и переустановите:

\`\`\`
cd QwenPaw
git pull origin main
cd console && npm ci && npm run build
cd .. && mkdir -p src/aiarb/console
cp -R console/dist/. src/aiarb/console/
pip install -e .
\`\`\`

4. Если используете Docker, загрузите новый образ и перезапустите контейнер:

\`\`\`
docker pull agentscope/aiarb:latest
docker run -p 127.0.0.1:8088:8088 -v aiarb-data:/app/working -v aiarb-secrets:/app/working.secret -v aiarb-backups:/app/working.backups agentscope/aiarb:latest
\`\`\`

After upgrading, restart the service with \`aiarb app\`.`,

  en: `### How to update AI Arb

To update AI Arb, use the method matching your installation type:

1. If installed via one-line script, re-run the installer to upgrade.

2. If installed via pip, run:

\`\`\`
aiarb update
\`\`\`

3. If installed from source, pull the latest code and reinstall:

\`\`\`
cd QwenPaw
git pull origin main
cd console && npm ci && npm run build
cd .. && mkdir -p src/aiarb/console
cp -R console/dist/. src/aiarb/console/
pip install -e .
\`\`\`

4. If using Docker, pull the latest image and restart the container:

\`\`\`
docker pull agentscope/aiarb:latest
docker run -p 127.0.0.1:8088:8088 -v aiarb-data:/app/working -v aiarb-secrets:/app/working.secret -v aiarb-backups:/app/working.backups agentscope/aiarb:latest
\`\`\`

After upgrading, restart the service with \`aiarb app\`.`,
};