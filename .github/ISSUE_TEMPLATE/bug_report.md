name: Bug 报告
description: 报告一个可复现的缺陷
labels: ["bug", "待确认"]
body:

- type: markdown
  attributes:
  value: |
  感谢反馈。请先确认这个缺陷是否已在[架构文档](../../docs/architecture/00-项目总体架构与MVP实施方案.md)中作为"设计取舍"被明确排除。

- type: textarea
  id: summary
  attributes:
  label: 一句话描述
  description: 什么坏了，表现为可见的结果是什么
  validations:
  required: true

- type: textarea
  id: reproduce
  attributes:
  label: 复现步骤
  description: |
  从零开始的、编号的步骤。每一步应该只有一个动作。1. 2. 3.
  validations:
  required: true

- type: textarea
  id: expected
  attributes:
  label: 期望结果
  description: 你认为正确行为应该是什么
  validations:
  required: true

- type: textarea
  id: actual
  attributes:
  label: 实际结果
  description: 实际发生了什么。如果有报错，请粘贴完整错误堆栈
  validations:
  required: true

- type: dropdown
  id: phase
  attributes:
  label: 涉及阶段
  description: 该缺陷出现在哪个阶段的功能里
  options:
  - Phase 1：平台骨架（账号/空间/树/权限/回收站）
  - Phase 2：单机文档（Schema/工具栏/自动保存）
  - Phase 3：多人协同（Yjs/落库/只读强制）
  - Phase 4：版本与评论
  - Phase 5：表格编辑器
  - 不确定
    validations:
    required: true

- type: textarea
  id: env
  attributes:
  label: 环境信息
  description: | - 操作系统：- Node 版本：- pnpm 版本：- 浏览器及版本：- 是否在开发模式：
  validations:
  required: true

- type: textarea
  id: logs
  attributes:
  label: 相关日志
  description: 服务端/客户端的相关日志输出（请先移除其中的令牌、密码等敏感信息）

- type: checkboxes
  id: checks
  attributes:
  label: 提交前确认
  options: - label: 我已搜索过现有 Issue，确认这不是重复报告 - label: 我已移除日志中的敏感信息（令牌、密码、Cookie）- label: 我确认这不属于架构文档中明确排除的功能范围
