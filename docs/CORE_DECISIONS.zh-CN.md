# OpenGrove 核心产品与技术判断

本文记录 OpenGrove 需要长期保持稳定的关键产品与技术判断。它用于沉淀影响全局的简明结论：产品边界、kernel 责任、扩展概念、挂载 App、workspace 行为，以及未来后端化执行。

它不是 backlog，也不是长篇设计方案。较长的实验、推演和敏感验证记录可以放在 `docs.local/`；一旦某个判断成为产品方向，就应提炼到本文或 `docs/` 下的其他聚焦文档里。

## 产品边界

OpenGrove 是 local-first 的 agent workspace 和 host layer。它不应该替代 Codex、Claude Code 等原生 agent runtime。原生 kernel 继续拥有自己的模型循环、原生工具、会话语义、上下文压缩、provider 行为和 runtime 专属配置。

OpenGrove 负责包在这些 kernel 外面的产品面：Rooms、App/workspace 工作台、设置、审批、记忆、产物、预览、扩展清单，以及归一化的运行历史。

## 能力模型

- **Skill**：给 agent 看的业务操作说明。Skill 说明什么时候做、怎么做、注意什么，但它不是稳定的执行接口。
- **CLI**：业务级可执行能力。Codex、Claude Code 和其他 kernel 可以通过自己的原生命令执行工具直接运行 CLI。CLI 默认不需要包装成 OpenGrove tool。
- **Tool**：带 schema、policy 和结果边界的结构化可调用动作。只有当某个 CLI 工作流需要更强控制时，才把它包装成 tool，例如表单化输入、权限、审计、跨 kernel 复用，或托管 run/artifact。
- **MCP**：工具服务器。一个 MCP server 通过 Model Context Protocol 向 kernel 暴露一个或多个结构化 tools。
- **Plugin**：kernel 生态里的打包单位。Codex 或 Claude plugin 可以打包 skills、MCP 配置、assets 和 interface metadata。它是分发格式，不是 OpenGrove 的主要业务边界。
- **OpenGrove App**：OpenGrove 的产品/业务包。App 可以在一个挂载根目录下组织 UI、workspace 文件、skills、CLIs、MCP 配置、hooks、assets，以及未来的结构化 tools。

一句话：Skill 教 agent 怎么做；CLI 执行业务动作；Tool 提供结构化、可控的调用入口；MCP 服务一组 tools；Plugin 打包 kernel-native 扩展；OpenGrove App 把它们组织成一个产品 workspace。

## Kernel 与 Tool 边界

OpenGrove 应保留原生 kernel 的真实行为，而不是假装所有 agent runtime 都长得一样。

- **Kernel native tools** 归 kernel 所有。Codex 和 Claude Code 在它们自己的 runtime 环境里执行 shell、文件、编辑、web、MCP 和审批流程。OpenGrove 只把这些事件映射到自己的 timeline。
- **OpenGrove host tools** 归 OpenGrove 所有。它们通过 runtime 专属桥接暴露给 kernel，例如 Codex dynamic tools，或 Claude Code 的进程内 OpenGrove MCP server，并通过 OpenGrove 的 policy 和 stores 执行。
- **CLI 可以处在两边**。Agent 可以通过 native command execution 直接运行 CLI；当产品需要更强结构和控制时，OpenGrove 也可以把 CLI 包到 host tool 后面。
- **App runtime env 由宿主管理**。App 可以声明自己需要把哪些 provider key
  映射成环境变量。OpenGrove 从 Provider 设置里解析这些 key，只注入到这个
  App 的 runtime 进程中。密钥不能被复制进 prompt、事件日志、扩展 inventory
  或 workspace 文件。
- **原生 runtime 认证不一定是可复用 provider**。如果 OpenGrove 能检测到
  Gemini CLI 这类 kernel 已经完成认证，但拿不到可转移的 key，这条记录应标记为
  native-only。它只能证明该 kernel 自己可用，不能用于 App env injection，也不能
  被当成其他 kernel 或 App 可复用的 provider。

这让默认路径保持简单，同时为 managed runs、artifacts、workspace storage、permissions 和 backend workers 留出空间。

## App 与 Workspace 方向

OpenGrove App 是业务/产品包边界。它可以在一个挂载根目录下包含 UI、skills、CLIs、MCP 配置、hooks、assets 和 workspace 文件。

新建 App 有两条产品入口：导入已有 App，或根据用户描述创建 App。两条入口都应交给默认 kernel/agent 按 `opengrove-app-builder` 的边界执行；已有完整前端时优先接入，不重做；没有前端时才基于功能设计原生工作台，并优先复用 OpenGrove 共享组件。

开发者模式是 App 或项目的一种状态，不是独立的用户可见任务系统。Preview URL、标注、选中元素、语音备注、run metadata 和边界检查可以作为 developer-session context 挂到普通 conversation thread 上持久化；但用户体验上只应该是：进入某个 App 的开发者模式，在预览上标注，然后继续在同一个对话里工作。

Workspace 应被视为逻辑产品存储，而不只是本地文件夹。本地开发可以使用文件系统路径，但 API 应该能在不改变产品模型的前提下演进到服务端存储、对象存储、run artifacts 和 backend workers。

## 产品体验与工程卫生

- 原生 App 的默认视觉和交互风格要统一。用户没有特殊指定时，新增 App、页面、设置项和工作台应遵循 OpenGrove 既有设计语言；用户明确指定设计风格时，以用户指定为准。
- 代码要保持简洁、可读、易维护。不要留下无用代码、临时绕路、重复实现和过早抽象；能用现有模式解决的问题，不新造一套概念。
- 文档要及时更新。只要产品判断、App 规范、能力模型、安装方式或运行边界发生变化，就应同步更新 `docs/` 中对应的中英文文档。

## 文档规则

- `docs/` 放被 git 跟踪、当前可信、面向公开维护的项目文档。
- `docs.local/` 放不被 git 跟踪的本地草稿、敏感验证记录和长篇规划材料。
- 当本地草稿里的内容成为稳定产品或技术判断时，应把结论摘要到本文或 `docs/` 下的其他聚焦文档。
