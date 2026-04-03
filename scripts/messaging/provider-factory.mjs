import { DiscordChannelAdapter } from "./discord.mjs";
import { TelegramChatAdapter } from "./telegram.mjs";
import { RelayMessagingAdapter } from "./relay.mjs";
import { WebhookMessagingAdapter } from "./webhook.mjs";

export function createMessagingAdapter(bridgeConfig, fetchImpl = fetch) {
  switch (bridgeConfig.provider) {
    case "discord":
      if (!bridgeConfig.providers.discord.token || !bridgeConfig.providers.discord.channelId) {
        throw new Error("Discord provider requires token and channelId");
      }
      return new DiscordChannelAdapter({
        token: bridgeConfig.providers.discord.token,
        channelId: bridgeConfig.providers.discord.channelId,
        fetchImpl,
      });
    case "telegram":
      if (!bridgeConfig.providers.telegram.botToken || !bridgeConfig.providers.telegram.chatId) {
        throw new Error("Telegram provider requires botToken and chatId");
      }
      return new TelegramChatAdapter({
        botToken: bridgeConfig.providers.telegram.botToken,
        chatId: bridgeConfig.providers.telegram.chatId,
        apiBaseUrl: bridgeConfig.providers.telegram.apiBaseUrl,
        fetchImpl,
      });
    case "relay":
      if (!bridgeConfig.providers.relay.inboundUrl || !bridgeConfig.providers.relay.outboundUrl) {
        throw new Error("Relay provider requires inboundUrl and outboundUrl");
      }
      return new RelayMessagingAdapter({
        ...bridgeConfig.providers.relay,
        fetchImpl,
      });
    case "webhook":
      if (!bridgeConfig.providers.webhook.webhookUrl) {
        throw new Error("Webhook provider requires webhookUrl");
      }
      return new WebhookMessagingAdapter({
        provider: "webhook",
        webhookUrl: bridgeConfig.providers.webhook.webhookUrl,
        fetchImpl,
      });
    case "slack-webhook":
      if (!bridgeConfig.providers.slackWebhook.webhookUrl) {
        throw new Error("Slack webhook provider requires webhookUrl");
      }
      return new WebhookMessagingAdapter({
        provider: "slack-webhook",
        webhookUrl: bridgeConfig.providers.slackWebhook.webhookUrl,
        payloadBuilder: (content) => ({ text: content }),
        fetchImpl,
      });
    case "teams-webhook":
      if (!bridgeConfig.providers.teamsWebhook.webhookUrl) {
        throw new Error("Teams webhook provider requires webhookUrl");
      }
      return new WebhookMessagingAdapter({
        provider: "teams-webhook",
        webhookUrl: bridgeConfig.providers.teamsWebhook.webhookUrl,
        payloadBuilder: (content) => ({ text: content }),
        fetchImpl,
      });
    default:
      throw new Error(`Unsupported bridge provider: ${bridgeConfig.provider}`);
  }
}
