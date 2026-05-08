import { useSyncExternalStore } from "react";
import { APP_STORAGE_KEYS } from "./identity";

export type LanguagePreference = "system" | "zh-CN" | "en";
export type ResolvedLanguage = "zh-CN" | "en";

export type TranslationKey =
  | "app.chat"
  | "app.library"
  | "app.settings"
  | "app.mainNav"
  | "app.mobileNav"
  | "common.backToApp"
  | "common.default"
  | "common.delete"
  | "common.cancel"
  | "common.remove"
  | "common.rename"
  | "common.edit"
  | "common.unknown"
  | "common.available"
  | "common.unavailable"
  | "common.exists"
  | "common.notCreated"
  | "common.saving"
  | "common.settings"
  | "common.current"
  | "common.enabled"
  | "common.disabled"
  | "conversation.newProject"
  | "conversation.newThread"
  | "conversation.renameProject"
  | "conversation.more"
  | "conversation.sort"
  | "conversation.sortProjects"
  | "conversation.expandAll"
  | "conversation.collapseAll"
  | "conversation.pendingApproval"
  | "conversation.deleteThread"
  | "conversation.deleteThreadConfirm"
  | "conversation.deleteProjectConfirm"
  | "conversation.createTime"
  | "conversation.updateTime"
  | "conversation.local"
  | "conversation.today"
  | "conversation.days"
  | "conversation.codeProject"
  | "conversation.localProject"
  | "conversation.newThreadFallback"
  | "vault.files"
  | "vault.empty"
  | "vault.newNote"
  | "vault.newFolder"
  | "vault.deleteNote"
  | "vault.deleteFolder"
  | "vault.deleteCopy"
  | "vault.rename"
  | "vault.search"
  | "vault.expandAll"
  | "vault.collapseAll"
  | "vault.actions"
  | "vault.searchClose"
  | "vault.newNoteInRoot"
  | "vault.newFolderInRoot"
  | "layout.sidebar"
  | "layout.spaceNav"
  | "layout.resizeSidebar"
  | "layout.localBridge"
  | "layout.openWorkbench"
  | "layout.closeWorkbench"
  | "layout.workbench"
  | "library.ai"
  | "library.openAi"
  | "library.closeAi"
  | "library.aiTitle"
  | "library.selectAiConversation"
  | "library.newAiConversation"
  | "thread.welcome"
  | "composer.placeholder"
  | "composer.skillPlaceholder"
  | "composer.addAttachment"
  | "composer.removeSkill"
  | "composer.send"
  | "composer.stop"
  | "composer.suggestions"
  | "composer.suggestionPlan"
  | "composer.suggestionMemory"
  | "composer.suggestionStatus"
  | "composer.selectedText"
  | "composer.artifact"
  | "composer.removeContext"
  | "composer.removeArtifact"
  | "composer.removeAttachment"
  | "composer.accessLabel"
  | "composer.defaultAccess"
  | "composer.autoReview"
  | "composer.fullAccess"
  | "composer.modelMenuLabel"
  | "composer.intelligence"
  | "composer.model"
  | "composer.speed"
  | "composer.speedStandard"
  | "composer.speedStandardDescription"
  | "composer.speedFast"
  | "composer.speedFastDescription"
  | "composer.kernelDecidesIntelligence"
  | "composer.effortLow"
  | "composer.effortMedium"
  | "composer.effortHigh"
  | "composer.effortXHigh"
  | "settings.kernels"
  | "settings.providers"
  | "settings.diagnostics"
  | "settings.appearance"
  | "settings.developer"
  | "settings.nav"
  | "settings.kicker"
  | "settings.kernelsDescription"
  | "settings.providersDescription"
  | "settings.providerBindings"
  | "settings.providerBindingsCopy"
  | "settings.nativeProvider"
  | "settings.secretEnv"
  | "settings.customProvider"
  | "settings.builtinProvider"
  | "settings.addProvider"
  | "settings.addProviderCopy"
  | "settings.providerName"
  | "settings.providerId"
  | "settings.protocol"
  | "settings.openaiBaseUrl"
  | "settings.anthropicBaseUrl"
  | "settings.apiKeyEnv"
  | "settings.models"
  | "settings.description"
  | "settings.providerDescriptionPlaceholder"
  | "settings.saveProvider"
  | "settings.providerFormRequired"
  | "settings.diagnosticsDescription"
  | "settings.developerDescription"
  | "settings.appearanceDescription"
  | "settings.workMode"
  | "settings.workModeCopy"
  | "settings.autoMode"
  | "settings.resolvedAs"
  | "settings.detected"
  | "settings.notInstalled"
  | "settings.version"
  | "settings.configDir"
  | "settings.knowledgeSources"
  | "settings.knowledgeSourcesCopy"
  | "settings.adapter"
  | "settings.dynamicSource"
  | "settings.noSources"
  | "settings.httpsCapture"
  | "settings.httpsCaptureCopy"
  | "settings.proxy"
  | "settings.ca"
  | "settings.service"
  | "settings.injection"
  | "settings.status"
  | "settings.running"
  | "settings.notRunning"
  | "settings.injected"
  | "settings.notInjected"
  | "settings.kernelNotInjected"
  | "settings.rawContext"
  | "settings.rawContextCopy"
  | "settings.noContextRecords"
  | "settings.appearanceEmptyTitle"
  | "settings.appearanceEmptyCopy"
  | "settings.installPaths"
  | "settings.installPathsCopy"
  | "settings.language"
  | "settings.languageCopy"
  | "settings.languageSystem"
  | "settings.languageChinese"
  | "settings.languageEnglish"
  | "settings.saveFailed"
  | "system.saveSettingsFailed"
  | "system.savedLocalFile"
  | "system.saveLibraryPageFailed"
  | "system.createLocalFileFailed"
  | "system.moveLocalFileFailed"
  | "system.renameLocalFileFailed"
  | "system.deleteLocalFileFailed"
  | "system.replyInProgress"
  | "system.savedArtifact"
  | "system.saveImageFailed"
  | "system.maxAttachments"
  | "system.partialAttachments"
  | "system.inputRequired"
  | "system.defaultAttachmentPrompt"
  | "system.defaultTextPrompt"
  | "system.unnamedPage"
  | "system.unnamed"
  | "system.imageArtifact"
  | "system.stopped"
  | "system.connected"
  | "system.disconnected"
  | "system.tokenRequired"
  | "system.localReady"
  | "system.checking"
  | "source.kind.skills"
  | "source.kind.commands"
  | "source.kind.agents"
  | "source.kind.memory"
  | "source.kind.project_instructions"
  | "source.kind.settings"
  | "source.kind.config"
  | "source.kind.auth"
  | "source.kind.sessions"
  | "source.kind.logs"
  | "source.kind.plugins"
  | "source.kind.toolsets"
  | "source.kind.artifacts"
  | "source.kind.vault"
  | "source.scope.user"
  | "source.scope.project"
  | "source.scope.workspace"
  | "source.scope.system"
  | "source.scope.managed"
  | "source.scope.external";

