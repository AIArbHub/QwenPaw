import React, { useState } from "react";
import { Modal, Form, Input, Button, Space } from "antd";
import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { agentsApi } from "../../api/modules/agents";
import { useAgentStore } from "../../stores/agentStore";
import { useAppMessage } from "../../hooks/useAppMessage";
import styles from "./index.module.less";

const { TextArea } = Input;

interface CreateAgentModalProps {
  open: boolean;
  onCancel: () => void;
  /** Called with the newly created agent id. */
  onCreated?: (agentId: string) => void;
}

const CreateAgentModal: React.FC<CreateAgentModalProps> = ({
  open,
  onCancel,
  onCreated,
}) => {
  const { t } = useTranslation();
  const { message } = useAppMessage();
  const { refreshAgents } = useAgentStore();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const handleCancel = () => {
    if (submitting) return;
    form.resetFields();
    onCancel();
  };

  const handleCreate = async () => {
    let values: { name?: string; description?: string; group?: string };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      const result = await agentsApi.createAgent({
        name: (values.name ?? "").trim(),
        description: (values.description ?? "").trim(),
        group: (values.group ?? "").trim(),
        language: "zh",
      });
      await refreshAgents();
      message.success(t("agent.createSuccess", "智能体已创建"));
      form.resetFields();
      onCancel();
      onCreated?.(result.id);
    } catch (err: unknown) {
      message.error(
        err instanceof Error
          ? err.message
          : t("agent.createFailed", "创建失败，请稍后重试"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={
        <span className={styles.modalTitle}>
          <Bot size={18} />
          {t("agent.createTitle", "新建智能体")}
        </span>
      }
      open={open}
      onCancel={handleCancel}
      centered
      width={520}
      className={styles.modalRoot}
      destroyOnClose
      footer={
        <div className={styles.modalFooter}>
          <span />
          <Space>
            <Button onClick={handleCancel} disabled={submitting}>
              {t("common.cancel", "取消")}
            </Button>
            <Button type="primary" loading={submitting} onClick={handleCreate}>
              {t("common.create", "创建")}
            </Button>
          </Space>
        </div>
      }
    >
      <Form form={form} layout="vertical" className={styles.form}>
        <Form.Item
          name="name"
          label={t("agent.name", "名称")}
          rules={[{ required: true, message: t("agent.nameRequired", "请输入名称") }]}
        >
          <Input
            autoFocus
            maxLength={40}
            showCount
            placeholder={t("agent.namePlaceholder", "如：仲裁员")}
          />
        </Form.Item>
        <Form.Item name="description" label={t("agent.description", "简介")}>
          <TextArea
            rows={3}
            maxLength={200}
            showCount
            placeholder={t("agent.descriptionPlaceholder", "简要介绍这个智能体")}
          />
        </Form.Item>
        <Form.Item
          name="group"
          label={t("agent.group", "分组")}
          extra={t("agent.groupHelp", "可选，用于在列表中分类管理智能体")}
        >
          <Input maxLength={20} placeholder={t("agent.groupPlaceholder", "如：争议解决")} />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default CreateAgentModal;
