// The model call for CamBot, via the official Anthropic SDK. Reads
// ANTHROPIC_API_KEY from the environment; the key never appears in code.

import Anthropic from "@anthropic-ai/sdk";
import type { ModelReply, Responder } from "./cam-brain";

/** US dollars per million input / output tokens. Unknown models are priced high so the budget errs safe. */
const PRICES: Record<string, [number, number]> = {
  "claude-haiku-4-5": [1, 5],
  "claude-sonnet-5": [2, 10],
  "claude-opus-5": [5, 25],
};

export function costOf(model: string, usage: { input_tokens: number; output_tokens: number }): number {
  const [input, output] = PRICES[model] ?? [10, 50];
  return (usage.input_tokens * input + usage.output_tokens * output) / 1_000_000;
}

/** Chat replies are a sentence or two; 300 tokens leaves room without inviting essays. */
const MAX_TOKENS = 300;

export function claudeResponder(model = "claude-haiku-4-5", client = new Anthropic({ timeout: 20_000 })): Responder {
  return async (system, userContent): Promise<ModelReply> => {
    const response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: "user", content: userContent }],
    });
    const costUsd = costOf(model, response.usage);
    if (response.stop_reason === "refusal") return { text: null, refused: true, costUsd };
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join(" ")
      .trim();
    return { text: text || null, refused: false, costUsd };
  };
}