type Dictionary = Record<TranslationKey, string>;
export type TranslationFn = (key: TranslationKey, replacements?: Record<string, string | number>) => string;

const ZH_CN: Dictionary = {
  "app.chat": "对话",
  "app.library": "资料库",
  "app.settings": "设置",
  "app.mainNav": "主导航",
  "app.mobileNav": "移动端入口",
  "common.backToApp": "返回应用",
  "common.default": "默认",
  "common.delete": "删除",
  "common.cancel": "取消",
  "common.remove": "移除",
  "common.rename": "重命名",
  "common.edit": "编辑",
  "common.unknown": "未知",
  "common.available": "可用",
  "common.unavailable": "不可用",
  "common.exists": "存在",
  "common.notCreated": "未创建",
  "common.saving": "正在保存设置...",
  "common.settings": "设置",
  "common.current": "当前",
  "common.enabled": "已开启",
  "common.disabled": "未开启",
  "conversation.newProject": "新建项目",
  "conversation.newThread": "新对话",
  "conversation.renameProject": "重命名项目",
  "conversation.more": "更多",
  "conversation.sort": "排序",
  "conversation.sortProjects": "项目排序",
  "conversation.expandAll": "展开所有项目",
  "conversation.collapseAll": "收起所有项目",
  "conversation.pendingApproval": "待确认",
  "conversation.deleteThread": "删除对话",
  "conversation.deleteThreadConfirm": "删除对话「{title}」？这会从本地侧栏移除这条对话。",
  "conversation.deleteProjectConfirm": "删除项目「{title}」？它下面的 {count} 条对话也会从本地侧栏移除。",
  "conversation.createTime": "按创建时间",
  "conversation.updateTime": "按更新时间",
  "conversation.local": "本地",
  "conversation.today": "今天",
  "conversation.days": "{count} 天",
  "conversation.codeProject": "代码项目",
  "conversation.localProject": "本地项目",
  "conversation.newThreadFallback": "新线程",
  "vault.files": "资料库文件",
  "vault.empty": "这个目录里还没有文件。",
  "vault.newNote": "新建笔记",
  "vault.newFolder": "新建文件夹",
  "vault.deleteNote": "删除笔记",
  "vault.deleteFolder": "删除文件夹",
  "vault.deleteCopy": "{name} 会从本地资料库移除。",
  "vault.rename": "重命名",
  "vault.search": "搜索文件",
  "vault.expandAll": "全部展开",
  "vault.collapseAll": "全部收起",
  "vault.actions": "资料库操作",
  "vault.searchClose": "关闭文件搜索",
  "vault.newNoteInRoot": "在 {root} 根目录新建笔记",
  "vault.newFolderInRoot": "在 {root} 根目录新建文件夹",
  "layout.sidebar": "侧边栏",
  "layout.spaceNav": "当前空间导航",
  "layout.resizeSidebar": "调整侧边栏宽度",
  "layout.localBridge": "本地 bridge",
  "layout.openWorkbench": "打开工作台",
  "layout.closeWorkbench": "收起工作台",
  "layout.workbench": "工作台",
  "library.ai": "AI",
  "library.openAi": "打开资料库 AI",
  "library.closeAi": "关闭资料库 AI",
  "library.aiTitle": "资料库 AI",
  "library.selectAiConversation": "选择资料库 AI 对话",
  "library.newAiConversation": "新建资料库 AI 对话",
  "thread.welcome": "今天想推进什么？",
  "composer.placeholder": "问 Codex，或输入 / 调用能力",
  "composer.skillPlaceholder": "补充这个技能要做什么...",
  "composer.addAttachment": "添加图片或文件",
  "composer.removeSkill": "移除技能 {name}",
  "composer.send": "发送消息",
  "composer.stop": "停止运行",
  "composer.suggestions": "建议",
  "composer.suggestionPlan": "把当前目标拆成下一步",
  "composer.suggestionMemory": "整理当前记忆和资料",
  "composer.suggestionStatus": "查看最近产物和待确认",
  "composer.selectedText": "已选文本片段",
  "composer.artifact": "产物",
  "composer.removeContext": "移除上下文",
  "composer.removeArtifact": "移除产物 {title}",
  "composer.removeAttachment": "移除附件 {name}",
  "composer.accessLabel": "访问权限",
  "composer.defaultAccess": "默认权限",
  "composer.autoReview": "自动审查",
  "composer.fullAccess": "完全访问权限",
  "composer.modelMenuLabel": "速度、模型和智能等级",
  "composer.intelligence": "智能",
  "composer.model": "模型",
  "composer.speed": "速度",
  "composer.speedStandard": "标准",
  "composer.speedStandardDescription": "默认速度，常规用量",
  "composer.speedFast": "快速",
  "composer.speedFastDescription": "1.5 倍速，用量增加",
  "composer.kernelDecidesIntelligence": "智能由当前内核决定",
  "composer.effortLow": "低",
  "composer.effortMedium": "中",
  "composer.effortHigh": "高",
  "composer.effortXHigh": "超高",
  "settings.kernels": "内核与知识",
  "settings.providers": "模型提供方",
  "settings.diagnostics": "抓包与诊断",
  "settings.appearance": "外观",
  "settings.developer": "开发者",
  "settings.nav": "设置分类",
  "settings.kicker": "Settings",
  "settings.kernelsDescription": "选择默认内核，并管理它们暴露给资料库的本机知识来源。",
  "settings.providersDescription": "管理可绑定到不同内核的模型网关和 coding plan。密钥只从环境变量读取，不写入设置文件。",
  "settings.providerBindings": "内核绑定",
  "settings.providerBindingsCopy": "给每个内核选择默认 provider。未选择时使用该内核自己的原生登录或配置。",
  "settings.nativeProvider": "使用原生配置",
  "settings.secretEnv": "密钥环境变量",
  "settings.customProvider": "自定义",
  "settings.builtinProvider": "内置",
  "settings.addProvider": "添加 provider",
  "settings.addProviderCopy": "填写网关地址、模型名和密钥环境变量。这里不保存真实 key。",
  "settings.providerName": "名称",
  "settings.providerId": "ID",
  "settings.protocol": "协议",
  "settings.openaiBaseUrl": "OpenAI 兼容地址",
  "settings.anthropicBaseUrl": "Anthropic 兼容地址",
  "settings.apiKeyEnv": "密钥环境变量",
  "settings.models": "模型",
  "settings.description": "说明",
  "settings.providerDescriptionPlaceholder": "用于某个 coding plan 或内部网关",
  "settings.saveProvider": "保存 provider",
  "settings.providerFormRequired": "至少需要填写名称和 ID。",
  "settings.diagnosticsDescription": "管理 RPC、原生日志、provider HTTPS 抓包和 trajectory。",
  "settings.developerDescription": "查看内核二进制、配置路径和安装建议。",
  "settings.appearanceDescription": "界面外观偏好。",
  "settings.workMode": "工作模式",
  "settings.workModeCopy": "决定新回合默认交给哪个内核。自动模式会按可用性选择。",
  "settings.autoMode": "自动选择",
  "settings.resolvedAs": "自动解析为 {kernel}",
  "settings.detected": "已检测",
  "settings.notInstalled": "未安装",
  "settings.version": "版本",
  "settings.configDir": "配置目录",
  "settings.knowledgeSources": "资料库来源",
  "settings.knowledgeSourcesCopy": "已识别 {count} 个本机来源。资料库按来源分组，不再把不同内核的目录揉成一层。",
  "settings.adapter": "内核适配器",
  "settings.dynamicSource": "由内核动态提供",
  "settings.noSources": "暂无可同步来源。",
  "settings.httpsCapture": "HTTPS 抓包模式",
  "settings.httpsCaptureCopy": "开启后会自动启动 mitmproxy 并重建内核；只有代理服务启动成功且内核支持时，OpenGrove 才把代理和 CA 注入子进程。",
  "settings.proxy": "代理",
  "settings.ca": "CA",
  "settings.service": "服务",
  "settings.injection": "注入",
  "settings.status": "状态",
  "settings.running": "运行中",
  "settings.notRunning": "未运行",
  "settings.injected": "已注入",
  "settings.notInjected": "未注入",
  "settings.kernelNotInjected": "本内核未注入",
  "settings.rawContext": "原始上下文记录",
  "settings.rawContextCopy": "这里保留每一轮实际组装给内核的上下文、用户输入、system prompt、tool/skill 统计和抓包摘要。",
  "settings.noContextRecords": "还没有上下文记录",
  "settings.appearanceEmptyTitle": "外观设置还没有接入",
  "settings.appearanceEmptyCopy": "当前先保持系统默认主题。后续这里放主题、字体和编辑器偏好。",
  "settings.installPaths": "安装与路径",
  "settings.installPathsCopy": "OpenGrove 只记录安装建议，不自动执行。真正安装内核需要用户确认后再跑命令。",
  "settings.language": "语言",
  "settings.languageCopy": "默认跟随浏览器/系统语言，也可以固定为中文或英文。",
  "settings.languageSystem": "跟随系统",
  "settings.languageChinese": "简体中文",
  "settings.languageEnglish": "English",
  "settings.saveFailed": "保存设置失败",
  "system.saveSettingsFailed": "保存设置失败：{message}",
  "system.savedLocalFile": "已保存到本地文件：{name}",
  "system.saveLibraryPageFailed": "保存资料库页面失败：{message}",
  "system.createLocalFileFailed": "创建本地文件失败：{message}",
  "system.moveLocalFileFailed": "移动本地文件失败：{message}",
  "system.renameLocalFileFailed": "重命名本地文件失败：{message}",
  "system.deleteLocalFileFailed": "删除本地文件失败：{message}",
  "system.replyInProgress": "当前回复还在进行中，等它结束后再切换对话。",
  "system.savedArtifact": "已保存到成果：{title}",
  "system.saveImageFailed": "保存图片失败：{message}",
  "system.maxAttachments": "一次最多添加 {count} 个附件。",
  "system.partialAttachments": "已添加前 {selected} 个附件；一次最多 {count} 个。",
  "system.inputRequired": "先输入一个问题，或者添加文件/产物。",
  "system.defaultAttachmentPrompt": "请看一下这些材料。",
  "system.defaultTextPrompt": "这一段怎么看？",
  "system.unnamedPage": "未命名页面",
  "system.unnamed": "未命名",
  "system.imageArtifact": "图片成果",
  "system.stopped": "已停止本轮运行。",
  "system.connected": "已连接",
  "system.disconnected": "未连接",
  "system.tokenRequired": "需要 token",
  "system.localReady": "本地可用",
  "system.checking": "检查中",
  "source.kind.skills": "技能",
  "source.kind.commands": "命令",
  "source.kind.agents": "子 Agent",
  "source.kind.memory": "记忆",
  "source.kind.project_instructions": "项目指令",
  "source.kind.settings": "设置",
  "source.kind.config": "配置",
  "source.kind.auth": "凭证",
  "source.kind.sessions": "会话",
  "source.kind.logs": "日志",
  "source.kind.plugins": "插件",
  "source.kind.toolsets": "工具集",
  "source.kind.artifacts": "产物",
  "source.kind.vault": "资料库",
  "source.scope.user": "用户",
  "source.scope.project": "项目",
  "source.scope.workspace": "本地",
  "source.scope.system": "系统",
  "source.scope.managed": "托管",
  "source.scope.external": "外部",
};

