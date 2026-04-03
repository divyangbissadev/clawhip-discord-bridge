import { Buffer } from "node:buffer";

function normalizeAuthor({ id = null, username = null, globalName = null, bot = false } = {}) {
  return {
    id: id == null ? null : String(id),
    username,
    global_name: globalName,
    bot: Boolean(bot),
  };
}

function buildNormalizedMessage({ content, author, raw, provider, channel = null }) {
  const text = String(content ?? "").trim();
  if (!text) {
    return null;
  }

  return {
    content: text,
    author,
    provider,
    channel,
    raw,
  };
}

export function parseJsonBody(buffer) {
  return JSON.parse(Buffer.from(buffer).toString("utf8"));
}

export function parseFormBody(buffer) {
  const params = new URLSearchParams(Buffer.from(buffer).toString("utf8"));
  return Object.fromEntries(params.entries());
}

export function normalizeSlackEvent(payload) {
  const event = payload?.event ?? payload;
  const message = buildNormalizedMessage({
    content: event?.text,
    author: normalizeAuthor({
      id: event?.user ?? payload?.authorizations?.[0]?.user_id ?? null,
      username: event?.username ?? null,
      globalName: event?.username ?? null,
      bot: Boolean(event?.bot_id),
    }),
    provider: "slack",
    channel: event?.channel ?? null,
    raw: payload,
  });

  return message ? [message] : [];
}

export function normalizeTeamsWebhook(payload) {
  const message = buildNormalizedMessage({
    content:
      payload?.text ??
      payload?.summary ??
      payload?.body?.content ??
      payload?.value?.[0]?.text,
    author: normalizeAuthor({
      id: payload?.from?.id ?? payload?.sender?.id ?? null,
      username: payload?.from?.name ?? payload?.sender?.displayName ?? null,
      globalName: payload?.from?.name ?? payload?.sender?.displayName ?? null,
    }),
    provider: "teams",
    channel: payload?.conversation?.id ?? payload?.channelId ?? null,
    raw: payload,
  });

  return message ? [message] : [];
}

export function normalizeTelegramUpdate(payload) {
  const update = payload?.message ?? payload?.edited_message ?? payload?.channel_post ?? payload;
  const message = buildNormalizedMessage({
    content: update?.text ?? update?.caption,
    author: normalizeAuthor({
      id: update?.from?.id ?? null,
      username: update?.from?.username ?? null,
      globalName: [update?.from?.first_name, update?.from?.last_name].filter(Boolean).join(" ") || null,
      bot: Boolean(update?.from?.is_bot),
    }),
    provider: "telegram",
    channel: update?.chat?.id != null ? String(update.chat.id) : null,
    raw: payload,
  });

  return message ? [message] : [];
}

export function normalizeTwilioWhatsAppForm(payload) {
  const message = buildNormalizedMessage({
    content: payload?.Body,
    author: normalizeAuthor({
      id: payload?.From ?? null,
      username: payload?.ProfileName ?? payload?.From ?? null,
      globalName: payload?.ProfileName ?? payload?.From ?? null,
    }),
    provider: "whatsapp",
    channel: payload?.To ?? null,
    raw: payload,
  });

  return message ? [message] : [];
}

export function normalizeGenericInbound(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [payload];
  return messages
    .map((message) =>
      buildNormalizedMessage({
        content: message?.content ?? message?.text,
        author: normalizeAuthor({
          id: message?.author?.id ?? message?.authorId ?? null,
          username: message?.author?.username ?? message?.authorName ?? null,
          globalName: message?.author?.global_name ?? message?.author?.name ?? message?.authorName ?? null,
          bot: Boolean(message?.author?.bot),
        }),
        provider: message?.provider ?? payload?.provider ?? "generic",
        channel: message?.channel ?? payload?.channel ?? null,
        raw: payload,
      })
    )
    .filter(Boolean);
}
