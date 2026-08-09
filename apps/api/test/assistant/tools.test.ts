import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ASSISTANT_TOOLS, runTool, type ToolContext } from '../../src/assistant/tools.js';

/**
 * The assistant's tool layer.
 *
 * The tests that matter here are the SECURITY ones. The assistant chooses its own arguments, so
 * a brand id is attacker-influenced in a way no UI parameter is: a user can simply ask it to
 * look at another tenant's brand, and the model has no reason to refuse. What stops that is not
 * the prompt — it is that every tool re-enters the real routes carrying the caller's own token,
 * so `requireBrandAccess` runs on a request the model composed.
 *
 * These tests assert the properties that make that true, because each one is a property that
 * could be lost by an innocuous-looking refactor.
 */

function fakeApp(inject: ReturnType<typeof vi.fn>): FastifyInstance {
  return { inject } as unknown as FastifyInstance;
}

function okInject(payload: unknown, statusCode = 200) {
  return vi.fn().mockResolvedValue({ statusCode, json: () => payload });
}

const AUTH = 'Bearer caller-token';

function ctx(inject: ReturnType<typeof vi.fn>): ToolContext {
  return { app: fakeApp(inject), authorization: AUTH };
}

describe('tool definitions', () => {
  it('never accepts a tenant as an argument', () => {
    /* THE load-bearing assertion of the whole feature. The tenant comes from the verified
       token and nothing else. If a tenant argument ever appears in a schema, the model can ask
       for another tenant's data in a well-formed way, and the only thing left standing between
       that and a breach is the route's own check. */
    for (const tool of ASSISTANT_TOOLS) {
      const props = (tool.schema as { properties?: Record<string, unknown> }).properties ?? {};
      for (const key of Object.keys(props)) {
        expect(key.toLowerCase(), `${tool.name}.${key}`).not.toContain('tenant');
      }
      expect(JSON.stringify(tool.schema).toLowerCase()).not.toContain('tenantid');
    }
  });

  it('describes every tool well enough for a model to choose it', () => {
    for (const tool of ASSISTANT_TOOLS) {
      expect(tool.name, 'snake_case, as the provider expects').toMatch(/^[a-z][a-z0-9_]*$/);
      expect(tool.description.length, tool.name).toBeGreaterThan(60);
      expect(tool.schema['type']).toBe('object');
    }
  });

  it('has no duplicate tool names', () => {
    const names = ASSISTANT_TOOLS.map((t) => t.name);
    expect(names).toHaveLength(new Set(names).size);
  });

  it('exposes no tool whose name suggests it writes', () => {
    /* A cheap tripwire on the read-only promise. It cannot catch a badly-named mutating tool,
       but it catches the ordinary case of someone adding `create_alias` to be helpful. */
    for (const tool of ASSISTANT_TOOLS) {
      expect(tool.name).not.toMatch(/^(create|update|delete|set|add|remove|write|patch)_/);
    }
  });
});

describe('runTool — authorisation', () => {
  let inject: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    inject = okInject({ brands: [] });
  });

  it("forwards the caller's Authorization header on every call", async () => {
    await runTool(ctx(inject), 'list_brands', {});
    expect(inject).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { authorization: AUTH } }),
    );
  });

  it('only ever issues GET requests', async () => {
    for (const tool of ASSISTANT_TOOLS) {
      if (tool.name === 'search_help') continue;
      inject.mockClear();
      await runTool(ctx(inject), tool.name, { brandId: 'b1' });
      const call = inject.mock.calls[0]?.[0] as { method: string } | undefined;
      expect(call?.method, tool.name).toBe('GET');
    }
  });

  it('reports a forbidden brand to the model instead of throwing', async () => {
    /* The model picked a brand id that is not the caller's. The route rejects it — which is the
       system working — and the assistant must be able to say so rather than the request dying. */
    const forbidden = vi.fn().mockResolvedValue({ statusCode: 403, json: () => ({}) });
    const result = await runTool(ctx(forbidden), 'get_brand_score', { brandId: 'other-tenant' });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result.data)).toContain('not available to you');
  });

  it('does not distinguish "does not exist" from "not yours"', async () => {
    /* Telling the difference turns the tenant boundary into an enumeration oracle: ask about a
       thousand ids and the error message maps another tenant's data for you. */
    const notFound = vi.fn().mockResolvedValue({ statusCode: 404, json: () => ({}) });
    const forbidden = vi.fn().mockResolvedValue({ statusCode: 403, json: () => ({}) });
    const a = await runTool(ctx(notFound), 'get_brand_score', { brandId: 'nope' });
    const b = await runTool(ctx(forbidden), 'get_brand_score', { brandId: 'theirs' });
    expect(a.data).toEqual(b.data);
  });

  it('surfaces other failures without leaking the response body', async () => {
    const boom = vi.fn().mockResolvedValue({ statusCode: 500, json: () => ({ stack: 'secret' }) });
    const result = await runTool(ctx(boom), 'get_brand_score', { brandId: 'b1' });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result.data)).not.toContain('secret');
  });
});