const EN: Dictionary = {
  "app.chat": "Chat",
  "app.library": "Vault",
  "app.settings": "Settings",
  "app.mainNav": "Main navigation",
  "app.mobileNav": "Mobile navigation",
  "common.backToApp": "Back to app",
  "common.default": "Default",
  "common.delete": "Delete",
  "common.cancel": "Cancel",
  "common.remove": "Remove",
  "common.rename": "Rename",
  "common.edit": "Edit",
  "common.unknown": "Unknown",
  "common.available": "Available",
  "common.unavailable": "Unavailable",
  "common.exists": "Exists",
  "common.notCreated": "Not created",
  "common.saving": "Saving settings...",
  "common.settings": "Settings",
  "common.current": "Current",
  "common.enabled": "Enabled",
  "common.disabled": "Disabled",
  "conversation.newProject": "New project",
  "conversation.newThread": "New chat",
  "conversation.renameProject": "Rename project",
  "conversation.more": "More",
  "conversation.sort": "Sort",
  "conversation.sortProjects": "Sort projects",
  "conversation.expandAll": "Expand all projects",
  "conversation.collapseAll": "Collapse all projects",
  "conversation.pendingApproval": "pending",
  "conversation.deleteThread": "Delete chat",
  "conversation.deleteThreadConfirm": "Delete chat “{title}”? This removes it from the local sidebar.",
  "conversation.deleteProjectConfirm": "Delete project “{title}”? Its {count} chats will also be removed from the local sidebar.",
  "conversation.createTime": "By created time",
  "conversation.updateTime": "By updated time",
  "conversation.local": "Local",
  "conversation.today": "Today",
  "conversation.days": "{count}d",
  "conversation.codeProject": "Code project",
  "conversation.localProject": "Local project",
  "conversation.newThreadFallback": "New chat",
  "vault.files": "Vault files",
  "vault.empty": "No files in this folder yet.",
  "vault.newNote": "New note",
  "vault.newFolder": "New folder",
  "vault.deleteNote": "Delete note",
  "vault.deleteFolder": "Delete folder",
  "vault.deleteCopy": "{name} will be removed from the local vault.",
  "vault.rename": "Rename",
  "vault.search": "Search files",
  "vault.expandAll": "Expand all",
  "vault.collapseAll": "Collapse all",
  "vault.actions": "Vault actions",
  "vault.searchClose": "Close file search",
  "vault.newNoteInRoot": "Create a note in the {root} root",
  "vault.newFolderInRoot": "Create a folder in the {root} root",
  "layout.sidebar": "Sidebar",
  "layout.spaceNav": "Current space navigation",
  "layout.resizeSidebar": "Resize sidebar",
  "layout.localBridge": "Local bridge",
  "layout.openWorkbench": "Open workbench",
  "layout.closeWorkbench": "Close workbench",
  "layout.workbench": "Workbench",
  "library.ai": "AI",
  "library.openAi": "Open vault AI",
  "library.closeAi": "Close vault AI",
  "library.aiTitle": "Vault AI",
  "library.selectAiConversation": "Select vault AI chat",
  "library.newAiConversation": "New vault AI chat",
  "thread.welcome": "What would you like to move forward today?",
  "composer.placeholder": "Ask Codex, or type / to use a skill",
  "composer.skillPlaceholder": "Add what this skill should do...",
  "composer.addAttachment": "Add image or file",
  "composer.removeSkill": "Remove skill {name}",
  "composer.send": "Send message",
  "composer.stop": "Stop running",
  "composer.suggestions": "Suggestions",
  "composer.suggestionPlan": "Break the current goal into next steps",
  "composer.suggestionMemory": "Organize current memory and materials",
  "composer.suggestionStatus": "Review recent artifacts and pending items",
  "composer.selectedText": "Selected text",
  "composer.artifact": "Artifact",
  "composer.removeContext": "Remove context",
  "composer.removeArtifact": "Remove artifact {title}",
  "composer.removeAttachment": "Remove attachment {name}",
  "composer.accessLabel": "Access",
  "composer.defaultAccess": "Default access",
  "composer.autoReview": "Auto review",
  "composer.fullAccess": "Full access",
  "composer.modelMenuLabel": "Speed, model, and reasoning level",
  "composer.intelligence": "Reasoning",
  "composer.model": "Model",
  "composer.speed": "Speed",
  "composer.speedStandard": "Standard",
  "composer.speedStandardDescription": "Default speed, normal usage",
  "composer.speedFast": "Fast",
  "composer.speedFastDescription": "1.5x speed, higher usage",
  "composer.kernelDecidesIntelligence": "Reasoning is controlled by the current kernel",
  "composer.effortLow": "Low",
  "composer.effortMedium": "Medium",
  "composer.effortHigh": "High",
  "composer.effortXHigh": "Extra high",
  "settings.kernels": "Kernels & Knowledge",
  "settings.providers": "Providers",
  "settings.diagnostics": "Capture & Diagnostics",
  "settings.appearance": "Appearance",
  "settings.developer": "Developer",
  "settings.nav": "Settings sections",
  "settings.kicker": "Settings",
  "settings.kernelsDescription": "Choose the default kernel and manage the local knowledge sources it exposes to the vault.",
  "settings.providersDescription": "Manage model gateways and coding plans that can be bound to different kernels. Secrets are read from environment variables and never persisted in settings.",
  "settings.providerBindings": "Kernel bindings",
  "settings.providerBindingsCopy": "Choose the default provider for each kernel. Empty means the kernel keeps using its native login/config.",
  "settings.nativeProvider": "Use native config",
  "settings.secretEnv": "Secret env",
  "settings.customProvider": "Custom",
  "settings.builtinProvider": "Built-in",
  "settings.addProvider": "Add provider",
  "settings.addProviderCopy": "Fill in gateway URLs, model names, and the environment variable that holds the secret. Raw keys are not saved here.",
  "settings.providerName": "Name",
  "settings.providerId": "ID",
  "settings.protocol": "Protocol",
  "settings.openaiBaseUrl": "OpenAI-compatible URL",
  "settings.anthropicBaseUrl": "Anthropic-compatible URL",
  "settings.apiKeyEnv": "Secret environment variable",
  "settings.models": "Models",
  "settings.description": "Description",
  "settings.providerDescriptionPlaceholder": "For a coding plan or internal gateway",
  "settings.saveProvider": "Save provider",
  "settings.providerFormRequired": "Name and ID are required.",
  "settings.diagnosticsDescription": "Manage RPC, native logs, provider HTTPS capture, and trajectories.",
  "settings.developerDescription": "Inspect kernel binaries, config paths, and install suggestions.",
  "settings.appearanceDescription": "Interface preferences.",
  "settings.workMode": "Work mode",
  "settings.workModeCopy": "Choose which kernel new turns use by default. Auto mode resolves by availability.",
  "settings.autoMode": "Auto",
  "settings.resolvedAs": "Resolved as {kernel}",
  "settings.detected": "Detected",
  "settings.notInstalled": "Not installed",
  "settings.version": "Version",
  "settings.configDir": "Config directory",
  "settings.knowledgeSources": "Knowledge sources",
  "settings.knowledgeSourcesCopy": "{count} local sources detected. The vault groups them by source instead of merging kernel folders into one layer.",
  "settings.adapter": "Kernel adapter",
  "settings.dynamicSource": "Provided dynamically by the kernel",
  "settings.noSources": "No syncable sources yet.",
  "settings.httpsCapture": "HTTPS capture mode",
  "settings.httpsCaptureCopy": "When enabled, OpenGrove starts mitmproxy and rebuilds the kernel. Proxy and CA settings are injected only when capture is running and the kernel supports it.",
  "settings.proxy": "Proxy",
  "settings.ca": "CA",
  "settings.service": "Service",
  "settings.injection": "Injection",
  "settings.status": "Status",
  "settings.running": "Running",
  "settings.notRunning": "Not running",
  "settings.injected": "Injected",
  "settings.notInjected": "Not injected",
  "settings.kernelNotInjected": "Not injected for this kernel",
  "settings.rawContext": "Raw context records",
  "settings.rawContextCopy": "Shows the actual context assembled for each turn, user input, system prompt, tool/skill stats, and capture summary.",
  "settings.noContextRecords": "No context records yet",
  "settings.appearanceEmptyTitle": "Appearance settings are not wired yet",
  "settings.appearanceEmptyCopy": "For now the app keeps the system theme. Theme, font, and editor preferences will live here later.",
  "settings.installPaths": "Install & paths",
  "settings.installPathsCopy": "OpenGrove records install suggestions only. It does not run install commands without user confirmation.",
  "settings.language": "Language",
  "settings.languageCopy": "Follow the browser/system language by default, or pin the interface to Chinese or English.",
  "settings.languageSystem": "System",
  "settings.languageChinese": "简体中文",
  "settings.languageEnglish": "English",
  "settings.saveFailed": "Failed to save settings",
  "system.saveSettingsFailed": "Failed to save settings: {message}",
  "system.savedLocalFile": "Saved to local file: {name}",
  "system.saveLibraryPageFailed": "Failed to save vault page: {message}",
  "system.createLocalFileFailed": "Failed to create local file: {message}",
  "system.moveLocalFileFailed": "Failed to move local file: {message}",
  "system.renameLocalFileFailed": "Failed to rename local file: {message}",
  "system.deleteLocalFileFailed": "Failed to delete local file: {message}",
  "system.replyInProgress": "A reply is still running. Switch chats after it finishes.",
  "system.savedArtifact": "Saved to artifacts: {title}",
  "system.saveImageFailed": "Failed to save image: {message}",
  "system.maxAttachments": "You can add up to {count} attachments at once.",
  "system.partialAttachments": "Added the first {selected} attachments; the limit is {count}.",
  "system.inputRequired": "Enter a question, or add a file/artifact first.",
  "system.defaultAttachmentPrompt": "Please look at these materials.",
  "system.defaultTextPrompt": "What do you think about this?",
  "system.unnamedPage": "Untitled page",
  "system.unnamed": "Untitled",
  "system.imageArtifact": "Image artifact",
  "system.stopped": "Stopped this turn.",
  "system.connected": "Connected",
  "system.disconnected": "Disconnected",
  "system.tokenRequired": "Token required",
  "system.localReady": "Local ready",
  "system.checking": "Checking",
  "source.kind.skills": "Skills",
  "source.kind.commands": "Commands",
  "source.kind.agents": "Subagents",
  "source.kind.memory": "Memory",
  "source.kind.project_instructions": "Project instructions",
  "source.kind.settings": "Settings",
  "source.kind.config": "Config",
  "source.kind.auth": "Credentials",
  "source.kind.sessions": "Sessions",
  "source.kind.logs": "Logs",
  "source.kind.plugins": "Plugins",
  "source.kind.toolsets": "Toolsets",
  "source.kind.artifacts": "Artifacts",
  "source.kind.vault": "Vault",
  "source.scope.user": "User",
  "source.scope.project": "Project",
  "source.scope.workspace": "Local",
  "source.scope.system": "System",
  "source.scope.managed": "Managed",
  "source.scope.external": "External",
};

