# OpenGrove App 目录规范

OpenGrove App 是从 Settings -> Apps 挂载的本地目录。它是业务或产品专属能力的顶层单位：UI、skills、tools、MCP 配置、hooks、scripts 和 assets 可以共存于同一个根目录下。

OpenGrove 在用户设置里只保存 app root path、enabled state，以及可选的 display name。

关于 App、skill、CLI、tool、MCP 和 plugin 的系统级含义，见 [OpenGrove 核心产品与技术判断](./CORE_DECISIONS.zh-CN.md)。

在本文档里，App 指把这些能力组织进一个挂载 workspace 的顶层产品/业务包。

## App 平台入口

OpenGrove 的“新建应用”不是单纯保存一个路径，而是创建或接入一个可传递的工作台包。Settings -> Apps 提供两条入口：

- **导入已有 App**：用户提供本地目录或 URL。OpenGrove 把来源、可选名称和接入边界交给默认 kernel/agent。Agent 先判断来源是否已有完整 UI；已有 UI 时优先桥接，不重做界面。没有 UI 时，按能力设计原生工作台。
- **描述创建 App**：用户用自然语言描述工作台。Agent 根据功能生成 manifest、UI/工作区、必要 skill/CLI 文档和 smoke 数据。

导入或创建任务应触发 `opengrove-app-builder` skill。这个 skill 是 agent 的接入护栏：它要求 agent 明确 App 根目录、workspace 边界、UI 复用策略、命令契约、模型/API 依赖和验证结果。

导入来源要先分类再改动：

- 本地文件夹可以原地 inspect。
- Git/GitHub URL 要先 clone 到 OpenGrove 托管的 staging 目录。
- 压缩包 URL 要先下载并解压到 staging 目录。
- 普通项目路径或 URL 要先判断它是 Web 项目、CLI 工具包、脚本集合、资料目录还是混合项目，再决定是桥接、补 scaffold，还是生成 UI。

OpenGrove 给 agent 提供确定性的辅助命令：

```bash
opengrove app inspect <source>
opengrove app import <source> --target <app-dir> --id <id>
opengrove app stage <source> --apps-dir <managed-apps-dir> --id <id>
opengrove app scaffold <target> --id <id> --title <title>
opengrove app validate <app-root>
opengrove app report <app-root>
opengrove app mount <app-root> --settings <settings-path>
```

这些命令不替代 agent 判断；它们负责把 App 边界、manifest 契约和验证结果变成可复现的步骤。

`stage` 是导入落盘步骤：Git 来源会 clone，压缩包会下载并解压，本地目录可以原地引用，也可以用 `--copy` 复制到托管目录。`report` 会合并来源分类、manifest 校验和建议挂载项。`mount` 只在 App 已经可挂载后，更新明确指定的 bridge settings 文件。

## UI 策略

App UI 的选择顺序：

1. 已有完整前端：保留原界面，通过 manifest 和必要桥接接入 OpenGrove。
2. 文件/产物型工作流：使用 `ui.kind: "file-workbench"`，让 OpenGrove 原生文件树、预览和 App 对话面板负责体验。
3. 无界面但有明确业务流程：基于功能设计原生工作台，优先复用 OpenGrove 现有组件。

通用行为必须优先抽成共享组件，再由业务 adapter 接回去。目录树、Markdown/媒体预览、设置表单、状态列表、对话面板等不应为单个 App 复制一份。若现有组件绑了业务逻辑，应先拆出无业务的组件层。

## Workspace 写入体验

如果 App 会产生用户可见文件，默认应写入：

```text
workspace/runs/<task-or-command>-<timestamp>/
```

文件工作台必须支持用户能理解的基本操作：浏览、预览、新建文件/文件夹、重命名、移动、删除、刷新。所有写操作都必须限制在 manifest 声明的 workspace 或 App 根目录内。

## 必需根文件

每个 app 应提供一个 manifest：

```text
opengrove.app.json
```

最小 manifest：

```json
{
  "id": "opengrove-vfs",
  "title": "VFS",
  "description": "Private VFS workflows for OpenGrove.",
  "version": "0.1.0"
}
```

`id` 必须稳定且 URL-safe。`title`、`description` 和 `version` 只用于展示和 inventory。

## 能力目录

OpenGrove 会扫描 app root 下的这些路径：

```text
opengrove.app.json
skills/<skill-name>/SKILL.md
skills/<group>/<skill-name>/SKILL.md
bin/<local-cli>
tools/
mcp.json
hooks.json
ui/
assets/
workspace/
```

当前 runtime 行为：

