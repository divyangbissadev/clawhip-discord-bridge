import { BaseMessagingAdapter, normalizeText } from "./base-adapter.mjs";

const TELEGRAM_MESSAGE_LIMIT = 3900;

function truncateForTelegram(text) {
  return text.length <= TELEGRAM_MESSAGE_LIMIT
    ? text
    : `${text.slice(0, TELEGRAM_MESSAGE_LIMIT - 20)}\n…[truncated]`;
}

function normalizeTelegramMessage(update) {
  const message = update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post;
  if (!message) {
    return null;
  }

  return {
    id: String(update.update_id),
    content: normalizeText(message.text) || normalizeText(message.caption),
    author: {
      id: message.from?.id != null ? String(message.from.id) : null,
      username: message.from?.username ?? null,
      global_name: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || null,
      bot: Boolean(message.from?.is_bot),
    },
    raw: update,
  };
}

export class TelegramChatAdapter extends BaseMessagingAdapter {
  constructor({ botToken, chatId, apiBaseUrl = "https://api.telegram.org", fetchImpl = fetch }) {
    super({ provider: "telegram", fetchImpl });
    this.botToken = botToken;
    this.chatId = chatId != null ? String(chatId) : null;
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/, "");
    this.supportsPolling = true;
  }

  async request(methodName, params = {}, { method = "POST" } = {}) {
    const url = new URL(`${this.apiBaseUrl}/bot${this.botToken}/${methodName}`);
    const init = { method };

    if (method === "GET") {
      for (const [key, value] of Object.entries(params)) {
        if (value != null) {
          url.searchParams.set(key, String(value));
        }
      }
    } else {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(params);
    }

    const response = await this.fetchImpl(url, init);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Telegram API ${methodName} failed (${response.status}): ${text}`);
    }

    const data = await response.json();
    if (!data.ok) {
      throw new Error(`Telegram API ${methodName} failed: ${JSON.stringify(data)}`);
    }

    return data.result;
  }

  async fetchRecentMessages({ limit = 20, afterCursor = null } = {}) {
    const updates = await this.request("getUpdates", {
      limit,
      offset: afterCursor != null ? Number(afterCursor) + 1 : undefined,
      timeout: 0,
      allowed_updates: ["message", "edited_message", "channel_post", "edited_channel_post"],
    });

    return updates
      .map(normalizeTelegramMessage)
      .filter(Boolean)
      .filter((message) => !this.chatId || message.raw?.message?.chat?.id == this.chatId || message.raw?.channel_post?.chat?.id == this.chatId);
  }

  async postMessage(content) {
    return this.request("sendMessage", {
      chat_id: this.chatId,
      text: truncateForTelegram(content),
    });
  }

  async fetchBotIdentity() {
    return this.request("getMe", {}, { method: "GET" });
  }
}
