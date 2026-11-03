name: 功能请求
description: 提出新功能或改进建议
labels: ["enhancement", "待讨论"]
body:

- type: markdown
  attributes:
  value: |
  新功能建议请先对照[架构文档](../../docs/architecture/00-项目总体架构与MVP实施方案.md)的 §11「MVP 功能边界」。
  已被明确排除的功能（如 DOCX 导入导出、分页排版）请勿重复提出。

- type: textarea
  id: problem
  attributes:
  label: 要解决的问题
  description: |
  不要描述解决方案，先说明当前的做法哪里不够用。
  理想情况下包含一个具体场景：这个场景现在怎么做的，代价是什么。
  validations:
  required: true

- type: dropdown
  id: scope
  attributes:
  label: 与现有边界的关系
  options:
  - 在 MVP 范围内，补充已有功能
  - 在 MVP 范围内，新功能
  - 超出 MVP 范围，属于后续阶段
  - 不确定，请维护者判断
    validations:
    required: true

- type: textarea
  id: proposal
  attributes:
  label: 期望的方案
  description: 你倾向怎么实现。如果有多种思路，都列出来更好

- type: textarea
  id: alternatives
  attributes:
  label: 考虑过的其他方案
  description: 以及为什么没有选它们

- type: textarea
  id: impact
  attributes:
  label: 影响面
  description: |
  这个改动会碰到哪些模块？特别关注：- 是否涉及 §4.2 的架构不变式 - 是否改动 §7.2 的表结构 - 是否改动 §8.2 的权限判定
  validations:
  required: true

- type: textarea
  id: alternatives2
  attributes:
  label: 参考资料
  description: 截图、文档链接、竞品行为等
