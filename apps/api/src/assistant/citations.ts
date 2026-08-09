import type { JsonValue } from '@project-signal/llm';

/**
 * Citations.
 *
 * ============================================================================================
 * CITATIONS ARE DERIVED FROM WHAT WAS FETCHED, NOT FROM WHAT THE MODEL SAYS IT USED.
 * ============================================================================================
 *
 * The obvious implementation is to ask the model to emit `[1]` markers and a source list, and
 * render that. It is also worthless: the citation list becomes model output, so a model that
 * invents a figure will happily invent a plausible source for it, and the citation makes the
 * wrong answer MORE convincing rather than checkable. A user who clicks through and finds a
 * real-looking record has been misled with extra steps.
 *
 * So citations here are structural. They are built by this module from the tool results that
 * actually came back — the record ids, titles and URLs that were genuinely fetched during the
 * turn. A citation therefore cannot reference something that was not read. It is a record of
 * what the answer was built from, which is a weaker claim than "this sentence came from here"
 * and is one we can actually keep.
 *
 * The model is told to ground its claims and not to invent numbers; that is a quality
 * instruction. This module is the part that does not depend on the model complying.
 */

export interface Citation {
  /** Stable within one answer. Rendered as the reference chip. */
  id: string;
  kind: 'help' | 'score' | 'dimension' | 'cluster' | 'signal' | 'brand' | 'stats';
  title: string;
  /** Short human context — a value, a count, a date. */
  detail?: string;
  /** In-product link, or the signal's external URL. Absent when nothing sensible to open. */
  href?: string;
}

function asRecord(v: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined;
}

function asArray(v: JsonValue | undefined): JsonValue[] {
  return Array.isArray(v) ? v : [];
}

function str(v: JsonValue | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function num(v: JsonValue | undefined): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

/** One decimal, but only when it needs one — "62" reads better than "62.0". */
function round(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * Builds the citation list for one answer.
 *
 * Deduplicated by kind+title: a model that calls `get_brand_impact` twice while reasoning
 * should not produce the same source twice in the list.
 */
export function buildCitations(
  results: { name: string; input: JsonValue; data: JsonValue }[],
): Citation[] {
  const out: Citation[] = [];
  const seen = new Set<string>();

  const push = (c: Omit<Citation, 'id'>): void => {
    const key = `${c.kind}:${c.title}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...c, id: `S${out.length + 1}` });
  };

  for (const { name, input, data } of results) {
    const brandId = str(asRecord(input)?.['brandId']);
    const rec = asRecord(data);

    switch (name) {
      case 'search_help': {
        for (const a of asArray(rec?.['articles'])) {
          const art = asRecord(a);
          const slug = str(art?.['slug']);
          if (!slug) continue;
          push({
            kind: 'help',
            title: str(art?.['title']) ?? slug,
            detail: str(art?.['summary']),
            href: `/help/${slug}`,
          });
        }
        break;
      }

      case 'list_brands': {
        /* Cited only as the origin of the brand list — individual brands are cited by the tool
           that actually reported something about them. */
        const brands = asArray(rec?.['brands'] ?? data);
        if (brands.length) {
          push({ kind: 'brand', title: 'Brands in your tenant', detail: `${brands.length} brand(s)` });
        }
        break;
      }

      case 'get_brand_score': {
        const score = num(rec?.['score']) ?? num(asRecord(rec?.['score'])?.['value']);
        push({
          kind: 'score',
          title: 'Brand Perception Index',
          detail: score === undefined ? 'not scored yet' : round(score),
          href: '/dashboard',
        });
        break;
      }

      case 'get_dimension_scores': {
        const rows = asArray(rec?.['scores'] ?? rec?.['dimensionScores'] ?? data);
        /* One citation per dimension, not per data point — a 90-day history is hundreds of
           rows and a citation list nobody reads is the same as no citation list. */
        const byDimension = new Map<string, { score?: number; date?: string }>();
        for (const r of rows) {
          const row = asRecord(r);
          const dim = str(row?.['dimension']);
          if (!dim) continue;
          const date = str(row?.['date']);
          const prev = byDimension.get(dim);
          if (!prev || (date && prev.date && date > prev.date) || !prev.date) {
            byDimension.set(dim, { score: num(row?.['score']), date });
          }
        }
        for (const [dim, v] of byDimension) {
          push({
            kind: 'dimension',
            title: `${dim.charAt(0).toUpperCase()}${dim.slice(1)} score`,
            detail: v.score === undefined ? undefined : `${round(v.score)}${v.date ? ` on ${v.date}` : ''}`,
            href: '/trends',
          });
        }
        break;
      }

      case 'get_brand_impact':
      case 'get_strengths': {
        const clusters = asArray(rec?.['clusters'] ?? data);
        const kindLabel = name === 'get_brand_impact' ? 'damage' : 'strength';
        for (const c of clusters) {
          const cl = asRecord(c);
          const topic = str(cl?.['topic']);
          if (!topic) continue;
          const volume = num(cl?.['volume']);
          const metric = num(cl?.[kindLabel]);
          push({
            kind: 'cluster',
            title: topic,
            detail: [
              volume === undefined ? undefined : `${volume} signal(s)`,
              metric === undefined ? undefined : `${kindLabel} ${round(metric)}`,
            ]
              .filter(Boolean)
              .join(' · '),
            href: name === 'get_brand_impact' ? '/brand-impact' : '/dashboard',
          });
        }
        break;
      }

      case 'get_sentiment_summary': {
        push({
          kind: 'stats',
          title: 'Sentiment breakdown',
          detail: Object.entries(rec ?? {})
            .filter(([, v]) => typeof v === 'number')
            .map(([k, v]) => `${k} ${String(v)}`)
            .join(' · '),
          href: '/dashboard',
        });
        break;
      }

      case 'get_brand_stats': {
        const total = num(rec?.['totalSignals']) ?? num(rec?.['signalCount']) ?? num(rec?.['total']);
        push({
          kind: 'stats',
          title: 'Signal volume',
          detail: total === undefined ? undefined : `${total} signal(s) collected`,
          href: '/trends',
        });
        break;
      }

      case 'get_signals': {
        const items = asArray(rec?.['signals'] ?? rec?.['items'] ?? data);
        for (const s of items) {
          const sig = asRecord(s);
          const id = str(sig?.['id']);
          if (!id) continue;
          const source = str(sig?.['source']);
          const published = str(sig?.['publishedAt']);
          push({
            kind: 'signal',
            /* The signal's own title if the route returns one; otherwise identify it by source
               and date rather than by a raw uuid, which tells a reader nothing. */
            title: str(sig?.['title']) ?? `${source ?? 'Signal'} · ${published?.slice(0, 10) ?? id.slice(0, 8)}`,
            detail: source && published ? `${source}, ${published.slice(0, 10)}` : undefined,
            /* The external URL is the honest destination for a signal: it is where the thing
               was actually published, and it is what lets a user verify the quote themselves. */
            href: str(sig?.['sourceUrl']),
          });
        }
        break;
      }

      default:
        break;
    }

    /* Nothing below depends on brandId; it is read only to keep the signature honest about
       what a citation could be scoped to later. */
    void brandId;
  }

  return out;
}
