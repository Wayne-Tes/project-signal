import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROMPT_TEMPLATE, scoreSignal } from '../src/scorer.js';

vi.mock('@project-signal/gemini', () => {
  const mockGenerateContent = vi.fn();
  return {
    getVertexAI: vi.fn(() => ({
      getGenerativeModel: vi.fn(() => ({
        generateContent: mockGenerateContent,
      })),
    })),
    getScorerModel: vi.fn(() => 'gemini-2.5-flash'),
    _mockGenerateContent: mockGenerateContent,
  };
});

describe('PROMPT_TEMPLATE', () => {
  it('contains the review text in the output', () => {
    const review = 'The service was outstanding and I loved every moment!';
    expect(PROMPT_TEMPLATE(review)).toContain(review);
  });

  it('contains the JSON schema with required fields', () => {
    const prompt = PROMPT_TEMPLATE('any review');
    expect(prompt).toContain('"label"');
    expect(prompt).toContain('"score"');
    expect(prompt).toContain('"confidence"');
    expect(prompt).toContain('"dimensions"');
    expect(prompt).toContain('"topics"');
  });

  it('contains all valid sentiment labels', () => {
    const prompt = PROMPT_TEMPLATE('any review');
    expect(prompt).toContain('"positive"');
    expect(prompt).toContain('"negative"');
    expect(prompt).toContain('"neutral"');
    expect(prompt).toContain('"mixed"');
  });

  it('contains all valid dimension values', () => {
    const prompt = PROMPT_TEMPLATE('any review');
    expect(prompt).toContain('"trust"');
    expect(prompt).toContain('"quality"');
    expect(prompt).toContain('"service"');
    expect(prompt).toContain('"value"');
    expect(prompt).toContain('"experience"');
  });

  it('instructs the model to return only valid JSON', () => {
    expect(PROMPT_TEMPLATE('any review')).toContain('Return ONLY valid JSON');
  });
});

describe('scoreSignal', () => {
  const validResult = {
    label: 'positive' as const,
    score: 0.85,
    confidence: 0.92,
    dimensions: ['quality', 'service'] as const,
    topics: ['staff', 'delivery'],
  };

  beforeEach(async () => {
    const gemini = await import('@project-signal/gemini');
    const mockGenerateContent = (gemini as any)._mockGenerateContent;
    mockGenerateContent.mockResolvedValue({
      response: {
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify(validResult) }],
            },
          },
        ],
      },
    });
  });

  it('calls Gemini and returns a parsed ScoreResult with modelVersion', async () => {
    const result = await scoreSignal('Great product, loved it!');
    expect(result.label).toBe('positive');
    expect(result.score).toBe(0.85);
    expect(result.confidence).toBe(0.92);
    expect(result.dimensions).toEqual(['quality', 'service']);
    expect(result.topics).toEqual(['staff', 'delivery']);
    expect(result.modelVersion).toBe('gemini-2.5-flash');
  });

  it('strips markdown code fences from model response', async () => {
    const gemini = await import('@project-signal/gemini');
    const mockGenerateContent = (gemini as any)._mockGenerateContent;
    mockGenerateContent.mockResolvedValue({
      response: {
        candidates: [
          {
            content: {
              parts: [{ text: `\`\`\`json\n${JSON.stringify(validResult)}\n\`\`\`` }],
            },
          },
        ],
      },
    });
    const result = await scoreSignal('Decent experience');
    expect(result.label).toBe('positive');
  });

  it('throws on invalid JSON response from model', async () => {
    const gemini = await import('@project-signal/gemini');
    const mockGenerateContent = (gemini as any)._mockGenerateContent;
    mockGenerateContent.mockResolvedValue({
      response: {
        candidates: [{ content: { parts: [{ text: 'not valid json' }] } }],
      },
    });
    await expect(scoreSignal('some text')).rejects.toThrow();
  });
});
