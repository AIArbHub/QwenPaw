import React, { useState, useCallback, useRef } from "react";
import { Modal, message, Button } from "antd";
import { DeleteOutlined, ShareAltOutlined, DownloadOutlined } from "@ant-design/icons";

/**
 * 从消息 data 中提取纯文本内容
 * 支持 string、array(content blocks) 等多种格式
 */
function extractContent(data: unknown): string {
  if (!data) return "";
  // 直接是字符串
  if (typeof data === "string") return data;
  // data.data.content 结构
  const d = data as Record<string, unknown>;
  const inner = d.data as Record<string, unknown> | undefined;
  const content = inner?.content ?? d.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as Record<string, unknown>[])
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text as string)
      .join("\n");
  }
  return String(content ?? "");
}

/**
 * 消息删除操作按钮
 * 点击后删除当前消息气泡
 */
export const MessageDeleteAction: React.FC<{
  onClick: () => void;
}> = ({ onClick }) => {
  const handleClick = useCallback(() => {
    Modal.confirm({
      title: "确认删除",
      content: "确定要删除这条消息吗？此操作不可恢复。",
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: onClick,
    });
  }, [onClick]);

  return (
    <span
      title="删除"
      style={{ cursor: "pointer", fontSize: 16, color: "#8c8c8c", padding: "0 4px" }}
      onClick={handleClick}
    >
      <DeleteOutlined />
    </span>
  );
};

/**
 * 消息分享操作按钮
 * 点击后生成带水印的分享图片
 * 如果 content 为空，会从最近的气泡 DOM 中提取文本
 */
export const MessageShareAction: React.FC<{
  content?: string;
  sender?: string;
  timestamp?: number;
}> = ({ content, sender, timestamp }) => {
  const [showModal, setShowModal] = useState(false);
  const [imageData, setImageData] = useState<string>("");
  const btnRef = useRef<HTMLSpanElement>(null);

  const generateImage = useCallback(() => {
    // 获取文本内容：优先用 prop，否则从 DOM 提取
    let text = content || "";
    if (!text && btnRef.current) {
      // 从按钮向上找到气泡元素，再提取文本
      const bubble = btnRef.current.closest('[class*="bubble-start"], [class*="bubble-end"]');
      if (bubble) {
        // 尝试多种可能的内容选择器
        const contentEl = bubble.querySelector(
          '[class*="bubble-content"], [class*="markdown-body"], [class*="markdown"], [class*="content"]'
        );
        text = contentEl?.textContent?.trim() || bubble.textContent?.trim() || "";
      }
    }
    const finalText = text || "(无内容)";
    const senderName = sender || "";

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const canvasWidth = 600;
    const padding = 40;
    const headerHeight = 80;
    const footerHeight = 60;
    const lineHeight = 24;
    const textStartX = padding + 10;
    const maxLineWidth = canvasWidth - padding * 2 - 20; // = 500

    // 设置字体后再计算换行
    ctx.font = "14px Arial";

    // 先按换行符分割成段落，再对每个段落逐字符计算换行
    const allLines: string[] = [];
    const paragraphs = finalText.split("\n");
    for (const para of paragraphs) {
      if (!para) {
        allLines.push("");
        continue;
      }
      let currentLine = "";
      for (let i = 0; i < para.length; i++) {
        const testLine = currentLine + para[i];
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxLineWidth && currentLine) {
          allLines.push(currentLine);
          currentLine = para[i];
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) allLines.push(currentLine);
    }

    const messageHeight = Math.max(allLines.length * lineHeight + padding * 2, 100);

    canvas.width = canvasWidth;
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

    if (senderName) {
      ctx.font = "13px Arial";
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      ctx.fillText(senderName, padding, 70);
    }

    // 消息内容背景
    ctx.fillStyle = "#f5f5f5";
    ctx.fillRect(padding, headerHeight + 10, canvas.width - padding * 2, messageHeight - 20);

    // 消息内容
    ctx.fillStyle = "#262626";
    ctx.font = "14px Arial";
    ctx.textAlign = "left";

    let y = headerHeight + 30;
    for (const line of allLines) {
      ctx.fillText(line, padding + 10, y);
      y += lineHeight;
    }

    // Footer - 水印
    ctx.fillStyle = "#fafafa";
    ctx.fillRect(0, canvas.height - footerHeight, canvas.width, footerHeight);

    ctx.fillStyle = "#8c8c8c";
    ctx.font = "12px Arial";
    ctx.textAlign = "center";
    ctx.fillText("AI Arb", canvas.width / 2, canvas.height - footerHeight + 25);
    ctx.fillText("www.aiarb.cn", canvas.width / 2, canvas.height - footerHeight + 45);

    const dataUrl = canvas.toDataURL("image/png");
    setImageData(dataUrl);
    setShowModal(true);
  }, [content, sender]);

  const downloadImage = useCallback(() => {
    if (!imageData) return;

    const link = document.createElement("a");
    link.download = `aiarb-${Date.now()}.png`;
    link.href = imageData;
    link.click();
    message.success("图片已下载");
  }, [imageData]);

  return (
    <>
      <span
        ref={btnRef}
        title="分享"
        style={{ cursor: "pointer", fontSize: 16, color: "#8c8c8c", padding: "0 4px" }}
        onClick={generateImage}
      >
        <ShareAltOutlined />
      </span>

      {/* 分享模态框 */}
      {showModal && (
        <Modal
          title="分享聊天记录"
          open={showModal}
          onCancel={() => setShowModal(false)}
          footer={[
            <Button key="close" onClick={() => setShowModal(false)}>
              关闭
            </Button>,
            <Button
              key="download"
              type="primary"
              icon={<DownloadOutlined />}
              onClick={downloadImage}
            >
              下载图片
            </Button>,
          ]}
          width={700}
        >
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <p style={{ color: "#8c8c8c", fontSize: 14 }}>
              右键点击图片可保存到本地
            </p>
          </div>
          {imageData && (
            <img
              src={imageData}
              alt="Share"
              style={{
                maxWidth: "100%",
                borderRadius: 8,
                boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
              }}
            />
          )}
        </Modal>
      )}
    </>
  );
};

/**
 * 多选分享组件 - 支持选中多条消息后批量分享
 * 通过全局事件控制选择模式
 */
export const MessageMultiSelectBar: React.FC<{
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onDelete: () => void;
  onShare: () => void;
  onCancel: () => void;
}> = ({ selectedCount, totalCount, onSelectAll, onDelete, onShare, onCancel }) => {
  if (selectedCount === 0) return null;
  return (
    <div
      style={{
        padding: "10px 16px",
        background: "#f0f5ff",
        borderBottom: "1px solid #d6e4ff",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        zIndex: 100,
      }}
    >
      <span style={{ color: "#1890ff", fontWeight: 500, fontSize: 13 }}>
        已选 {selectedCount}/{totalCount} 条
      </span>
      <div style={{ display: "flex", gap: 8 }}>
        <Button size="small" onClick={onSelectAll}>
          {selectedCount === totalCount ? "取消全选" : "全选"}
        </Button>
        <Button size="small" danger icon={<DeleteOutlined />} onClick={onDelete}>
          删除选中
        </Button>
        <Button size="small" type="primary" icon={<ShareAltOutlined />} onClick={onShare}>
          分享选中
        </Button>
        <Button size="small" onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
};

export { extractContent };

