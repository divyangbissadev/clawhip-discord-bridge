export async function postJson(fetchImpl, url, body, headers = {}) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Outbound post failed (${response.status}): ${text}`);
  }

  return response.text().catch(() => "");
}

export async function deliverOutboundMessage(content, config, fetchImpl = fetch) {
  switch (config.mode) {
    case "stdout":
      console.log(`[relay-outbound] ${content}`);
      return { ok: true, mode: "stdout" };
    case "webhook":
      await postJson(fetchImpl, config.webhookUrl, { content, text: content }, config.headers);
      return { ok: true, mode: "webhook" };
    case "slack-webhook":
      await postJson(fetchImpl, config.webhookUrl, { text: content }, config.headers);
      return { ok: true, mode: "slack-webhook" };
    case "teams-webhook":
      await postJson(fetchImpl, config.webhookUrl, { text: content }, config.headers);
      return { ok: true, mode: "teams-webhook" };
    case "telegram":
      await postJson(
        fetchImpl,
        `${config.apiBaseUrl.replace(/\/$/, "")}/bot${config.botToken}/sendMessage`,
        { chat_id: config.chatId, text: content },
        config.headers
      );
      return { ok: true, mode: "telegram" };
    default:
      throw new Error(`Unsupported relay outbound mode: ${config.mode}`);
  }
}
