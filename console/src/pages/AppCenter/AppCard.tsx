/**
 * AppCard.tsx — Individual app card for the App Center grid.
 */
import { Card, Tag, Typography, Tooltip } from "antd";
import { AppWindow, Trash2, Lock } from "lucide-react";
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { pickLocalised } from "@/utils/pluginI18n";
import styles from "./index.module.less";

const { Text, Paragraph } = Typography;

export interface AppCardData {
  id: string;
  name: string;
  name_i18n?: Record<string, string> | null;
  version: string;
  description: string;
  description_i18n?: Record<string, string> | null;
  category: string;
  icon: string;
  entry_page: string;
  launch_scope?: string;
  status: string;
  builtin?: boolean;
}

interface AppCardProps {
  app: AppCardData;
  onClick: (app: AppCardData) => void;
  /** When provided, renders an uninstall action on the card. */
  onUninstall?: (app: AppCardData) => void;
}

export const AppCard: FC<AppCardProps> = ({ app, onClick, onUninstall }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const displayName = pickLocalised(app.name_i18n, lang, app.name);
  const displayDesc = pickLocalised(
    app.description_i18n,
    lang,
    app.description,
  );

  return (
    <Card className={styles.appCardLarge} onClick={() => onClick(app)}>
      {app.builtin ? (
        <Tooltip title={t("appCenter.builtin", "内置应用")}>
          <span className={styles.cardUninstall} style={{ cursor: "default" }}>
            <Lock size={16} />
          </span>
        </Tooltip>
      ) : (
        onUninstall && (
          <Tooltip title={t("appCenter.uninstall", "卸载")}>
            <button
              type="button"
              className={styles.cardUninstall}
              onClick={(e) => {
                e.stopPropagation();
                onUninstall(app);
              }}
            >
              <Trash2 size={18} />
            </button>
          </Tooltip>
        )
      )}
      <div className={styles.appCardIconLarge}>
        {app.icon ? (
          <span className={styles.appEmojiLarge}>{app.icon}</span>
        ) : (
          <AppWindow size={48} strokeWidth={1.5} />
        )}
      </div>
      <div className={styles.appCardBody}>
        <div className={styles.appCardHeader}>
          <Text strong className={styles.appCardTitleLarge}>
            {displayName}
          </Text>
          {app.version && (
            <span className={styles.appCardVersionLarge}>{app.version}</span>
          )}
        </div>
        <Paragraph
          type="secondary"
          className={styles.appCardDescLarge}
          ellipsis={{ rows: 2 }}
        >
          {displayDesc || "No description"}
        </Paragraph>
        {app.category && (
          <Tag bordered={false} className={styles.appCardTagLarge}>
            {app.category}
          </Tag>
        )}
      </div>
    </Card>
  );
};