describe('runTool — argument handling', () => {
  it('caps the signal page size regardless of what the model asks for', async () => {
    /* The model has no idea how large a signal is, and an unbounded page would blow the
       context window and the bill. */
    const inject = okInject({ signals: [] });
    await runTool(ctx(inject), 'get_signals', { brandId: 'b1', limit: 5000 });
    const url = (inject.mock.calls[0]?.[0] as { url: string }).url;
    expect(url).toContain('limit=20');
  });

  it('applies a floor to a nonsensical page size', async () => {
    const inject = okInject({ signals: [] });
    await runTool(ctx(inject), 'get_signals', { brandId: 'b1', limit: -3 });
    expect((inject.mock.calls[0]?.[0] as { url: string }).url).toContain('limit=1');
  });

  it('caps the dimension history window', async () => {
    const inject = okInject({ scores: [] });
    await runTool(ctx(inject), 'get_dimension_scores', { brandId: 'b1', days: 99999 });
    expect((inject.mock.calls[0]?.[0] as { url: string }).url).toContain('days=365');
  });

  it('url-encodes a brand id rather than interpolating it raw', async () => {
    /* The id comes from the model. Interpolating it unencoded lets a crafted value change the
       path or append a query parameter. */
    const inject = okInject({});
    await runTool(ctx(inject), 'get_brand_score', { brandId: 'a/../../admin?x=1' });
    const url = (inject.mock.calls[0]?.[0] as { url: string }).url;
    expect(url).not.toContain('../');
    expect(url).toContain(encodeURIComponent('a/../../admin?x=1'));
  });

  it('rejects an unknown tool without dispatching anything', async () => {
    const inject = okInject({});
    const result = await runTool(ctx(inject), 'drop_database', {});
    expect(result.ok).toBe(false);
    expect(inject).not.toHaveBeenCalled();
  });

  it('rejects a call missing its brand id without dispatching', async () => {
    const inject = okInject({});
    const result = await runTool(ctx(inject), 'get_brand_score', {});
    expect(result.ok).toBe(false);
    expect(inject).not.toHaveBeenCalled();
  });

  it('tolerates a non-object input from the model', async () => {
    const inject = okInject({});
    await expect(runTool(ctx(inject), 'search_help', 'just a string')).resolves.toMatchObject({
      ok: true,
    });
  });
});

describe('runTool — help search', () => {
  it('answers from the corpus without touching the API', async () => {
    const inject = okInject({});
    const result = await runTool(ctx(inject), 'search_help', { query: 'how is the index calculated' });
    expect(inject).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    const articles = (result.data as { articles: { slug: string }[] }).articles;
    expect(articles.length).toBeGreaterThan(0);
    expect(articles.map((a) => a.slug)).toContain('understanding-the-index');
  });

  it('returns the whole article body, not a snippet', async () => {
    /* A snippet makes the model reason about a fragment and then cite the article as though it
       had read all of it. */
    const result = await runTool(ctx(okInject({})), 'search_help', { query: 'half-life decay' });
    const articles = (result.data as { articles: { body: string }[] }).articles;
    expect(articles[0]?.body.length).toBeGreaterThan(400);
  });

  it('returns an empty list rather than a wrong article for an unrelated query', async () => {
    const result = await runTool(ctx(okInject({})), 'search_help', { query: 'kubernetes ingress sidecar' });
    expect((result.data as { articles: unknown[] }).articles).toEqual([]);
  });
});
