import { formatDate } from "../../format";
import { formatBytes } from "../../runtime/ui-model";

export function compactIdentifier(value: unknown): string {
  const text = String(value || "");
  if (text.length <= 20) {
    return text;
  }
  return `${text.slice(0, 12)}...${text.slice(-6)}`;
}

export function renderContextRecordCard(record: any) {
  const context = record.context || {};
  const contextItems = Array.isArray(context.items) ? context.items : [];
  const requestMessages = Array.isArray(record.messages) ? record.messages : [];
  const title = record.title || context.summary || "Context snapshot";
  const meta = [
    record.runId ? `run ${compactIdentifier(record.runId)}` : "",
    record.modelId,
    context.summary && context.summary !== title ? context.summary : "",
    context.budget ? `${context.budget.usedItems || 0}/${context.budget.maxItems || 0} items` : "",
    context.budget?.truncated ? "truncated" : "",
    formatDate(record.updatedAt || record.finishedAt || record.startedAt),
  ].filter(Boolean);

  return (
    <details className="context-record entity-row" data-kind="context">
      <summary>
        <span>{title}</span>
        <span className="panel-item-meta">{meta.join(" · ")}</span>
      </summary>
      <div className="context-record-body">
        <ContextBlock title="User input" text={record.userInput} emptyText="这一轮没有显式用户输入。" />
        <ContextBlock title="Assembled context" text={context.promptBlock} emptyText="这一轮没有组装出额外上下文。" />
        {contextItems.length ? (
          <div className="context-block">
            <div className="context-block-title">Context items</div>
            <div className="panel-list context-item-list">
              {contextItems.map((item: any, index: number) => (
                <div className="panel-item entity-row context-item-row" key={item.id || index}>
                  <div className="panel-item-title">
                    {[item.kind, item.title].filter(Boolean).join(" · ") || `Item ${index + 1}`}
                  </div>
                  <div className="panel-item-meta">
                    {[item.id, item.source?.url, item.source?.locator].filter(Boolean).join(" · ")}
                  </div>
                  <div className="panel-item-text">{item.text || ""}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <ContextBlock title="System prompt" text={record.systemPrompt} emptyText="没有捕获到 system prompt。" collapsed />
        <ContextBlock
          title="Model messages"
          text={requestMessages.length ? JSON.stringify(requestMessages, null, 2) : ""}
          emptyText="没有捕获到 model messages。"
          collapsed
        />
        {record.providerHttpCapture ? <ProviderHttpCaptureBlock capture={record.providerHttpCapture} /> : null}
        <div className="panel-tags">
          <span className="panel-tag">tools {Array.isArray(record.tools) ? record.tools.length : 0}</span>
          <span className="panel-tag">skills {Array.isArray(record.skills) ? record.skills.length : 0}</span>
          <span className="panel-tag">packs {Array.isArray(record.packs) ? record.packs.length : 0}</span>
          <span className="panel-tag">events {Array.isArray(record.events) ? record.events.length : 0}</span>
        </div>
      </div>
    </details>
  );
}

export function ProviderHttpCaptureBlock(props: { capture: any }) {
  const capture = props.capture || {};
  const flows = Array.isArray(capture.flows) ? capture.flows : [];
  const meta = [
    capture.injected ? "已注入" : capture.enabled ? "已请求未注入" : "未开启",
    capture.status ? `状态 ${capture.status}` : "",
    capture.kernelId ? `内核 ${capture.kernelId}` : "",
    capture.running ? "mitmproxy 运行中" : "mitmproxy 未运行",
    capture.flowCount ? `总 ${capture.flowCount} 条` : "总 0 条",
    `精选 ${capture.matchedFlowCount || 0} 条`,
  ].filter(Boolean);

  return (
    <details className="context-block provider-capture-block" open={flows.length > 0}>
      <summary className="context-block-title">HTTPS 抓包</summary>
      <div className="provider-capture-summary">
        <div className="panel-tags">
          {meta.map((item) => (
            <span className="panel-tag" key={item}>
              {item}
            </span>
          ))}
        </div>
        {capture.warning ? <div className="panel-item-text provider-capture-warning">{capture.warning}</div> : null}
        <div className="provider-capture-paths">
          {capture.summaryPath ? <span>summary: {capture.summaryPath}</span> : null}
          {capture.runDir ? <span>runDir: {capture.runDir}</span> : null}
          {capture.webUrl ? <span>web: {capture.webUrl}</span> : null}
        </div>
      </div>
      {flows.length ? (
        <div className="panel-list provider-capture-flow-list">
          {flows.map((flow: any) => (
            <div className="panel-item provider-capture-flow" key={flow.flowId}>
              <div className="panel-item-title">{providerCaptureFlowTitle(flow)}</div>
              <div className="panel-item-meta">
                {[formatDate(flow.startedAt), flow.durationMs ? `${flow.durationMs}ms` : "", flow.request?.path].filter(Boolean).join(" · ")}
              </div>
              <div className="panel-item-text">
                {[
                  flow.request?.bodyBytes !== undefined ? `request ${formatBytes(flow.request.bodyBytes)}` : "",
                  flow.response?.bodyBytes !== undefined ? `response ${formatBytes(flow.response.bodyBytes)}` : "",
                  flow.websocket?.bodyBytes !== undefined ? `ws ${formatBytes(flow.websocket.bodyBytes)}` : "",
                  flow.websocket?.messageCount !== undefined ? `ws messages ${flow.websocket.messageCount}` : "",
                ].filter(Boolean).join(" · ") || "没有记录 body 大小"}
              </div>
              {flow.request?.bodyPath || flow.response?.bodyPath || flow.websocket?.bodyPath ? (
                <div className="provider-capture-paths">
                  {flow.request?.bodyPath ? <span>request body: {flow.request.bodyPath}</span> : null}
                  {flow.response?.bodyPath ? <span>response body: {flow.response.bodyPath}</span> : null}
                  {flow.websocket?.bodyPath ? <span>websocket body: {flow.websocket.bodyPath}</span> : null}
                </div>
              ) : null}
              <ProviderCaptureBodyPreview title="Request" text={flow.request?.bodyPreview} truncated={flow.request?.bodyPreviewTruncated} />
              <ProviderCaptureBodyPreview title="Response" text={flow.response?.bodyPreview} truncated={flow.response?.bodyPreviewTruncated} />
              <ProviderCaptureBodyPreview title="WebSocket" text={flow.websocket?.bodyPreview} truncated={flow.websocket?.bodyPreviewTruncated} />
            </div>
          ))}
        </div>
      ) : (
        <div className="panel-empty">这一轮没有带可读正文的关键 provider HTTPS 记录。</div>
      )}
    </details>
  );
}

function ProviderCaptureBodyPreview(props: { title: string; text?: string; truncated?: boolean }) {
  const text = String(props.text || "").trim();
  if (!text) return null;
  return (
    <details className="context-block provider-capture-body" open={props.title === "WebSocket"}>
      <summary className="context-block-title">
        {props.title} 内容{props.truncated ? "（已截断）" : ""}
      </summary>
      <pre className="context-pre">{text}</pre>
    </details>
  );
}

export function providerCaptureFlowTitle(flow: any) {
  if (flow?.kind === "websocket_message") {
    const direction = flow.websocket?.direction === "client_to_server" ? "WS ->" : "WS <-";
    return [direction, flow.websocket?.opcode, flow.request?.host, flow.websocket?.messageIndex !== undefined ? `#${flow.websocket.messageIndex}` : ""]
      .filter(Boolean)
      .join(" · ");
  }
  if (flow?.kind === "websocket_end") {
    return ["WS closed", flow.request?.host, flow.websocket?.closeCode].filter(Boolean).join(" · ");
  }
  return [flow.request?.method, flow.response?.statusCode, flow.request?.host].filter(Boolean).join(" · ");
}

export function ContextBlock(props: { title: string; text?: string; emptyText: string; collapsed?: boolean }) {
  const content = String(props.text || "").trim();

  return (
    <details className="context-block" open={!props.collapsed}>
      <summary className="context-block-title">{props.title}</summary>
      <pre className="context-pre">{content || props.emptyText}</pre>
    </details>
  );
}
