import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn(() => ({ send: mockSend })),
  ConverseCommand: vi.fn((input) => ({ input })),
}));

const mockEnv: Record<string, string | undefined> = {};
vi.mock('@project-signal/config', () => ({ getEnv: vi.fn(() => mockEnv) }));

const SCHEMA = {
  type: 'object',
  properties: { label: { type: 'string' } },
  required: ['label'],
};

const MODEL = 'eu.anthropic.claude-haiku-4-5-20251001-v1:0';

const request = {
  model: MODEL,
  prompt: 'Analyse this.',
  name: 'record_sentiment',
  description: 'Records an assessment.',
  schema: SCHEMA,
};

beforeEach(() => {
  vi.resetModules();
  mockSend.mockReset();
  for (const k of Object.keys(mockEnv)) delete mockEnv[k];
  delete process.env['AWS_ENDPOINT_URL'];
});

describe('BedrockLlmClient.structured', () => {
  it('forces the tool so the provider returns a parsed object, not prose', async () => {
    mockSend.mockResolvedValue({
      output: { message: { content: [{ toolUse: { name: 'record_sentiment', input: { label: 'positive' } } }] } },
    });
    const { getLlmClient } = await import('../src/index.js');

    await expect(getLlmClient().structured(request)).resolves.toEqual({ label: 'positive' });

    const sent = mockSend.mock.calls[0]![0].input;
    expect(sent.modelId).toBe(MODEL);
    expect(sent.messages).toEqual([{ role: 'user', content: [{ text: 'Analyse this.' }] }]);
    // toolChoice is the whole mechanism: without it the model may answer in prose and we are
    // back to parsing, which is the failure this replaced.
    expect(sent.toolConfig.toolChoice).toEqual({ tool: { name: 'record_sentiment' } });
    expect(sent.toolConfig.tools[0].toolSpec.inputSchema.json).toBe(SCHEMA);
  });

  it('passes the inference-profile id through unchanged', async () => {
    // Bedrock rejects a bare model id with "on-demand throughput isn't supported", and which
    // profile is correct is a data-residency decision — the client must not rewrite it.
    mockSend.mockResolvedValue({
      output: { message: { content: [{ toolUse: { name: 'record_sentiment', input: {} } }] } },
    });
    const { getLlmClient } = await import('../src/index.js');
    await getLlmClient().structured({ ...request, model: 'global.anthropic.claude-opus-5' });
    expect(mockSend.mock.calls[0]![0].input.modelId).toBe('global.anthropic.claude-opus-5');
  });

  it('throws LlmResponseError when no tool call comes back', async () => {
    mockSend.mockResolvedValue({
      output: { message: { content: [{ text: 'I would rather explain in prose.' }] } },
      stopReason: 'end_turn',
    });
    const { getLlmClient, LlmResponseError } = await import('../src/index.js');
    await expect(getLlmClient().structured(request)).rejects.toBeInstanceOf(LlmResponseError);
  });

  it('surfaces the stop reason in the error, so a truncated turn is diagnosable', async () => {
    mockSend.mockResolvedValue({ output: { message: { content: [] } }, stopReason: 'max_tokens' });
    const { getLlmClient } = await import('../src/index.js');
    await expect(getLlmClient().structured(request)).rejects.toThrow(/max_tokens/);
  });

  it('propagates a transport failure rather than converting it to a response error', async () => {
    // The caller classifies transport failures as transient and retries; misreporting one as a
    // response error would ack the message and drop the signal (KNOWN-GAPS #9).
    mockSend.mockRejectedValue(new Error('ThrottlingException'));
    const { getLlmClient, LlmResponseError } = await import('../src/index.js');
    const err = await getLlmClient().structured(request).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(LlmResponseError);
    expect(String(err)).toMatch(/ThrottlingException/);
  });

  it('points at LocalStack when AWS_ENDPOINT_URL is set', async () => {
    process.env['AWS_ENDPOINT_URL'] = 'http://localhost:4566';
    const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
    const { getLlmClient } = await import('../src/index.js');
    getLlmClient();
    expect(BedrockRuntimeClient).toHaveBeenCalledWith({ endpoint: 'http://localhost:4566' });
  });

  it('passes no explicit config in a deployed environment', async () => {
    const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
    const { getLlmClient } = await import('../src/index.js');
    getLlmClient();
    expect(BedrockRuntimeClient).toHaveBeenCalledWith({});
  });
});

describe('model resolution', () => {
  it('reads the models by use case from config', async () => {
    mockEnv['SCORER_MODEL'] = MODEL;
    mockEnv['REPORTER_MODEL'] = 'eu.anthropic.claude-sonnet-5';
    const { getScorerModel, getReporterModel } = await import('../src/index.js');
    expect(getScorerModel()).toBe(MODEL);
    expect(getReporterModel()).toBe('eu.anthropic.claude-sonnet-5');
  });
});

describe('getLlmClient', () => {
  it('memoises the client', async () => {
    const { getLlmClient } = await import('../src/index.js');
    expect(getLlmClient()).toBe(getLlmClient());
  });

  it('resetLlmClient drops the memoised instance', async () => {
    const { getLlmClient, resetLlmClient } = await import('../src/index.js');
    const first = getLlmClient();
    resetLlmClient();
    expect(getLlmClient()).not.toBe(first);
  });
});

