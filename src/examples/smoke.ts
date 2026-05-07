import { createOpenGrove } from "../app/create-opengrove.js";
import { createScriptedCompanionSession } from "../runtime/scripted-session.js";

const app = createOpenGrove({
  readPage: () => ({
    title: "微信读书测试页",
    url: "https://weread.qq.com/web/reader/example",
    selection: "浏览器其实也是一种操作系统，agent 可以长在它的活动空间里。",
    locator: "demo-selection",
  }),
  createSession: () => createScriptedCompanionSession({ saveCandidateNote: true }),
  policy: [
    {
      id: "smoke.allow-reading-note",
      toolId: "memory.proposeReadingNote",
      mode: "allow",
      reason: "Smoke test uses an explicit local allow rule.",
    },
  ],
  sessionId: "smoke",
  userId: "local-user",
});

const readingSelection = app.artifacts.create({
  type: "selection",
  title: "当前划线",
  tags: ["weread", "selection"],
  data: {
    text: "浏览器其实也是一种操作系统，agent 可以长在它的活动空间里。",
    locator: "demo-selection",
    url: "https://weread.qq.com/web/reader/example",
  },
});
const noteDraft = app.artifacts.create({
  type: "note",
  title: "伴读草稿",
  tags: ["draft", "note"],
  data: {
    markdown: "先把这句当作工作对象，而不是聊天附件。",
  },
  derivedFrom: [readingSelection.id],
});
app.workingState.update({
  sessionId: "smoke",
  taskSummary: "围绕当前划线形成一条可持续编辑的伴读笔记。",
  activeGoal: "验证页面选区会进入本轮上下文，workingState 里的产物不会被隐式注入。",
  pinnedArtifactIds: [readingSelection.id],
  workingArtifactIds: [noteDraft.id],
});

for await (const event of app.runTurn("我读到这里，想保存一个伴读笔记，你怎么看？")) {
  console.log(JSON.stringify(event));
}

console.log(
  JSON.stringify(
    {
      memory: app.memory.list(),
      artifacts: app.artifacts.list(),
      workingState: app.workingState.get(),
    },
    null,
    2,
  ),
);
