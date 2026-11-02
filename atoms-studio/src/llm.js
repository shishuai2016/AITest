import { recordLlmCall } from './db.js';

const config = {
  apiKey: process.env.ARK_API_KEY || process.env.VOLCENGINE_ARK_API_KEY || '',
  baseUrl: (process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, ''),
  model: process.env.ARK_MODEL || 'deepseek-v4-flash-ga-260731',
  fallbackModel: process.env.ARK_FALLBACK_MODEL || 'doubao-seed-2-0-code-preview-260215',
  thinking: process.env.ARK_THINKING || 'disabled',
  timeoutMs: Number(process.env.LLM_TIMEOUT_MS || 240000),
};

export function llmStatus() {
  return {
    enabled: Boolean(config.apiKey),
    model: config.model,
    provider: config.apiKey ? 'volcengine-ark' : 'local-fallback',
  };
}

export function llmConfig() {
  return { ...config, apiKey: config.apiKey ? '***' : '' };
}

/**
 * OpenAI-compatible chat call against Volcengine Ark.
 * Supports streaming and returns { text, usage, model, latencyMs }.
 */
export async function chat({
  messages,
  model,
  maxTokens = 8192,
  temperature = 0.7,
  stream = false,
  onDelta,
  purpose = 'chat',
  projectId = null,
  responseFormat = null,
}) {
  if (!config.apiKey) throw new Error('LLM_NOT_CONFIGURED');

  const started = Date.now();
  const requestedModel = model || config.model;
  const body = {
    model: requestedModel,
    messages,
    max_tokens: maxTokens,
    temperature,
    stream,
    thinking: { type: config.thinking === 'enabled' ? 'enabled' : 'disabled' },
  };
  if (responseFormat) body.response_format = responseFormat;
  if (stream) body.stream_options = { include_usage: true };

  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let idleTimer = null;
    let timeout = null;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`ARK_${response.status}: ${detail.slice(0, 500)}`);
      }

      let text = '';
      let usage = { prompt_tokens: 0, completion_tokens: 0 };
      let resolvedModel = requestedModel;

      if (stream) {
        idleTimer = setTimeout(() => controller.abort(), Number(process.env.LLM_IDLE_TIMEOUT_MS || 90000));
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (idleTimer) idleTimer.refresh();
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';
          for (const part of parts) {
            const dataLines = part
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trim());
            for (const data of dataLines) {
              if (!data || data === '[DONE]') continue;
              let parsed;
              try {
                parsed = JSON.parse(data);
              } catch {
                continue;
              }
              if (parsed.model) resolvedModel = parsed.model;
              if (parsed.usage) usage = parsed.usage;
              const delta = parsed.choices?.[0]?.delta;
              const chunk = delta?.content || '';
              if (chunk) {
                text += chunk;
                onDelta?.(chunk);
              }
            }
          }
        }
        clearTimeout(timeout);
        if (idleTimer) clearTimeout(idleTimer);
      } else {
        const payload = await response.json();
        clearTimeout(timeout);
        if (idleTimer) clearTimeout(idleTimer);
        if (payload.error) throw new Error(payload.error.message || 'ARK_ERROR');
        resolvedModel = payload.model || requestedModel;
        usage = payload.usage || usage;
        text = payload.choices?.[0]?.message?.content || '';
      }

      const latencyMs = Date.now() - started;
      recordLlmCall({
        projectId,
        purpose,
        model: resolvedModel,
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        latencyMs,
        ok: true,
      });
      return { text, usage, model: resolvedModel, latencyMs };
    } catch (error) {
      if (timeout) clearTimeout(timeout);
      if (idleTimer) clearTimeout(idleTimer);
      lastError = error;
      const message = String(error?.message || error);
      const retryable = /ARK_5\d\d|fetch failed|ECONNRESET|ETIMEDOUT|terminated|aborted/i.test(message);
      if (attempt < 2 && retryable) {
        await new Promise((resolve) => setTimeout(resolve, 800));
        continue;
      }
      break;
    }
  }

  recordLlmCall({
    projectId,
    purpose,
    model: requestedModel,
    latencyMs: Date.now() - started,
    ok: false,
  });
  throw lastError || new Error('LLM_ERROR');
}

export function isRetryableLlmError(error) {
  const message = String(error?.message || error);
  return /ARK_429|AccountQuotaExceeded|rate limit|ModelNotOpen|LLM_NOT_CONFIGURED/i.test(message);
}
