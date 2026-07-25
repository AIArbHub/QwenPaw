import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Input,
  Modal,
  Select,
  Tooltip,
  message,
} from "@agentscope-ai/design";
import { Check, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAgentStore } from "../../../stores/agentStore";
import { useMarketSearch } from "./useMarketSearch";
import {
  useMarketInstall,
  type InstallTarget,
  type InstallQueueItem,
} from "./useMarketInstall";
import type { MarketResult } from "../../../api/modules/market";
import { envApi } from "../../../api/modules/env";
import { ResultCard, DetailDrawer, QueueItem, EmptyState } from "./components";
import styles from "./index.module.less";

function getCardKey(item: MarketResult) {
  return `${item.source}:${item.slug}`;
}

/** Memoized install queue panel — only re-renders when queue changes */
const InstallQueuePanel = memo(function InstallQueuePanel({
  queue,
  onClearCompleted,
  onCancel,
  onRetry,
}: {
  queue: InstallQueueItem[];
  onClearCompleted: () => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.queueDrawer}>
      <div className={styles.queueHeader}>
        <span>{t("market.installQueue")}</span>
        <Button size="small" onClick={onClearCompleted}>
          {t("market.clearCompleted")}
        </Button>
      </div>
      <div className={styles.queueList}>
        {queue.map((q) => (
          <QueueItem
            key={q.id}
            item={q}
            onCancel={onCancel}
            onRetry={onRetry}
          />
        ))}
      </div>
    </div>
  );
});

const PROVIDER_ENV_MAP: Record<
  string,
  {
    keys: string[];
    labels: Record<string, string>;
    helpUrl?: string;
    helpLabelKey?: string;
  }
> = {
  aliyun: {
    keys: ["ALIBABA_CLOUD_ACCESS_KEY_ID", "ALIBABA_CLOUD_ACCESS_KEY_SECRET"],
    labels: {
      ALIBABA_CLOUD_ACCESS_KEY_ID: "AccessKey ID",
      ALIBABA_CLOUD_ACCESS_KEY_SECRET: "AccessKey Secret",
    },
    helpUrl: "https://usercenter.console.aliyun.com/#/manage/ak",
    helpLabelKey: "market.configAliyunHelp",
  },
};

