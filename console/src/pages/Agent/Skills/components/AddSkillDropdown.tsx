import { Button, Dropdown } from "@agentscope-ai/design";
import type { MenuProps } from "antd";
import {
  AppstoreOutlined,
  BulbOutlined,
  DownloadOutlined,
  ImportOutlined,
  PlusOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";

interface AddSkillDropdownProps {
  onCreate: () => void;
  onAiCreate: () => void;
  /** Skills page only — omitted on the pool page (it IS the pool). */
  onFromPool?: () => void;
  onUploadZip: () => void;
  onFromUrl: () => void;
  onBrowseMarket: () => void;
  uploading?: boolean;
}

/**
 * Single entry point for every way of adding a skill: create, pull from the
 * skill pool, upload a zip, import from a hub URL, or browse the market.
 */
export function AddSkillDropdown({
  onCreate,
  onAiCreate,
  onFromPool,
  onUploadZip,
  onFromUrl,
  onBrowseMarket,
  uploading,
}: AddSkillDropdownProps) {
  const { t } = useTranslation();

  const items: MenuProps["items"] = [
    {
      key: "create",
      label: t("skills.createSkill"),
      icon: <PlusOutlined />,
      onClick: onCreate,
    },
    ...(onAiCreate
      ? [
          {
            key: "ai-create",
            label: t("skills.aiCreateSkill"),
            icon: <BulbOutlined />,
            onClick: onAiCreate,
          },
        ]
      : []),
    { type: "divider" },
    ...(onFromPool
      ? [
          {
            key: "from-pool",
            label: t("skills.downloadFromPool"),
            icon: <DownloadOutlined />,
            onClick: onFromPool,
          },
        ]
      : []),
    {
      key: "upload-zip",
      label: t("skills.uploadZip"),
      icon: <UploadOutlined />,
      disabled: uploading,
      onClick: onUploadZip,
    },
    {
      key: "from-url",
      label: t("skills.importHub"),
      icon: <ImportOutlined />,
      onClick: onFromUrl,
    },
    { type: "divider" },
    {
      key: "market",
      label: t("market.browseMarket"),
      icon: <AppstoreOutlined />,
      onClick: onBrowseMarket,
    },
  ];

  return (
    <Dropdown menu={{ items }} placement="bottomRight">
      <Button type="primary" icon={<PlusOutlined />} loading={uploading}>
        {t("skills.addSkill")}
      </Button>
    </Dropdown>
  );
}
