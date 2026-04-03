#!/usr/bin/env node
import http from "node:http";
import os from "node:os";
import process from "node:process";
import {
  appendRelayMessages,
  DEFAULT_RELAY_STATE_PATH,
  listRelayMessages,
  readRelayState,
  writeRelayState,
} from "./state-store.mjs";
import {
  normalizeGenericInbound,
  normalizeSlackEvent,
  normalizeTeamsWebhook,
  normalizeTelegramUpdate,
  normalizeTwilioWhatsAppForm,
  parseFormBody,
  parseJsonBody,
} from "./normalizers.mjs";
import { deliverOutboundMessage } from "./outbound-targets.mjs";

function getRelayConfig(env = process.env) {
  const mode = env.BRIDGE_RELAY_OUTBOUND_MODE ?? "stdout";
  return {
    host: env.BRIDGE_RELAY_HOST ?? "127.0.0.1",
    port: Number(env.BRIDGE_RELAY_PORT ?? 3031),
    statePath: env.BRIDGE_RELAY_STATE_PATH ?? DEFAULT_RELAY_STATE_PATH,
    authToken: env.BRIDGE_RELAY_AUTH_TOKEN ?? null,
    selfId: env.BRIDGE_RELAY_SELF_ID ?? `bridge-relay@${os.hostname()}`,
    outbound: {
      mode,
      webhookUrl: env.BRIDGE_RELAY_WEBHOOK_URL ?? null,
      botToken: env.BRIDGE_RELAY_TELEGRAM_BOT_TOKEN ?? null,
      chatId: env.BRIDGE_RELAY_TELEGRAM_CHAT_ID ?? null,
      apiBaseUrl: env.BRIDGE_RELAY_TELEGRAM_API_BASE_URL ?? "https://api.telegram.org",
      headers:
        env.BRIDGE_RELAY_OUTBOUND_AUTH_HEADER_NAME && env.BRIDGE_RELAY_OUTBOUND_AUTH_HEADER_VALUE
          ? { [env.BRIDGE_RELAY_OUTBOUND_AUTH_HEADER_NAME]: env.BRIDGE_RELAY_OUTBOUND_AUTH_HEADER_VALUE }
          : {},
    },
  };
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function unauthorized(response) {
  sendJson(response, 401, { error: "unauthorized" });
}

function isAuthorized(request, config) {
  if (!config.authToken) {
    return true;
  }

  const header = request.headers.authorization;
  return header === `Bearer ${config.authToken}`;
}

function normalizeInbound(provider, payload, contentType = "application/json") {
  switch (provider) {
    case "slack":
      return normalizeSlackEvent(payload);
    case "teams":
      return normalizeTeamsWebhook(payload);
    case "telegram":
      return normalizeTelegramUpdate(payload);
    case "whatsapp":
      return normalizeTwilioWhatsAppForm(payload);
    default:
      return normalizeGenericInbound(payload);
  }
}

async function handleRequest(request, response, config) {
  const url = new URL(request.url, `http://${request.headers.host ?? "127.0.0.1"}`);

  if (url.pathname === "/healthz") {
    return sendJson(response, 200, { ok: true });
  }

  if (!isAuthorized(request, config)) {
    return unauthorized(response);
  }

  if (request.method === "GET" && url.pathname === "/me") {
    return sendJson(response, 200, { id: config.selfId });
  }

  if (request.method === "GET" && url.pathname === "/inbound") {
    const state = readRelayState(config.statePath);
    const messages = listRelayMessages(state, {
      after: url.searchParams.get("after"),
      limit: Number(url.searchParams.get("limit") ?? 20),
    });
    return sendJson(response, 200, { messages });
  }

  if (request.method === "POST" && url.pathname === "/outbound") {
    const body = parseJsonBody(await readRequestBody(request));
    await deliverOutboundMessage(String(body.content ?? body.text ?? ""), config.outbound);
    return sendJson(response, 200, { ok: true });
  }

  if (request.method === "POST" && url.pathname.startsWith("/ingest/")) {
    const provider = url.pathname.split("/").at(-1);
    const raw = await readRequestBody(request);
    const contentType = request.headers["content-type"] ?? "application/json";
    const payload = contentType.includes("application/x-www-form-urlencoded")
      ? parseFormBody(raw)
      : parseJsonBody(raw);
    const messages = normalizeInbound(provider, payload, contentType);
    const state = readRelayState(config.statePath);
    appendRelayMessages(state, messages);
    writeRelayState(config.statePath, state);
    return sendJson(response, 200, { ok: true, accepted: messages.length });
  }

  return sendJson(response, 404, { error: "not_found" });
}

export function createRelayServer(config = getRelayConfig()) {
  return http.createServer((request, response) => {
    handleRequest(request, response, config).catch((error) => {
      sendJson(response, 500, {
        error: "internal_error",
        message: error instanceof Error ? error.message : String(error),
      });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = getRelayConfig();
  const server = createRelayServer(config);
  server.listen(config.port, config.host, () => {
    console.log(`[bridge-relay] listening on http://${config.host}:${config.port}`);
  });
}
