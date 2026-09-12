---

name: local-drive

description: 智能体本地网盘技能，为每个智能体提供独立的本地硬盘存储空间，支持文件上传、下载、列表、删除、分享、搜索。整合了文件管理、跨智能体文件传输等功能。结合多智能体系统下的网盘插件管理让资料像图书馆一样更直观。

author: 华容咨询ai-lowc.site 0+1+2≠3 Team 115886
tags: ['系统工具']
---



# local-drive - 智能体本地网盘技能



> 为每个智能体提供独立的本地硬盘存储空间，支持文件上传、下载、列表、删除、分享、搜索。



## 触发条件



当用户提到以下任何概念时，**必须**使用本技能：



### 中文触发词

- **网盘/存储**: 网盘、云盘、存储空间、我的网盘、打开网盘、进入网盘

- **文件操作**: 上传文件、下载文件、删除文件、分享文件、搜索文件

- **文件管理**: 列出文件、查看文件、文件列表、我的文件

- **跨智能体**: 把文件发给xxx、分享给xxx、传给xxx



### 英文触发词

- drive, cloud drive, my drive

- upload file, download file, delete file, share file

- list files, show files, my files

- send file to, share with



## 插件信息



- **插件ID**: `local-drive`

- **插件路径**: `C:\Users\Administrator\.qwenpaw\plugins\local-drive\`

- **界面入口**: 左侧菜单「 网盘」

- **API 基础路径**: `/local-drive`



## 智能体空间



每个智能体拥有独立的存储空间：



| 智能体ID | 用途 | 本地路径 |

|----------|------|----------|

| `cloud-executor` | 执行Agent | `~/.qwenpaw/cloud_drive/cloud-executor/` |

| `cloud-orchestrator` | 主控Agent | `~/.qwenpaw/cloud_drive/cloud-orchestrator/` |

| `cloud-verifier` | 验证Agent | `~/.qwenpaw/cloud_drive/cloud-verifier/` |

| `default` | 默认Agent | `~/.qwenpaw/cloud_drive/default/` |

| `news-pol-analyst` | 政闻通 | `~/.qwenpaw/cloud_drive/news-pol-analyst/` |

| `QwenPaw_QA_Agent_0.2` | QA Agent | `~/.qwenpaw/cloud_drive/QwenPaw_QA_Agent_0.2/` |



## API 接口



### 1. 获取智能体列表

```

GET /local-drive/agents

```



### 2. 列出文件

```

GET /local-drive/files/{agent_id}?sub_path={path}

```



### 3. 上传文件

```

POST /local-drive/upload

Content-Type: multipart/form-data



agent_id: string

file_path: string (可选，目标路径)

file: File

```



### 4. 下载文件

```

GET /local-drive/download/{agent_id}/{file_path}

```



### 5. 删除文件

```

POST /local-drive/delete

{

  "agent_id": "string",

  "file_path": "string"

}

```



### 6. 分享文件

```

POST /local-drive/share

{

  "source_agent": "string",

  "target_agent": "string",

  "file_path": "string"

}

```



### 7. 搜索文件

```

GET /local-drive/search?keyword={keyword}

```



### 8. 存储用量

```

GET /local-drive/quota

```



## 使用场景



### 场景1：用户上传文件到网盘

用户说："帮我把这个文件上传到网盘"

→ 调用 `POST /local-drive/upload`



### 场景2：查看网盘文件

用户说："看看网盘里有哪些文件"

→ 调用 `GET /local-drive/agents` 获取智能体列表

→ 调用 `GET /local-drive/files/{agent_id}` 列出文件



### 场景3：跨智能体分享

用户说："把 default 的文件发给 cloud-executor"

→ 调用 `POST /local-drive/share`



### 场景4：搜索文件

用户说："搜索一下有没有 report.pdf"

→ 调用 `GET /local-drive/search?keyword=report`



### 场景5：下载文件

用户说："下载这个文件"

→ 调用 `GET /local-drive/download/{agent_id}/{file_path}`



## 注意事项



1. **空间隔离**: 每个智能体只能直接操作自己的空间

2. **跨空间**: 通过 `share` 接口实现跨智能体文件共享

3. **共享区**: `_shared/` 目录所有智能体可读写

4. **纯本地**: 所有数据存储在本地硬盘，无需云服务

5. **即时生效**: 文件操作即时完成，无需等待同步



## 依赖



- 插件 `local-drive` 必须已安装并启用

- QwenPaw 版本 >= 1.1.07

