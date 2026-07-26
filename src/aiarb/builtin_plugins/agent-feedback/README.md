# 评分反馈插件 (Agent Feedback Plugin)

## 概述

评分反馈插件提供用户对智能体回复的评分反馈功能，汇总统计各 Agent 的评分数据。

## 功能

### 1. 评分提交

- 用户可对 Agent 进行 1-5 星评分
- 支持附带评论和标签

### 2. 评分汇总

- 计算 Agent 的平均评分
- 评分分布统计（1-5 星各多少条）
- 最近评论展示

### 3. 前端展示

- 评分反馈页面（`/feedback`）
- Workbench OverviewTab 中展示评分数据
- 成长时间轴页面展示评分趋势

## API

| 端点 | 方法 | 描述 |
|------|------|------|
| `/feedback/feedback` | POST | 创建评分 |
| `/feedback/feedback` | GET | 列出评分 |
| `/feedback/feedback/summary/{agent_id}` | GET | Agent 评分汇总 |
| `/feedback/feedback/{id}` | DELETE | 删除评分 |

## 存储

- 数据文件：`~/.aiarb/feedback/feedbacks.json`
