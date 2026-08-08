**Project Signal**

Product Specification

Confidential · June 2026

| Status            | In development — pre-build specification |
| :---------------- | :--------------------------------------- |
| **Format**        | SaaS · Agency-managed, multi-brand       |
| **Stack**         | Next.js · Node.js · GCP · Vertex AI      |
| **Target launch** | 2026                                     |

# **1\. Overview**

Project Signal is an AI-powered brand intelligence platform that continuously reads customer signals across public sources, scores brand perception across five dimensions, and produces a prioritised action roadmap with supporting evidence. It is built and operated by Wayne Strydom as an agency-managed SaaS product serving multiple client brands from a single platform.

The core proposition is moving brands from reactive reputation monitoring to proactive, evidence-based decision-making. Every finding is traceable back to a source item, timestamp, and model confidence score.

# **2\. Product goals**

- Continuously ingest brand signals across review platforms, social, news, and app stores

- Score brand perception across trust, quality, service, value, and experience dimensions

- Surface the top weaknesses driving the most damage with verbatim evidence

- Produce a prioritised action roadmap with plain-English recommendations

- Generate a weekly branded report per client, delivered by email

- Maintain a full audit trail from every insight back to its source

- Support competitor tracking using the same pipeline and data model

- Scale cheaply across a growing brand portfolio with minimal per-brand marginal cost

# **3\. System architecture**

The system is structured in six layers, all hosted on GCP. The intelligence layer runs on Vertex AI using a two-model strategy to balance cost and quality.

| Layer        | GCP service                            | Responsibility                                                            |
| :----------- | :------------------------------------- | :------------------------------------------------------------------------ |
| Data sources | External (Apify, APIs, RSS)            | Raw signal collection per brand                                           |
| Ingestion    | Cloud Scheduler \+ Cloud Run (Node.js) | Pull scheduling, deduplication, entity resolution, raw store              |
| Queue        | Cloud Pub/Sub                          | Item queue \+ report queue (separate topics)                              |
| Intelligence | Vertex AI (Gemini Flash \+ Pro)        | Sentiment scoring, topic clustering, report generation, anomaly detection |
| Storage      | Firestore \+ Cloud Storage \+ BigQuery | Processed signals, raw audit store, trend analytics                       |
| Presentation | Cloud Run (Node.js API) \+ Next.js     | Dashboard, drill-down, reports, alerts                                    |

### **Two-model strategy**

Gemini Flash is used for all per-item processing: sentiment scoring, topic tagging, and confidence scoring. It runs as a high-volume async worker consuming from the item Pub/Sub topic. Gemini Pro is used only for weekly report generation per brand \- low volume, higher quality narrative output. This keeps per-brand processing costs in the range of £1–3/month at MVP scale.

### **Source adapter pattern**

Each data source is implemented as a swappable adapter behind a common interface. Adapters are independently deployable Cloud Run services. Adding or removing a source requires no changes to the core pipeline. This is critical for the MVP-to-scale roadmap and for managing ToS risk on scraper-based sources.

### **Multi-tenancy**

Brand and competitor data is isolated at the Firestore document level using a tenant ID. Firebase Auth handles user authentication. Cloud IAM service accounts govern inter-service access. A single platform instance serves all agency clients.

# **4\. Data sources**

MVP sources are selected for a combination of signal quality, cost, and access reliability. All sources are implemented as swappable adapters to allow future addition or replacement without pipeline changes.

| Source         | Access method                   | Est. cost/brand/mo | Notes                                                                                                  |
| :------------- | :------------------------------ | :----------------- | :----------------------------------------------------------------------------------------------------- |
| Google reviews | Apify scraper                   | £0.20–0.50         | Anchor source. High signal, low cost. Official Places API 68x more expensive per review.               |
| Trustpilot     | Apify scraper                   | £0.20–0.50         | ToS risk — monitor. Official API is enterprise-only at £5k+/yr. Swap to official when scale justifies. |
| YouTube        | YouTube Data API (free)         | £0                 | Official, free up to 10k units/day. Comments and descriptions are high-signal.                         |
| App stores     | iTunes RSS \+ Play Store (free) | £0                 | Official free feeds. Version-tagged sentiment. MVP inclusion.                                          |
| RSS / news     | Direct fetch                    | £0                 | Free, zero ToS risk. Curated feed list per brand at onboarding.                                        |
| NewsAPI        | NewsAPI.org                     | £30/mo shared      | Flat monthly cost shared across all brands. Business tier.                                             |
| X (Twitter)    | Pay-per-use API                 | £5–20 (light use)  | Tier 2\. $0.005/post read, no monthly minimum. Hard rate limits per brand required.                    |
| Facebook       | Graph API (owned pages)         | £0                 | Own page data only. Broader mention monitoring not available via official API.                         |

Reddit, TikTok Research API, and support ticket integrations (Zendesk, Intercom, Freshdesk) are deferred to later phases. Schema placeholders included in the data model.

# **5\. Intelligence layer**

## **5.1 Sentiment scoring**

Every ingested item is passed to Gemini Flash for sentiment scoring. The model returns a sentiment label (positive, negative, neutral, mixed), a confidence score (0–1), and up to three topic tags drawn from a predefined taxonomy. Results are stored in Firestore alongside the raw item reference.

Recency decay is applied at score aggregation time: items are weighted by an exponential decay function with a 90-day half-life. This ensures recent signals carry more weight than older ones without requiring reprocessing of historical items.

## **5.2 Brand Perception Score**

