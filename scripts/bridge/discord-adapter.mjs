export const DISCORD_MESSAGE_LIMIT = 1900;

export function truncateForDiscord(text) {
  return text.length <= DISCORD_MESSAGE_LIMIT
    ? text
    : `${text.slice(0, DISCORD_MESSAGE_LIMIT - 20)}\n…[truncated]`;
}

export function extractMessageText(message) {
  const candidates = [
    message.content,
    ...(message.embeds ?? []).flatMap(embed => [embed.title, embed.description]),
    ...(message.attachments ?? []).flatMap(attachment => [
      attachment.title,
      attachment.description,
      attachment.filename,
    ]),
  ];

  return candidates
    .filter(value => typeof value === "string" && value.trim().length > 0)
    .join('\n')
    .trim();
}

export class DiscordChannelAdapter {
  constructor({ token, channelId, fetchImpl = fetch }) {
    this.token = token;
    this.channelId = channelId;
    this.fetchImpl = fetchImpl;
  }

  async request(endpoint, init = {}) {
    const response = await this.fetchImpl(`https://discord.com/api/v10${endpoint}`, {
      ...init,
      headers: {
        Authorization: `Bot ${this.token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Discord API ${endpoint} failed (${response.status}): ${text}`);
    }

    return response;
  }

  async fetchRecentMessages(limit = 20) {
    const response = await this.request(`/channels/${this.channelId}/messages?limit=${limit}`, {
      method: 'GET',
    });
    return response.json();
  }

  async fetchMessage(messageId) {
    const response = await this.request(`/channels/${this.channelId}/messages/${messageId}`, {
      method: 'GET',
    });
    return response.json();
  }

  async postMessage(content) {
    const response = await this.request(`/channels/${this.channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content: truncateForDiscord(content) }),
    });
    return response.json();
  }

  async addReaction(messageId, emoji) {
    const encodedEmoji = encodeURIComponent(emoji);
    await this.request(`/channels/${this.channelId}/messages/${messageId}/reactions/${encodedEmoji}/@me`, {
      method: 'PUT',
      headers: { 'Content-Length': '0' },
    });
  }

  async fetchReactionUsers(messageId, emoji, limit = 25) {
    const encodedEmoji = encodeURIComponent(emoji);
    const response = await this.request(`/channels/${this.channelId}/messages/${messageId}/reactions/${encodedEmoji}?limit=${limit}`, {
      method: 'GET',
    });
    return response.json();
  }

  async fetchBotIdentity() {
    const response = await this.request('/users/@me', { method: 'GET' });
    return response.json();
  }
}
