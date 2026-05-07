import hashlib
import json
import os
import re
import time
from pathlib import Path
from urllib.parse import quote

from mitmproxy import http


APP_ENV_PREFIX = "OPENGROVE"


def app_env_name(name: str) -> str:
    return f"{APP_ENV_PREFIX}_{name}"


CAPTURE_DIR = Path(os.environ.get(app_env_name("PROVIDER_HTTP_CAPTURE_DIR"), "data/provider-http-captures/latest"))
HOST_REGEX = re.compile(os.environ.get(app_env_name("PROVIDER_HTTP_CAPTURE_HOST_REGEX"), r".*"))
LABEL = os.environ.get(app_env_name("PROVIDER_HTTP_CAPTURE_LABEL"), "provider-http")
BODIES_DIR = CAPTURE_DIR / "bodies"
SUMMARY_FILE = CAPTURE_DIR / "summary.jsonl"


def load(loader):
    CAPTURE_DIR.mkdir(parents=True, exist_ok=True)
    BODIES_DIR.mkdir(parents=True, exist_ok=True)


def response(flow: http.HTTPFlow):
    host = flow.request.pretty_host or flow.request.host or ""
    if not HOST_REGEX.search(host):
        return

    started = flow.request.timestamp_start or time.time()
    flow_id = _flow_id(flow)
    request_body = _write_body(flow_id, "request", flow.request.raw_content)
    response_body = _write_body(flow_id, "response", flow.response.raw_content if flow.response else None)

    record = {
        "schemaVersion": 1,
        "label": LABEL,
        "kind": "http",
        "flowId": flow_id,
        "timestampStart": started,
        "timestampEnd": flow.response.timestamp_end if flow.response else None,
        "request": {
            "method": flow.request.method,
            "scheme": flow.request.scheme,
            "host": host,
            "port": flow.request.port,
            "path": flow.request.path,
            "url": flow.request.pretty_url,
            "httpVersion": flow.request.http_version,
            "headers": _headers(flow.request.headers),
            "body": request_body,
        },
        "response": {
            "statusCode": flow.response.status_code if flow.response else None,
            "reason": flow.response.reason if flow.response else None,
            "httpVersion": flow.response.http_version if flow.response else None,
            "headers": _headers(flow.response.headers) if flow.response else {},
            "body": response_body,
        },
    }
    with SUMMARY_FILE.open("a", encoding="utf-8") as file:
        file.write(json.dumps(record, ensure_ascii=False) + "\n")


def websocket_message(flow: http.HTTPFlow):
    host = flow.request.pretty_host or flow.request.host or ""
    if not HOST_REGEX.search(host) or flow.websocket is None or not flow.websocket.messages:
        return

    message = flow.websocket.messages[-1]
    flow_id = _flow_id(flow)
    index = len(flow.websocket.messages) - 1
    message_id = f"{flow_id}-ws-{index}"
    body = _write_body(message_id, "message", message.content)
    record = {
        "schemaVersion": 1,
        "label": LABEL,
        "kind": "websocket_message",
        "flowId": flow_id,
        "messageId": message_id,
        "messageIndex": index,
        "timestampStart": flow.request.timestamp_start or message.timestamp or time.time(),
        "timestampEnd": message.timestamp,
        "request": {
            "method": flow.request.method,
            "scheme": flow.request.scheme,
            "host": host,
            "port": flow.request.port,
            "path": flow.request.path,
            "url": flow.request.pretty_url,
            "httpVersion": flow.request.http_version,
            "headers": _headers(flow.request.headers),
            "body": None,
        },
        "websocket": {
            "fromClient": message.from_client,
            "direction": "client_to_server" if message.from_client else "server_to_client",
            "opcode": getattr(message.type, "name", str(message.type)).lower(),
            "isText": message.is_text,
            "dropped": message.dropped,
            "injected": message.injected,
            "body": body,
        },
    }
    with SUMMARY_FILE.open("a", encoding="utf-8") as file:
        file.write(json.dumps(record, ensure_ascii=False) + "\n")


def websocket_end(flow: http.HTTPFlow):
    host = flow.request.pretty_host or flow.request.host or ""
    if not HOST_REGEX.search(host) or flow.websocket is None:
        return

    record = {
        "schemaVersion": 1,
        "label": LABEL,
        "kind": "websocket_end",
        "flowId": _flow_id(flow),
        "timestampStart": flow.request.timestamp_start or time.time(),
        "timestampEnd": flow.websocket.timestamp_end or time.time(),
        "request": {
            "method": flow.request.method,
            "scheme": flow.request.scheme,
            "host": host,
            "port": flow.request.port,
            "path": flow.request.path,
            "url": flow.request.pretty_url,
            "httpVersion": flow.request.http_version,
            "headers": _headers(flow.request.headers),
            "body": None,
        },
        "websocket": {
            "messageCount": len(flow.websocket.messages),
            "closedByClient": flow.websocket.closed_by_client,
            "closeCode": flow.websocket.close_code,
            "closeReason": flow.websocket.close_reason,
        },
    }
    with SUMMARY_FILE.open("a", encoding="utf-8") as file:
        file.write(json.dumps(record, ensure_ascii=False) + "\n")


def _flow_id(flow: http.HTTPFlow) -> str:
    started = flow.request.timestamp_start or time.time()
    return f"{int(started * 1000)}-{flow.id[:12]}"


def _write_body(flow_id: str, side: str, content):
    if content is None:
        return None
    digest = hashlib.sha256(content).hexdigest()
    path = BODIES_DIR / f"{quote(flow_id, safe='')}-{side}-{digest[:16]}.bin"
    path.write_bytes(content)
    return {
        "path": str(path),
        "bytes": len(content),
        "sha256": digest,
    }


def _headers(headers):
    return {key: value for key, value in headers.items(multi=True)}
