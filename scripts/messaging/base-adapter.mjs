export class BaseMessagingAdapter {
  constructor({ provider, fetchImpl = fetch }) {
    this.provider = provider;
    this.fetchImpl = fetchImpl;
    this.supportsPolling = false;
    this.supportsReactions = false;
  }

  getMessageCursor(message) {
    return String(message.id ?? "");
  }

  compareMessageCursors(left, right) {
    if (left == null && right == null) return 0;
    if (left == null) return -1;
    if (right == null) return 1;

    const leftString = String(left);
    const rightString = String(right);
    if (/^\d+$/.test(leftString) && /^\d+$/.test(rightString)) {
      return BigInt(leftString) > BigInt(rightString)
        ? 1
        : BigInt(leftString) < BigInt(rightString)
          ? -1
          : 0;
    }

    return leftString.localeCompare(rightString);
  }

  isMessageNewer(message, previousCursor) {
    return this.compareMessageCursors(this.getMessageCursor(message), previousCursor) > 0;
  }

  sortMessages(messages) {
    return [...messages].sort((left, right) =>
      this.compareMessageCursors(this.getMessageCursor(left), this.getMessageCursor(right))
    );
  }

  extractMessageText(message) {
    return String(message.content ?? "").trim();
  }

  getAuthorId(message) {
    return message.author?.id ?? null;
  }

  getAuthorName(message) {
    return (
      message.author?.global_name ??
      message.author?.username ??
      message.author?.id ??
      "unknown"
    );
  }

  async fetchRecentMessages() {
    throw new Error(`${this.provider} provider does not support polling`);
  }

  async fetchMessage() {
    throw new Error(`${this.provider} provider does not support fetchMessage`);
  }

  async postMessage() {
    throw new Error(`${this.provider} provider does not support postMessage`);
  }

  async addReaction() {
    throw new Error(`${this.provider} provider does not support reactions`);
  }

  async fetchReactionUsers() {
    throw new Error(`${this.provider} provider does not support reaction user fetch`);
  }

  async fetchBotIdentity() {
    return { id: null };
  }
}

export function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}
