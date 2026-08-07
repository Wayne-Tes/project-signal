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
