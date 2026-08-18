'use client';

import { useState } from 'react';
import { Handshake, Link2, ShieldCheck } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useBrand } from '@/lib/brand-context';
import { withTerritory } from '@/lib/brand-data';
import { ViewState } from '@/components/ViewState';
import { Badge, Card, EmptyState, PageHeader, PanelHeader, Stack } from '@/design-system';
import type { NavActions } from '@/lib/types';

/**
 * Voice of the customer — what Sales and Customer Success hear directly.
 *
 * ## Its own area, because it is its own measurement
 *
 * Not the dashboard filtered to a source. A CSM writes a note BECAUSE something needs attention,
 * so this channel is a work queue rather than a sample and is negative-biased by design. Its
 * numbers are never mixed into the Brand Perception Index, and the page says so — a reader who
 * assumes these are comparable to the dashboard's numbers will draw the wrong conclusion from
 * both.
 *
 * ## Ranked by exposure, not volume
 *
 * Every other view ranks by how often something is said. Here that would bury one renewal-risk
 * note from a large account under a subject fifty small accounts mentioned in passing — and would
 * partly rank the note-taking diligence of individual account managers rather than what customers
 * think.
 *
 * ## The corroboration panel is the reason the CRM is worth connecting
 *
 * A complaint appearing independently in public reviews AND in what customers tell their account
 * manager is corroborated by two populations who never spoke to each other. Neither channel can
 * produce that alone, and it is the thing a channel manager can take into a meeting and be
 * believed about.
 */

interface Theme {
  topic: string;
  accounts: number;
  mentions: number;
  exposure: number;
  sentiment: number;
  topBand: string | null;
}

interface VoiceData {
  connected: boolean;
  interactions: number;
  accountsHeard: number;
  themes: Theme[];
  corroborated: {
    topic: string;
    accounts: number;
    publicVolume: number;
    publicSentiment: number;
    reportedSentiment: number;
  }[];
}

const WINDOWS = [30, 90, 180] as const;

export function VoiceOfCustomerView({ nav }: { nav: NavActions }) {
  const { brandId, error: brandError, territory } = useBrand();
  const [days, setDays] = useState<number>(90);

  const { data, loading, error } = useApi<VoiceData>(
    brandId ? withTerritory(`/brands/${brandId}/voice-of-customer?days=${days}`, territory) : null,
  );

  return (
    <>
      <PageHeader
        eyebrow="Voice of the customer"
        title="What clients tell us directly"
        subtitle="Interactions your Sales and Customer Success teams record. Ranked by the accounts affected and what they are worth — not by how often something is said."
      />

      <div className="chg-controls">
        {WINDOWS.map((d) => (
          <button
            key={d}
            type="button"
            className="ds-chip"
            aria-pressed={days === d}
            onClick={() => setDays(d)}
          >
            {d} days
          </button>
        ))}
      </div>

      <ViewState loading={loading} error={error ?? brandError} empty={null}>
        {!data ? null : !data.connected ? (
          <Card>
            <EmptyState
              icon={<Link2 size={22} strokeWidth={1.8} />}
              title="No CRM connected"
              body="This area shows what customers say to your teams in private — the half of the picture public reviews cannot see. Connect HubSpot or Salesforce in Admin to start. Nothing is collected until you do."
            />
          </Card>
        ) : (
          <Stack gap="var(--s-5)">
            <Card>
              <p className="chg-headline">
                {data.interactions.toLocaleString()} interaction
                {data.interactions === 1 ? '' : 's'} recorded across{' '}
                {data.accountsHeard.toLocaleString()} account
                {data.accountsHeard === 1 ? '' : 's'} in the last {days} days.
              </p>
              {/* Said plainly and permanently. A reader who assumes these numbers are comparable
                  to the dashboard's will misread both — this channel is a work queue, and a work
                  queue is negative by construction. */}
              <p className="voc-note">
                <ShieldCheck size={14} strokeWidth={1.9} aria-hidden="true" /> These are kept out of
                the Brand Perception Index. A note gets written because something needs attention,
                so this channel is negative by design — useful on its own terms, misleading if
                averaged into a score built from public sentiment.
              </p>
            </Card>

            {data.corroborated.length > 0 && (
              <Card accent="warn">
                <PanelHeader
                  icon={<Handshake size={20} strokeWidth={1.8} />}
                  title="Raised publicly and privately"
                  subtitle="Two independent groups reporting the same thing — the strongest finding this product can produce"
                />
                <Stack gap="var(--s-1)">
                  {data.corroborated.map((c) => (
                    <button
                      key={c.topic}
                      type="button"
                      className="chg-row"
                      onClick={() => nav.openTopic(c.topic)}
                    >
                      <span className="chg-topic">{c.topic}</span>
                      <span className="chg-meta">
                        {c.accounts} account{c.accounts === 1 ? '' : 's'} · {c.publicVolume} public
                        signal{c.publicVolume === 1 ? '' : 's'}
                      </span>
                      <span className="chg-delta">
                        {c.publicSentiment.toFixed(2)} / {c.reportedSentiment.toFixed(2)}
                      </span>
                    </button>
                  ))}
                </Stack>
                <p className="rm-caveat">
                  Public sentiment first, then what accounts say privately. A wide gap usually means
                  one of the two channels is not hearing the whole story.
                </p>
              </Card>
            )}

            <Card>
              <PanelHeader
                icon={<Handshake size={20} strokeWidth={1.8} />}
                title="By exposure"
                subtitle="Distinct accounts affected, weighted by what they are worth"
              />
              {data.themes.length === 0 ? (
                <p className="chg-empty">
                  Nothing has been recorded against a theme in this window.
                </p>
              ) : (
                <Stack gap="var(--s-1)">
                  {data.themes.slice(0, 12).map((t) => (
                    <button
                      key={t.topic}
                      type="button"
                      className="chg-row"
                      onClick={() => nav.openTopic(t.topic)}
                    >
                      <span className="chg-topic">{t.topic}</span>
                      <span className="chg-meta">
                        {t.accounts} account{t.accounts === 1 ? '' : 's'}
                        {/* Mentions shown, but deliberately not what ranks — ten notes about one
                            customer is one customer. */}
                        {t.mentions !== t.accounts && <> · {t.mentions} mentions</>}
                        {t.topBand && (
                          <>
                            {' '}
                            <Badge tone="warn">{t.topBand}</Badge>
                          </>
                        )}
                      </span>
                      <span className="chg-delta">{t.sentiment.toFixed(2)}</span>
                    </button>
                  ))}
                </Stack>
              )}
            </Card>
          </Stack>
        )}
      </ViewState>
    </>
  );
}
