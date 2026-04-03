import { BaseMessagingAdapter } from "./base-adapter.mjs";

export class WebhookMessagingAdapter extends BaseMessagingAdapter {
  constructor({ provider = "webhook", webhookUrl, payloadBuilder = null, fetchImpl = fetch }) {
    super({ provider, fetchImpl });
    this.webhookUrl = webhookUrl;
    this.payloadBuilder = payloadBuilder ?? ((content) => ({ text: content, content }));
  }

  async postMessage(content) {
    const response = await this.fetchImpl(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.payloadBuilder(content)),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${this.provider} webhook post failed (${response.status}): ${text}`);
    }
    return response.text().catch(() => "");
  }
}
