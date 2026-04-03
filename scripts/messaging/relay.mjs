import { BaseMessagingAdapter, normalizeText } from "./base-adapter.mjs";

function unwrapMessages(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.messages)) {
    return payload.messages;
  }
  return [];
}

function normalizeRelayMessage(message) {
  return {
    id: String(message.id ?? message.cursor ?? ""),
    content: normalizeText(message.content ?? message.text),
    author: {
      id: message.author?.id ?? message.authorId ?? null,
      username: message.author?.username ?? message.authorName ?? null,
      global_name: message.author?.global_name ?? message.author?.name ?? message.authorName ?? null,
      bot: Boolean(message.author?.bot),
    },
    ...message,
  };
}

export class RelayMessagingAdapter extends BaseMessagingAdapter {
  constructor({
    inboundUrl,
    outboundUrl,
    identityUrl = null,
    selfId = null,
    authHeaderName = null,
    authHeaderValue = null,
    fetchImpl = fetch,
  }) {
    super({ provider: "relay", fetchImpl });
    this.inboundUrl = inboundUrl;
    this.outboundUrl = outboundUrl;
    this.identityUrl = identityUrl;
    this.selfId = selfId;
    this.authHeaderName = authHeaderName;
    this.authHeaderValue = authHeaderValue;
    this.supportsPolling = Boolean(inboundUrl);
  }

  buildHeaders(extra = {}) {
    return {
      "Content-Type": "application/json",
      ...(this.authHeaderName && this.authHeaderValue
        ? { [this.authHeaderName]: this.authHeaderValue }
        : {}),
      ...extra,
    };
  }

  async fetchRecentMessages({ limit = 20, afterCursor = null } = {}) {
    const url = new URL(this.inboundUrl);
    url.searchParams.set("limit", String(limit));
    if (afterCursor != null) {
      url.searchParams.set("after", String(afterCursor));
    }
    const response = await this.fetchImpl(url, { method: "GET", headers: this.buildHeaders() });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Relay inbound fetch failed (${response.status}): ${text}`);
    }
    const payload = await response.json();
    return unwrapMessages(payload).map(normalizeRelayMessage);
  }

  async postMessage(content) {
    const response = await this.fetchImpl(this.outboundUrl, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({ content }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Relay outbound post failed (${response.status}): ${text}`);
    }
    return response.json().catch(() => ({ ok: true }));
  }

  async fetchBotIdentity() {
    if (this.identityUrl) {
      const response = await this.fetchImpl(this.identityUrl, {
        method: "GET",
        headers: this.buildHeaders(),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Relay identity fetch failed (${response.status}): ${text}`);
      }
      return response.json();
    }

    return { id: this.selfId };
  }
}