describe('BedrockLlmClient.converse', () => {
  const CONVERSE = {
    model: 'eu.anthropic.claude-sonnet-5',
    system: 'You are a test.',
    messages: [{ role: 'user' as const, blocks: [{ kind: 'text' as const, text: 'hello' }] }],
  };

  function reply(blocks: unknown[], stopReason = 'end_turn') {
    return {
      output: { message: { content: blocks } },
      stopReason,
      usage: { inputTokens: 11, outputTokens: 7 },
    };
  }

  /**
   * REGRESSION. `temperature` defaulted to 0 — a sensible-looking choice for analytical work —
   * and Claude Sonnet 5 rejects the request outright: "ValidationException: The model returned
   * the following errors: `temperature` is deprecated for this model." Every assistant request
   * 500'd against the only model family this account can currently invoke, and nothing local
   * caught it because the SDK is mocked in every test. Omission is now the default.
   */
  it('omits temperature entirely unless a caller asks for one', async () => {
    mockSend.mockResolvedValue(reply([{ text: 'hi' }]));
    const { getLlmClient } = await import('../src/index.js');
    await getLlmClient().converse(CONVERSE);

    const cfg = mockSend.mock.calls[0]?.[0].input.inferenceConfig;
    expect(cfg).not.toHaveProperty('temperature');
    expect(cfg.maxTokens).toBe(4096);
  });

  it('passes temperature through when explicitly set', async () => {
    mockSend.mockResolvedValue(reply([{ text: 'hi' }]));
    const { getLlmClient } = await import('../src/index.js');
    await getLlmClient().converse({ ...CONVERSE, temperature: 0.7 });
    expect(mockSend.mock.calls[0]?.[0].input.inferenceConfig.temperature).toBe(0.7);
  });

  it('returns text blocks and usage', async () => {
    mockSend.mockResolvedValue(reply([{ text: 'the answer' }]));
    const { getLlmClient } = await import('../src/index.js');
    const result = await getLlmClient().converse(CONVERSE);

    expect(result.blocks).toEqual([{ kind: 'text', text: 'the answer' }]);
    expect(result.stopReason).toBe('endTurn');
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 7 });
  });

  it('maps a tool call, preserving the id the provider issued', async () => {
    /* The id correlates a call with its result. A mismatch is rejected by the provider and
       fails the whole conversation, not just the one tool. */
    mockSend.mockResolvedValue(
      reply([{ toolUse: { toolUseId: 'tu-1', name: 'get_brand_score', input: { brandId: 'b' } } }], 'tool_use'),
    );
    const { getLlmClient } = await import('../src/index.js');
    const result = await getLlmClient().converse(CONVERSE);

    expect(result.stopReason).toBe('toolUse');
    expect(result.blocks[0]).toEqual({
      kind: 'toolUse',
      id: 'tu-1',
      name: 'get_brand_score',
      input: { brandId: 'b' },
    });
  });

  it('drops a block type it does not understand rather than guessing', async () => {
    mockSend.mockResolvedValue(reply([{ reasoningContent: { text: 'thinking' } }, { text: 'answer' }]));
    const { getLlmClient } = await import('../src/index.js');
    const result = await getLlmClient().converse(CONVERSE);
    expect(result.blocks).toEqual([{ kind: 'text', text: 'answer' }]);
  });

  it('offers tools with auto choice, never forcing one', async () => {
    /* Forcing a tool would make the model invent a call to answer "what does the index
       measure?", which needs no data at all. */
    mockSend.mockResolvedValue(reply([{ text: 'hi' }]));
    const { getLlmClient } = await import('../src/index.js');
    await getLlmClient().converse({
      ...CONVERSE,
      tools: [{ name: 'search_help', description: 'Search help.', schema: { type: 'object' } }],
    });

    const toolConfig = mockSend.mock.calls[0]?.[0].input.toolConfig;
    expect(toolConfig.toolChoice).toEqual({ auto: {} });
    expect(toolConfig.tools[0].toolSpec.name).toBe('search_help');
  });

  it('sends no toolConfig at all when there are no tools', async () => {
    mockSend.mockResolvedValue(reply([{ text: 'hi' }]));
    const { getLlmClient } = await import('../src/index.js');
    await getLlmClient().converse(CONVERSE);
    expect(mockSend.mock.calls[0]?.[0].input).not.toHaveProperty('toolConfig');
  });

  it('serialises a tool result with its status, not as a JSON blob saying "error"', async () => {
    /* Surfacing failure as `error` lets the model retry or explain, instead of reporting our
       failure text back to the user as though it were data. */
    mockSend.mockResolvedValue(reply([{ text: 'ok' }]));
    const { getLlmClient } = await import('../src/index.js');
    await getLlmClient().converse({
      ...CONVERSE,
      messages: [
        { role: 'user', blocks: [{ kind: 'toolResult', id: 'tu-1', result: { e: 1 }, isError: true }] },
      ],
    });

    const block = mockSend.mock.calls[0]?.[0].input.messages[0].content[0];
    expect(block.toolResult.status).toBe('error');
    expect(block.toolResult.toolUseId).toBe('tu-1');
  });

  it('collapses an unrecognised stop reason to `other`', async () => {
    mockSend.mockResolvedValue(reply([{ text: 'hi' }], 'something_new'));
    const { getLlmClient } = await import('../src/index.js');
    expect((await getLlmClient().converse(CONVERSE)).stopReason).toBe('other');
  });
});