The Brand Perception Score is a composite of five dimension scores: trust, quality, service, value, and experience. Each dimension is computed as a weighted average of sentiment scores for items tagged to that dimension. Dimension weights are configurable per brand. The composite score is expressed as a 0–100 index.

## **5.3 Topic clustering**

Topic tags from individual items are aggregated into clusters. Clusters with high negative sentiment concentration and high recency are surfaced as Brand impact candidates. The top three clusters by damage score (volume x negative sentiment x recency weight) are presented as the Brand impact report.

## **5.4 Competitor benchmarking**

Competitor brands are tracked using the same pipeline and data model as the primary brand. Competitor entities are configured at onboarding. The Brand Perception Score is computed for all entities in a competitive set, enabling relative benchmarking. Competitor data is stored under a separate tenant-scoped document path.

## **5.5 Anomaly detection and alerts**

A Cloud Tasks job runs on a configurable cadence (default: hourly) per brand. It compares the rolling 24-hour sentiment average against the 30-day baseline. If the delta exceeds a configurable threshold (default: 15 points), an alert is triggered. Alerts are delivered by email and optionally by webhook.

## **5.6 Weekly report generation**

A Cloud Scheduler job fires weekly per brand, targeting the report Pub/Sub topic. The report worker pulls the last 7 days of processed data from Firestore, constructs a structured prompt, and calls Gemini Pro. The model returns structured JSON: key themes, sentiment trend narrative, Brand impact summary, and action recommendations. A PDF renderer converts this to a branded report stored in Cloud Storage. Clients receive a signed URL by email.

# **6\. Storage model**

## **6.1 Firestore**

Firestore is the operational store for processed signals and scores. The top-level collection structure is: /tenants/{tenantId}/brands/{brandId}/signals/{signalId}. Each signal document contains: source, sourceUrl, rawStorageRef, timestamp, sentiment, confidence, dimensions\[\], topics\[\], modelVersion, and brandEntityId.

## **6.2 Cloud Storage**

Cloud Storage holds all raw items and generated reports. Bucket structure: /raw/{tenantId}/{brandId}/{date}/{signalId}.json for raw items, and /reports/{tenantId}/{brandId}/{date}/report.pdf for weekly reports. Raw items are retained for 12 months for audit purposes. Reports are retained indefinitely.

## **6.3 BigQuery**

BigQuery is used for analytical queries: trend analysis, benchmarking across brands, and dimension score history. Firestore changes are streamed to BigQuery via a Dataflow pipeline. This keeps Firestore lean and operational while BigQuery handles the analytical load.

# **7\. Presentation layer**

## **7.1 Dashboard**

The primary view for each brand. Shows: Brand Perception Score with trend sparkline, dimension scores across trust / quality / service / value / experience, top positive and negative topic clusters, recent signal volume, and competitor benchmarking if configured.

## **7.2 Drill-down and audit trail**

Every score, cluster, and finding is linked back to individual signal items. Clicking any data point opens a panel showing the contributing items with: source platform, original text, sentiment score, confidence, timestamp, and a link to the original URL. This is the audit trail required for client trust and commercial defensibility.

## **7.3 Action roadmap**

A ranked list of recommended fixes, each with: a plain-English description, the supporting evidence cluster, the estimated impact on the Brand Perception Score, and placeholder fields for revenue uplift (deferred). Actions are generated by Gemini Pro during the weekly report cycle and are surfaced in the dashboard between reports.

## **7.4 Reports**

Weekly PDF reports are generated per brand and delivered by email via SendGrid. Reports are also accessible from the dashboard with a full history. Report sections: executive summary, Brand Perception Score trend, Brand impact findings with verbatim evidence, action roadmap, and data source coverage summary.

## **7.5 Alerts**

Anomaly alerts are delivered by email (SendGrid) and optionally by webhook to a client-configured URL. Alert content: brand name, trigger metric, delta from baseline, top contributing signals, and a dashboard deep link.

# **8\. Deferred features**

The following are explicitly out of scope for the initial build but are accounted for in the data model and architecture to avoid breaking changes when added.

| Feature                      | Notes                                                                                   |
| :--------------------------- | :-------------------------------------------------------------------------------------- |
| Revenue uplift model         | Requires client revenue data integration. Schema placeholder in action document.        |
| Survey widget                | First-party data collection. Separate frontend component \+ response ingestion adapter. |
| Support ticket integrations  | Zendesk, Intercom, Freshdesk. OAuth connectors, one per platform.                       |
| Lighthouse / technical audit | Separate Cloud Run job. Scores stored as a distinct signal type in Firestore.           |
| Reddit commercial access     | Viable at scale. Free tier non-commercial only. Upgrade when revenue justifies.         |
| TikTok Research API          | Apply for access now. Gated approval takes weeks.                                       |
| Self-serve onboarding        | MVP is agency-managed setup. Self-serve UI is a later product surface.                  |

# **9\. Open questions**

- Revenue uplift model: benchmark-based (industry data) or client-connected (requires revenue data integration)? Affects scoring engine design.

- Onboarding flow: what is the minimum brand configuration required at setup? Keyword list, competitor set, source selection, dimension weights.

- Report branding: agency-branded or Project Signal-branded? Affects PDF template design.

- Alert thresholds: global defaults or per-brand configurable from the dashboard?

- Trustpilot scraper: what is the contingency plan if Apify scraper is blocked? Official API negotiation or alternative source weighting.

Project Signal · Confidential · June 2026 · This document reflects the agreed pre-build specification. Deferred features are excluded from the initial build scope.