const dictionaries: Record<ResolvedLanguage, Dictionary> = {
  "zh-CN": ZH_CN,
  en: EN,
};

const listeners = new Set<() => void>();

export function detectSystemLanguage(): ResolvedLanguage {
  if (typeof navigator !== "undefined" && /^en\b/i.test(navigator.language || "")) {
    return "en";
  }
  return "zh-CN";
}

export function normalizeLanguagePreference(value: unknown): LanguagePreference {
  return value === "system" || value === "zh-CN" || value === "en" ? value : "system";
}

export function readLanguagePreference(): LanguagePreference {
  if (typeof window === "undefined") {
    return "system";
  }
  return normalizeLanguagePreference(window.localStorage.getItem(APP_STORAGE_KEYS.language));
}

export function resolveLanguage(preference: LanguagePreference): ResolvedLanguage {
  return preference === "system" ? detectSystemLanguage() : preference;
}

export function setLanguagePreference(preference: LanguagePreference): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(APP_STORAGE_KEYS.language, preference);
  applyDocumentLanguage();
  for (const listener of listeners) {
    listener();
  }
}

export function applyDocumentLanguage(): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.lang = resolveLanguage(readLanguagePreference());
}

export function translate(key: TranslationKey, replacements: Record<string, string | number> = {}): string {
  const language = resolveLanguage(readLanguagePreference());
  const template = dictionaries[language][key] ?? ZH_CN[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(replacements, name) ? String(replacements[name]) : match,
  );
}

export function useI18n() {
  const preference = useSyncExternalStore(subscribeLanguage, readLanguagePreference, (): LanguagePreference => "system");
  const language = resolveLanguage(preference);
  return {
    language,
    preference,
    setLanguagePreference,
    t: translate,
  };
}

function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