const ProviderChips = memo(function ProviderChips({
  providers,
  selectedKeys,
  onToggle,
  onRefreshProviders,
}: {
  providers: {
    key: string;
    label: string;
    available: boolean;
    reason?: string | null;
  }[];
  selectedKeys: Set<string>;
  onToggle: (key: string) => void;
  onRefreshProviders: () => void;
}) {
  const { t } = useTranslation();
  const [configuringProvider, setConfiguringProvider] = useState<string | null>(
    null,
  );
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [configSaving, setConfigSaving] = useState(false);

  const envSpec = configuringProvider
    ? PROVIDER_ENV_MAP[configuringProvider]
    : null;

  const handleOpenConfig = useCallback((providerKey: string) => {
    const spec = PROVIDER_ENV_MAP[providerKey];
    if (!spec) return;
    const initial: Record<string, string> = {};
    for (const k of spec.keys) {
      initial[k] = "";
    }
    setConfigValues(initial);
    setConfiguringProvider(providerKey);
  }, []);

  const handleConfigSave = useCallback(async () => {
    if (!configuringProvider || !envSpec) return;
    setConfigSaving(true);
    try {
      const currentEnvs = await envApi.listEnvs();
      const envMap: Record<string, string> = {};
      for (const e of currentEnvs) {
        envMap[e.key] = e.value;
      }
      for (const k of envSpec.keys) {
        const val = configValues[k]?.trim();
        if (!val) {
          message.error(
            t("market.configFieldRequired", { field: envSpec.labels[k] || k }),
          );
          setConfigSaving(false);
          return;
        }
        envMap[k] = val;
      }
      await envApi.saveEnvs(envMap);
      message.success(t("market.configSaved"));
      setConfiguringProvider(null);
      onRefreshProviders();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : t("market.configSaveFailed"),
      );
    } finally {
      setConfigSaving(false);
    }
  }, [configuringProvider, envSpec, configValues, onRefreshProviders, t]);

  return (
    <div className={styles.providerChips}>
      {providers.map((p) => {
        const active = selectedKeys.has(p.key);
        const hasConfig = !!PROVIDER_ENV_MAP[p.key];
        const klass = [
          styles.chip,
          active ? styles.chipActive : "",
          !p.available ? styles.chipDisabled : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <Tooltip
            key={p.key}
            title={
              p.available
                ? undefined
                : hasConfig
                ? t("market.providerConfigRequired")
                : p.reason ?? t("market.providerUnavailable")
            }
          >
            <span
              className={klass}
              onClick={p.available ? () => onToggle(p.key) : undefined}
              role="button"
              tabIndex={p.available ? 0 : -1}
              onKeyDown={(e) => {
                if (p.available && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onToggle(p.key);
                }
              }}
              aria-pressed={active}
              aria-disabled={!p.available}
            >
              {active && <Check size={12} strokeWidth={3} />}
              {p.label}
              {!p.available && hasConfig && (
                <Settings2
                  size={12}
                  className={styles.chipConfigIcon}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenConfig(p.key);
                  }}
                />
              )}
            </span>
          </Tooltip>
        );
      })}

      <Modal
        open={configuringProvider !== null}
        title={t("market.configProviderTitle", {
          provider: configuringProvider
            ? providers.find((p) => p.key === configuringProvider)?.label ??
              configuringProvider
            : "",
        })}
        okText={t("market.configSave")}
        cancelText={t("common.cancel")}
        onOk={handleConfigSave}
        onCancel={() => setConfiguringProvider(null)}
        confirmLoading={configSaving}
        destroyOnHidden
      >
        <div className={styles.configModalContent}>
          <p className={styles.configModalDesc}>
            {t("market.configProviderDesc", {
              provider: configuringProvider
                ? providers.find((p) => p.key === configuringProvider)?.label ??
                  configuringProvider
                : "",
            })}
          </p>
          {envSpec?.helpUrl && (
            <a
              className={styles.configHelpLink}
              href={envSpec.helpUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {envSpec.helpLabelKey
                ? t(envSpec.helpLabelKey)
                : t("market.configGetCredentials")}
            </a>
          )}
          {envSpec?.keys.map((k) => (
            <div key={k} className={styles.configField}>
              <label className={styles.configLabel}>
                {envSpec.labels[k] || k}
              </label>
              <Input.Password
                value={configValues[k] ?? ""}
                onChange={(e) =>
                  setConfigValues((prev) => ({ ...prev, [k]: e.target.value }))
                }
                placeholder={envSpec.labels[k] || k}
                autoComplete="off"
              />
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
});

/**
 * Single-select category dropdown (second filter layer).
 * The leading "All" option clears the filter.
 */
const CategorySelect = memo(function CategorySelect({
  categories,
  active,
  onSelect,
}: {
  categories: { id: string; label: string }[];
  active: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const options = useMemo(
    () => [
      { value: "", label: t("market.categoryAll") },
      ...categories.map((c) => ({ value: c.id, label: c.label })),
    ],
    [categories, t],
  );
  return (
    <Select
      className={styles.categorySelect}
      value={active || undefined}
      onChange={(v) => onSelect(v ?? "")}
      options={options}
      placeholder={t("market.categoryPlaceholder")}
      showSearch
      allowClear
      optionFilterProp="label"
      popupMatchSelectWidth={false}
      aria-label={t("market.categoryPlaceholder")}
    />
  );
});

function LoadMoreSentinel({ onVisible }: { onVisible: () => void }) {
  const { t } = useTranslation();
  const nodeRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onVisible();
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [onVisible]);
  return (
    <div ref={nodeRef} className={styles.sentinel}>
      {t("common.loading")}
    </div>
  );
}

/**
 * Embeddable market browser. The host page fixes the install destination:
 * Skills page saves into the current agent's workspace, Skill Pool page
 * imports into the pool.
 */
export function MarketPanel({
  installTarget,
  onInstalled,
}: {
  installTarget: InstallTarget;
  onInstalled?: () => void;
}) {
  const { t } = useTranslation();
  const selectedAgent = useAgentStore((s) => s.selectedAgent);
  const market = useMarketSearch();
  const [detailItem, setDetailItem] = useState<MarketResult | null>(null);
  const onInstalledRef = useRef(onInstalled);
  onInstalledRef.current = onInstalled;

  const handleInstalled = useCallback(() => {
    onInstalledRef.current?.();
  }, []);

  const install = useMarketInstall({
    selectedAgent,
    onSuccess: handleInstalled,
  });

  const installToWorkspace = useCallback(
    (item: MarketResult) => {
      install.enqueue([item], "workspace");
    },
    [install],
  );

  const installToPool = useCallback(
    (item: MarketResult) => {
      install.enqueue([item], "pool");
    },
    [install],
  );

  // Stable callbacks for DetailDrawer
  const detailItemRef = useRef(detailItem);
  detailItemRef.current = detailItem;

  const handleDetailInstallToWorkspace = useCallback(() => {
    const current = detailItemRef.current;
    if (current) {
      installToWorkspace(current);
      setDetailItem(null);
    }
  }, [installToWorkspace]);

  const handleDetailInstallToPool = useCallback(() => {
    const current = detailItemRef.current;
    if (current) {
      installToPool(current);
      setDetailItem(null);
    }
  }, [installToPool]);

  const handleDetailClose = useCallback(() => {
    setDetailItem(null);
  }, []);

  // Memoize breadcrumb items to avoid re-creating each render
  const headerItems = useMemo(
    () => [{ title: t("nav.settings") }, { title: t("nav.market") }],
    [t],
  );

  const nonBrowseLabel = useMemo(() => {
    return market.providers
      .filter(
        (p) =>
          p.available &&
          !p.supports_browse &&
          market.selectedProviderKeys.has(p.key),
      )
      .map((p) => p.label)
      .join(", ");
  }, [market.providers, market.selectedProviderKeys]);

  const browseLabel = useMemo(() => {
    return market.providers
      .filter(
        (p) =>
          p.available &&
          p.supports_browse &&
          market.selectedProviderKeys.has(p.key),
      )
      .map((p) => p.label)
      .join(", ");
  }, [market.providers, market.selectedProviderKeys]);

  const hasSelectedProvider = market.selectedProviderKeys.size > 0;

  const browseHintLabel =
    !market.category &&
    !market.query.trim() &&
    hasSelectedProvider &&
    browseLabel
      ? browseLabel
      : "";

  return (
    <div className={styles.marketPage}>
      <div className={styles.content}>
        <ProviderChips
          providers={market.providers}
          selectedKeys={market.selectedProviderKeys}
          onToggle={market.toggleProvider}
          onRefreshProviders={market.refreshProviders}
        />

        <div className={styles.toolbar}>
          {!hasSelectedProvider ? (
            <div className={styles.searchHint}>
              {t("market.selectProviderHint")}
            </div>
          ) : (
            <>
              {market.anyProviderSupportsBrowse && (
                <CategorySelect
                  categories={market.categories}
                  active={market.category}
                  onSelect={market.setCategory}
                />
              )}
              {!market.anyProviderSupportsBrowse && (
                <div className={styles.searchHint}>
                  {t("market.searchOnlyHint", { providers: nonBrowseLabel })}
                </div>
              )}
              <Input.Search
                className={styles.searchInput}
                placeholder={t("market.searchPlaceholder")}
                allowClear
                value={market.query}
                onChange={(e) => market.setQuery(e.target.value)}
                aria-label={t("market.searchPlaceholder")}
              />
            </>
          )}
        </div>

        {market.query.trim() && !market.loading && !market.globalError && (
          <div className={styles.searchHint}>
            {t("market.searchResult", {
              keyword: market.query.trim(),
              count: market.totalCount,
            })}
          </div>
        )}

        {browseHintLabel && (
          <div className={styles.browseHint}>
            {t("market.browseHint", { providers: browseHintLabel })}
          </div>
        )}

        {market.globalError && (
          <div className={styles.errorRow}>{market.globalError}</div>
        )}
        {market.errors.map((err) => {
          const provider = market.providers.find((p) => p.key === err.provider);
          const label = provider?.label ?? err.provider;
          return (
            <div className={styles.errorRow} key={err.provider}>
              <strong>{label}</strong>: {err.message}
            </div>
          );
        })}

        {market.loading && market.results.length === 0 ? (
          <EmptyState text={t("common.loading")} />
        ) : market.results.length === 0 && !market.query.trim() ? (
          <div className={styles.searchGuide}>
            <span className={styles.searchGuideIcon}>🔍</span>
            <span className={styles.searchGuideText}>
              {!hasSelectedProvider
                ? t("market.selectProviderGuide")
                : !market.anyProviderSupportsBrowse
                ? t("market.searchGuide", { providers: nonBrowseLabel })
                : t("market.browseEmpty")}
            </span>
            {(market.globalError || market.errors.length > 0) && (
              <Button
                onClick={market.retry}
                loading={market.loading}
                size="small"
              >
                {t("market.retry")}
              </Button>
            )}
          </div>
        ) : market.results.length === 0 &&
          (market.globalError || market.errors.length > 0) ? (
          <EmptyState text={t("market.noResults")}>
            <Button onClick={market.retry} loading={market.loading}>
              {t("market.retry")}
            </Button>
          </EmptyState>
        ) : market.results.length === 0 ? (
          <EmptyState text={t("market.noResults")} />
        ) : (
          <>
            <div className={styles.resultsGrid}>
              {market.results.map((item) => (
                <ResultCard
                  key={getCardKey(item)}
                  item={item}
                  onInstallToWorkspace={() => installToWorkspace(item)}
                  onInstallToPool={() => installToPool(item)}
                  onOpenDetail={() => setDetailItem(item)}
                />
              ))}
            </div>
            <div className={styles.loadMoreRow}>
              {market.hasMore && market.autoLoadBlocked ? (
                <Button onClick={market.loadMore} loading={market.loading}>
                  {t("market.loadMore")}
                </Button>
              ) : market.hasMore ? (
                <LoadMoreSentinel
                  key={market.results.length}
                  onVisible={market.autoLoadMore}
                />
              ) : (
                <span className={styles.noMoreText}>
                  {t("market.noMoreResults")}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {install.queue.length > 0 && (
        <InstallQueuePanel
          queue={install.queue}
          onClearCompleted={install.clearFinished}
          onCancel={install.cancel}
          onRetry={install.retry}
        />
      )}

      <DetailDrawer
        item={detailItem}
        onInstallToWorkspace={handleDetailInstallToWorkspace}
        onInstallToPool={handleDetailInstallToPool}
        onClose={handleDetailClose}
      />
    </div>
  );
}

export default MarketPanel;