- `skills/` 会在 app 启用时加载到 skill catalog。App 可以把 skill 直接放在 `skills/<skill-name>/SKILL.md`，也可以让 OpenGrove 递归发现分组后的 skill roots，或者用 `skills.roots` 显式声明。
- `capabilities.cli` 中声明的 CLI 会进入扩展 inventory；它们仍然是 agent 可通过 Bash 运行的业务原子能力，不会默认变成 tool。
- `mcp.json` 和 `hooks.json` 会作为 app-owned external configuration roots 暴露给支持这些概念的 kernels。
- `ui/` 和 `tools/` 是规范保留路径，用于未来 App 在同一个根目录下打包用户界面和结构化 tool definitions。
- `workspace/` 是 App 的默认产物目录；OpenGrove 文件树、raw file API 和预览会通过 WorkspaceStore 读取它。

## CLI 声明

App 可以在 manifest 里显式声明业务 CLI：

```json
{
  "capabilities": {
    "cli": [
      {
        "id": "vfs-editing-project",
        "title": "VFS Editing Project",
        "command": "./bin/vfs-editing-project",
        "doctor": ["doctor"],
        "smoke": ["smoke"],
        "env": ["VFS_EDITING_PROJECT_ROOT"],
        "artifacts": ["workspace/runs/**"],
        "allowNativeBash": true
      }
    ]
  }
}
```

OpenGrove 会解析相对路径、检查命令是否可执行，并把结果展示在扩展管理器的 CLI 区域。`doctor`、`smoke`、`env` 和 `artifacts` 目前作为声明信息进入 inventory；后续 Runner 会基于这些字段执行自检和托管运行。

## Skill Roots

如果 App 里有分组后的 skill 集合，可以显式声明集合根目录：

```json
{
  "skills": {
    "roots": [
      "skills/hyperframes",
      "skills/maeve-agent"
    ]
  }
}
```

每个 root 下面应该包含一个或多个 `<skill-name>/SKILL.md` 目录。

## 运行环境注入

App 可以声明：请 OpenGrove 把某些 provider key 注入到这个 App 的 agent/runtime
环境里。这个能力用于私有业务 CLI：CLI 继续读取常见 env 变量，但用户只需要在
OpenGrove Providers 里配置一次凭证。

```json
{
  "runtimeEnv": {
    "providerKeys": [
      {
        "providerId": "aws-bedrock-api-key",
        "env": {
          "apiKey": "AWS_BEARER_TOKEN_BEDROCK"
        },
        "required": false
      },
      {
        "providerId": "gemini",
        "env": {
          "apiKey": ["GOOGLE_API_KEY", "GEMINI_API_KEY"]
        },
        "required": false
      }
    ]
  }
}
```

OpenGrove 会从 settings 里找到对应 provider，读取已保存的 key 或 provider
声明的 key 环境变量，并且只在这个 mounted App 发起的 turn 里注入这些 env
名字。密钥明文不会进入 prompt、事件流、文件预览、扩展 inventory 或 App
settings。

对于 Codex，OpenGrove 会按注入后的 runtime environment 启动隔离的
app-server 进程，所以 App 专属 env 不会串到普通对话或其他 App。

## 开发者模式状态

开发者模式属于 App workspace，不是一个独立的任务产品。用户进入开发者模式后，OpenGrove 可以持久化 developer-session context，让 preview、标注、选中元素、语音备注、run metadata 和边界检查在刷新后仍能恢复，也便于审计。

这些 context 应挂到普通 conversation thread 和逻辑 workspace/app id 上。它不应该要求用户创建或管理一个单独任务类型。本地 adapter 只通过 `/developer/sessions` 存储它；后端实现应把它拆成 session records、annotation records、run records 和 artifact/blob references，而不是一个巨大的可变对象。

## Skill 本地路径

App 内的 skill 可以使用：

```yaml
shell:
  - ${OPENGROVE_SKILL_DIR}/../../bin/example
paths:
  - ${OPENGROVE_SKILL_DIR}/../..
```

OpenGrove 会相对 mounted skill directory 解析这些值，所以私有 app 可以被 clone 到任意用户机器上，不需要改写 skill。

## 环境变量默认挂载

Headless 启动时，可以用 path-delimited 环境变量挂载 apps：

```bash
OPENGROVE_APP_DIRS="/path/to/app-a:/path/to/app-b"
```

`OPENGROVE_MOUNTED_APPS` 也作为等价名称接受。Settings UI 的修改会写入正常的 OpenGrove settings file。

## 完成与验证标准

一个 App 导入或创建完成时，agent 必须报告：

- OpenGrove 从哪里发现它，以及 Settings 里应启用哪个目录。
- UI 用的是已有前端、`file-workbench`，还是原生新工作台。
- 输入文件、配置、模型/API/local dependency 分别是什么。
- 用户可见产物写到哪里。
- 暴露了哪些 CLI/skill/MCP/hook，哪些只是文档说明。
- 已执行的验证：manifest 解析、前端/服务端 typecheck 或 build、文件工作台写操作、CLI doctor/smoke 或真实 dry run。

如果某项验证因缺少密钥、模型或外部服务无法执行，必须明确写出缺的配置和可复现命令。
