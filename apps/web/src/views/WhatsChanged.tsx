'use client';

import { useState } from 'react';
import { Activity, ArrowDownRight, ArrowUpRight, Sparkles } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useBrand } from '@/lib/brand-context';
import {
  withTerritory,
  changeHeadline,
  formatDelta,
  sentimentTone,
  type ApiSourceChange,
  type ApiTopicChange,
  type ApiWhatsNew,
} from '@/lib/brand-data';
import { ViewState } from '@/components/ViewState';
import { Badge, Card, EmptyState, Grid, PageHeader, PanelHeader, Stack } from '@/design-system';
import type { NavActions } from '@/lib/types';

/**
 * What's changed — the view the product did not have.
 *
 * Every other analytical view answers "what is perception now". None answered "what moved, and
 * is it getting better", which is the question a channel manager actually has on a Monday. The
 * test applied throughout is whether a weekly report could be written from what is on screen.
 *
 * FOUR LISTS, NOT ONE RANKING, because they answer different questions and merging them would
 * bury the important one:
 *
 *   - New          — subjects that have never come up before, at all.
 *   - Worsening    — sentiment fell. THE list, and the reason the view exists.
 *   - Improving    — sentiment rose. Proof that something worked, which is what justifies the
 *                    next piece of work.
 *   - More / less  — volume moved. Deliberately uncoloured: a surge of praise and a surge of
 *     discussed     complaints are both "rising", so tinting by direction would assert something
 *                    the number does not say.
 */

const WINDOWS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const;

const BASES = [
  { key: 'ingested', label: 'Newly collected' },
  { key: 'published', label: 'Newly published' },
] as const;

function TopicRow({
  topic,
  onOpen,
  showSentiment,
}: {
  topic: ApiTopicChange;
  onOpen: () => void;
  showSentiment: boolean;
}) {
  const delta = formatDelta(topic.sentimentDelta, 2);

  return (
    <button type="button" className="chg-row" onClick={onOpen}>
      <span className="chg-topic">{topic.topic}</span>
      <span className="chg-meta">
        {topic.volume} signal{topic.volume === 1 ? '' : 's'}
        {topic.previousVolume > 0 && <> · was {topic.previousVolume}</>}
      </span>
      {showSentiment && (
        <span className="chg-delta" style={{ color: sentimentTone(topic.sentimentDelta) }}>
          {/* An absent comparison says so in words. Rendering it as 0 — or omitting it and
              letting the column read blank — is how "no prior data" becomes "no change". */}
          {delta ?? 'no prior data'}
        </span>
      )}
      {!showSentiment && (
        <span className="chg-delta" style={{ color: 'var(--t2)' }}>
          {formatDelta(topic.volumeDelta) ?? '—'}
        </span>
      )}
    </button>
  );
}

function TopicPanel({
  title,
  subtitle,
  icon,
  topics,
  empty,
  onOpen,
  showSentiment = true,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  topics: ApiTopicChange[];
  empty: string;
  onOpen: (topic: string) => void;
  showSentiment?: boolean;
}) {
  return (
    <Card>
      <PanelHeader icon={icon} title={title} subtitle={subtitle} />
      {topics.length === 0 ? (
        /* An explicit sentence, not an empty box. "Nothing got worse" is a genuine finding and
           the single most reassuring thing this page can say; a blank panel says nothing and
           reads as broken. */
        <p className="chg-empty">{empty}</p>
      ) : (
        <Stack gap="var(--s-1)">
          {topics.slice(0, 8).map((t) => (
            <TopicRow
              key={t.topic}
              topic={t}
              showSentiment={showSentiment}
              onOpen={() => onOpen(t.topic)}
            />
          ))}
        </Stack>
      )}
    </Card>
  );
}

function SourceTable({ rows }: { rows: ApiSourceChange[] }) {
  return (
    <Stack gap="var(--s-1)">
      {rows.map((r) => {
        const delta = formatDelta(r.sentimentDelta, 2);
        return (
          <div key={r.source} className="chg-row chg-row--static">
            <span className="chg-topic">{r.source.replace(/_/g, ' ')}</span>
            <span className="chg-meta">
              {r.previousVolume} → {r.volume}
              {/* A feed that stopped is the finding this table exists for. It is kept in the
                  list showing a drop to zero, because a silent feed and a healthy one are
                  indistinguishable when only the current period is listed. */}
              {r.volume === 0 && r.previousVolume > 0 && (
                <>
                  {' '}
                  <Badge tone="warn">stopped</Badge>
                </>
              )}
            </span>
            <span className="chg-delta" style={{ color: sentimentTone(r.sentimentDelta) }}>
              {delta ?? 'no prior data'}
            </span>
          </div>
        );
      })}
    </Stack>
  );
}

