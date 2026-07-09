import { useCallback, useRef, useState } from "react";
import { Dropdown, Modal, message } from "antd";
import { DeleteOutlined, ShareAltOutlined } from "@ant-design/icons";
import type { MenuProps } from "antd";

interface MessageContextMenuProps {
  children: React.ReactNode;
  messageData?: {
    id?: string;
    content?: string;
    sender?: string;
    timestamp?: number;
  };
}

/**
 * 消息右键菜单组件
 * 支持删除和分享功能
 */
export default function MessageContextMenu({
  children,
  messageData,
}: MessageContextMenuProps) {
  const [shareImage, setShareImage] = useState<string>("");
  const [showShareModal, setShowShareModal] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 处理删除
  const handleDelete = useCallback(() => {
    if (!messageData?.id) return;
    
    Modal.confirm({
      title: "确认删除",
      content: "确定要删除这条消息吗？此操作不可恢复。",
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: () => {
        // 查找消息元素并删除
        const messageEl = containerRef.current?.querySelector(
          `[data-message-id="${messageData.id}"]`
        );
        if (messageEl) {
          messageEl.remove();
          message.success("已删除");
        }
      },
    });
  }, [messageData]);

  // 生成分享图片
  const generateShareImage = useCallback(async () => {
    if (!messageData?.content) return;

    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // 计算尺寸
      const padding = 40;
      const headerHeight = 80;
      const footerHeight = 60;
      const lineHeight = 24;
      const content = messageData.content;
      
      // 简单估算高度
      const charPerLine = 40;
      const lineCount = Math.ceil(content.length / charPerLine);
      const messageHeight = Math.max(lineCount * lineHeight + padding * 2, 100);
      
      canvas.width = 600;
      canvas.height = headerHeight + messageHeight + footerHeight;

      // 背景
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Header
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
      gradient.addColorStop(0, "#1890ff");
      gradient.addColorStop(1, "#722ed1");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, headerHeight);

      // 标题
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 24px Arial";
      ctx.fillText("AI Arb", padding, 50);

      // 消息内容
      ctx.fillStyle = "#f5f5f5";
      ctx.fillRect(padding, headerHeight + 10, canvas.width - padding * 2, messageHeight - 20);

      ctx.fillStyle = "#262626";
      ctx.font = "14px Arial";
      
      // 简单的文本换行
      let y = headerHeight + 30;
      let line = "";
      for (let i = 0; i < content.length; i++) {
        const testLine = line + content[i];
        const metrics = ctx.measureText(testLine);
        if (metrics.width > canvas.width - padding * 2 - 20) {
          ctx.fillText(line, padding + 10, y);
          line = content[i];
          y += lineHeight;
        } else {
          line = testLine;
        }
      }
      if (line) {
        ctx.fillText(line, padding + 10, y);
      }

      // Footer - 水印
      ctx.fillStyle = "#fafafa";
      ctx.fillRect(0, canvas.height - footerHeight, canvas.width, footerHeight);
      
      ctx.fillStyle = "#8c8c8c";
      ctx.font = "12px Arial";
      ctx.textAlign = "center";
      ctx.fillText("AI Arb", canvas.width / 2, canvas.height - footerHeight + 25);
      ctx.fillText("www.aiarb.cn", canvas.width / 2, canvas.height - footerHeight + 45);

      // 转换为图片
      const dataUrl = canvas.toDataURL("image/png");
      setShareImage(dataUrl);
      setShowShareModal(true);
    } catch {
      message.error("生成分享图片失败");
    }
  }, [messageData]);

  // 下载图片
  const downloadImage = useCallback(() => {
    if (!shareImage) return;
    
    const link = document.createElement("a");
    link.download = `ai-arb-chat-${Date.now()}.png`;
    link.href = shareImage;
    link.click();
    message.success("图片已下载");
  }, [shareImage]);

  // 菜单项
  const items: MenuProps["items"] = [
    {
      key: "delete",
      label: "删除",
      icon: <DeleteOutlined />,
      danger: true,
      onClick: handleDelete,
    },
    {
      key: "share",
      label: "分享",
      icon: <ShareAltOutlined />,
      onClick: generateShareImage,
    },
  ];

  return (
    <>
      <div ref={containerRef}>
        <Dropdown
          menu={{ items, onClick: (e) => e.domEvent.stopPropagation() }}
          trigger={["contextMenu"]}
          overlayStyle={{ zIndex: 1000 }}
        >
          <div style={{ cursor: "default" }}>{children}</div>
        </Dropdown>
      </div>

      {/* 分享模态框 */}
      <Modal
        title="分享聊天记录"
        open={showShareModal}
        onCancel={() => setShowShareModal(false)}
        footer={[
          <button key="close" onClick={() => setShowShareModal(false)}>
            关闭
          </button>,
          <button
            key="download"
            onClick={downloadImage}
            style={{
              background: "#1890ff",
              color: "#fff",
              border: "none",
              padding: "4px 16px",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            下载图片
          </button>,
        ]}
        width={700}
      >
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <p style={{ color: "#8c8c8c", fontSize: 14 }}>
            右键点击图片可保存到本地
          </p>
        </div>
        {shareImage && (
          <img
            src={shareImage}
            alt="Share"
            style={{
              maxWidth: "100%",
              borderRadius: 8,
              boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
            }}
          />
        )}
      </Modal>
    </>
  );
}