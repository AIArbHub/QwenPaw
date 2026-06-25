# 会话记忆 - 2025年6月25日

## 一、硅基流动推荐信息

在系统多个位置添加了硅基流动推荐横幅：注册即送全平台通用代金券 16 元（邀请码 KvmTp5P8），链接到 `https://cloud.siliconflow.cn/i/KvmTp5P8`。

**修改的文件：**
- `console/src/pages/Settings/Models/index.tsx` — 在"可用提供商"标题下方添加 `Alert`
- `console/src/pages/Settings/Models/components/cards/ProviderGroupCard.tsx` — 在 group card 中添加
- `console/src/pages/Settings/Models/components/cards/RemoteProviderCard.tsx` — 在 remote provider card 中添加
- `console/src/pages/Settings/Models/components/modal/ProviderConfigModal.tsx` — 在配置弹窗中添加
- `website/public/docs/models.zh.md` — 中文文档中添加
- `website/public/docs/models.en.md` — 英文文档中添加

## 二、修复 OpenRouter OAuth 连接 Method Not Allowed

**问题：** 点击"连接 OpenRouter"后弹出授权窗口，点击继续报 `Method Not Allowed - {"detail":"Method Not Allowed"}`。

**原因：** `provider_oauth` 路由模块没有被注册到 FastAPI 应用中。

**修复：** 在 `src/qwenpaw/app/routers/__init__.py` 中添加导入和注册：
```python
from .provider_oauth import router as provider_oauth_router
router.include_router(provider_oauth_router)
```

## 三、聊天长时间不回复提示

为聊天界面添加超时提示功能。当模型响应超过30秒未返回时，在页面右下角显示警告提示。

**新增文件：** `console/src/pages/Chat/components/ResponseTimeout.tsx` — 超时检测组件，使用 `useState` + `setTimeout` 实现，超过30秒显示 `Alert`，icon 用 `LoadingOutlined`（注意：不能从 `@agentscope-ai/design` 导入 `Spin`，该库未导出此组件）。

**修改文件：**
- `console/src/pages/Chat/index.tsx` — 导入并使用 `ResponseTimeout` 组件，传入 `isWaiting` 状态
- `console/src/locales/zh.json` — 添加 `chat.queue.longResponseTime`、`chat.queue.checkConnection` 翻译
- `console/src/locales/en.json` — 对应英文翻译

**⚠️ 重要：** `@agentscope-ai/design` 不导出 `Spin` 组件。如果从该库导入不存在的导出，会导致页面空白（整个 JS 加载失败）。使用 `@ant-design/icons` 的 `LoadingOutlined` 替代。

## 四、修复页面空白（Spin 导入错误）

**问题：** localhost:5173 空白页，报错 `SyntaxError: The requested module does not provide an export named 'Spin'`。

**修复：** 将 `ResponseTimeout.tsx` 中的 `Spin` 替换为 `LoadingOutlined`，清除 Vite 缓存后重启服务。

**Vite 缓存路径：** `console/node_modules/.vite` — 如果热更新不生效，删除此目录后刷新。

## 五、iMessage 频道 macOS 限制提醒

在 iMessage 频道配置表单顶部添加黄色警告横幅。

**修改文件：**
- `console/src/pages/Control/Channels/components/ChannelDrawer.tsx` — 在 `case "imessage"` 中添加 `Alert`
- `console/src/locales/zh.json` — `imessageMacOsOnly`、`imessageMacOsOnlyDesc`
- `console/src/locales/en.json` — 对应英文翻译

文案：iMessage 频道仅支持 macOS，依赖本地「信息」应用与 iMessage 数据库，无法在 Linux / Windows 上使用。

## 六、控制台频道说明

**频道名称：** 中文"控制台"，英文"Console"（通过 i18n `channels.channelNames.console`）

**提示说明：** 控制台即系统内置的聊天界面。（通过 i18n `channels.consoleChannelDesc` 管理）

**默认状态：** 修改 `console/src/pages/Control/Channels/index.tsx` 第77行，控制台频道首次打开时默认 `enabled: true`，可手动开关。

**修改文件：**
- `console/src/pages/Control/Channels/components/ChannelDrawer.tsx` — 添加 console 说明 `Alert`、恢复 enabled 开关
- `console/src/pages/Control/Channels/index.tsx` — console 默认 `enabled: true`
- `console/src/locales/zh.json` — 添加 `channelNames.console`、`consoleChannelTitle`、`consoleChannelDesc`
- `console/src/locales/en.json` — 对应英文翻译

## 七、多语种 i18n 规范

所有用户可见的文案均应通过 i18n 国际化处理，在 `console/src/locales/zh.json` 和 `en.json` 中添加翻译 key，组件中使用 `t("key")` 引用。不要直接在组件中硬编码中文或英文文案。

## 八、前后端服务

- **前端：** `cd console; npx vite --host --port 5173` — 端口 5173
- **后端：** `cd .; .\.venv\Scripts\python.exe -m qwenpaw app --reload --port 8088` — 端口 8088
- 后端修改路由注册后需重启才能生效

## 九、OpenCode API 连接问题

`https://opencode.ai/zen/go/v1/chat/completions` 返回 `TunnelUnexpectedEof` + HTTP 500，这是外部服务问题，非本项目 Bug。建议用户切换到硅基流动等稳定提供商。