export function WhatsChangedView({ nav }: { nav: NavActions }) {
  const { brandId, error: brandError, territory } = useBrand();
  const [days, setDays] = useState<number>(7);
  const [basis, setBasis] = useState<'ingested' | 'published'>('ingested');

  const { data, loading, error } = useApi<ApiWhatsNew>(
    brandId ? withTerritory(`/brands/${brandId}/whats-new?days=${days}&basis=${basis}`, territory) : null,
  );

  const openTopic = (topic: string) => nav.openTopic(topic);

  return (
    <>
      <PageHeader
        eyebrow="What's changed"
        title="Since last period"
        subtitle="Every list compares the window against the equal-length period before it. Open any subject to read the signals behind it."
      />

      <div className="chg-controls">
        {WINDOWS.map((w) => (
          <button
            key={w.days}
            type="button"
            className="ds-chip"
            aria-pressed={days === w.days}
            onClick={() => setDays(w.days)}
          >
            {w.label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        {/* Which date decides "when" is a real choice, not a setting to hide. `Newly collected`
            is what we learned — a feed connected today surfaces old material, and that is new to
            us. `Newly published` is what the world said. Showing one while implying the other is
            how this panel would lie. */}
        {BASES.map((b) => (
          <button
            key={b.key}
            type="button"
            className="ds-chip"
            aria-pressed={basis === b.key}
            onClick={() => setBasis(b.key)}
            title={
              b.key === 'ingested'
                ? 'Signals we collected in this window, whenever they were originally published'
                : 'Signals published in this window, whenever we collected them'
            }
          >
            {b.label}
          </button>
        ))}
      </div>

      <ViewState loading={loading} error={error ?? brandError} empty={null}>
        {!data ? null : (
          <Stack gap="var(--s-5)">
            <Card>
              <p className="chg-headline">{changeHeadline(data, days)}</p>
            </Card>

            {data.signalsThisPeriod === 0 && data.signalsPreviousPeriod === 0 ? (
              <Card>
                <EmptyState
                  icon={<Activity size={22} strokeWidth={1.8} />}
                  title="Nothing to compare yet"
                  body="This view needs signals in the window and in the period before it. Once two periods have been collected, everything that moved appears here."
                />
              </Card>
            ) : (
              <>
                <Grid min="360px">
                  <TopicPanel
                    icon={<ArrowDownRight size={20} strokeWidth={1.8} />}
                    title="Getting worse"
                    subtitle="Sentiment fell against the previous period"
                    topics={data.worseningTopics}
                    empty="Nothing got materially worse in this window."
                    onOpen={openTopic}
                  />
                  <TopicPanel
                    icon={<ArrowUpRight size={20} strokeWidth={1.8} />}
                    title="Getting better"
                    subtitle="Sentiment rose against the previous period"
                    topics={data.improvingTopics}
                    empty="Nothing improved materially in this window."
                    onOpen={openTopic}
                  />
                  <TopicPanel
                    icon={<Sparkles size={20} strokeWidth={1.8} />}
                    title="New subjects"
                    subtitle="Never raised before, in any period"
                    topics={data.newTopics}
                    empty="No subject came up that had not been raised before."
                    onOpen={openTopic}
                    showSentiment={false}
                  />
                  <TopicPanel
                    icon={<Activity size={20} strokeWidth={1.8} />}
                    title="More discussed"
                    subtitle="Volume up — not necessarily good or bad"
                    topics={data.risingTopics}
                    empty="No subject gained volume."
                    onOpen={openTopic}
                    showSentiment={false}
                  />
                  <TopicPanel
                    icon={<Activity size={20} strokeWidth={1.8} />}
                    title="Less discussed"
                    subtitle="Volume down, including subjects that stopped entirely"
                    topics={data.fallingTopics}
                    empty="No subject lost volume."
                    onOpen={openTopic}
                    showSentiment={false}
                  />
                </Grid>

                {data.bySource.length > 0 && (
                  <Card>
                    <PanelHeader
                      icon={<Activity size={20} strokeWidth={1.8} />}
                      title="By source"
                      subtitle="Where the movement came from, and which feeds went quiet"
                    />
                    <SourceTable rows={data.bySource} />
                  </Card>
                )}
              </>
            )}
          </Stack>
        )}
      </ViewState>
    </>
  );
}
