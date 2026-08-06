# AWS Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Project Signal from GCP to AWS `eu-west-2`, without breaking the GCP staging environment that is being stood up for testing in the meantime.

**Architecture:** Cloud-specific behaviour is pushed behind three narrow interfaces in `libs/` (object storage, messaging, LLM) with both a GCP and an AWS implementation selected at runtime by `CLOUD_PROVIDER`. The AWS stack then lands as a parallel Terraform tree (`infra-aws/`) targeting ECS Fargate behind an ALB, RDS Postgres, SQS, EventBridge Scheduler, S3, Secrets Manager, Cognito and Bedrock. GCP stays live and working until the final cutover phase, at which point the GCP implementations are deleted.

**Tech Stack:** TypeScript 5.5 (ESM), Fastify 5, Next.js 16, Drizzle + postgres-js, Terraform ~> 1.9, AWS provider ~> 5, `@aws-sdk/client-*` v3, ECS Fargate, Cognito, Bedrock Runtime.

## Global Constraints

- **Region is `eu-west-2` (London).** Data residency is a hard requirement — no cross-region inference, no cross-region replication.
- **Nothing in this plan may break the GCP environment** until Phase 7. Every phase before it must leave `CLOUD_PROVIDER=gcp` fully working.
- **Tenant scoping is manual.** There is no Postgres RLS; every query filters on `tenant_id`. This does not change on AWS.
- **ESLint bans `any` and enforces `import type`.** `console.log` warns — use `warn`/`error`.
- **`commitlint` enforces a closed scope list** in `commitlint.config.js`. Task 1 adds the new scopes; do not skip it.
- **80% coverage gate per project** — `yarn test` enforces it. New libs need tests from their first commit.
- **No credentials in Terraform state.** Secrets are created out-of-band and referenced by ARN, exactly as the GCP stack does today.
- **Lib dependency order is hard-coded** in `scripts/build-libs.sh`: `config → shared-types → db → gemini → messaging → source-adapters`. Any new lib must be inserted there.

## Phase map

| Phase | Outcome                                                           | Runs on             |
| ----- | ----------------------------------------------------------------- | ------------------- |
| 1     | Cloud-specific code sits behind interfaces; gaps #4 and #7 closed | GCP                 |
| 2     | AWS account foundation: OIDC, VPC, RDS, ECR, Secrets, S3          | AWS (empty)         |
| 3     | AWS adapters implemented and unit-tested                          | Neither — code only |
| 4     | api + web running on ECS Fargate behind an ALB                    | AWS                 |
| 5     | Workers on SQS, cron on EventBridge Scheduler                     | AWS                 |
| 6     | Cognito replaces Identity Platform                                | AWS                 |
| 7     | Cutover, GCP decommission                                         | AWS                 |

Phases 1–3 can proceed while the GCP environment is still being built. Phase 4 is the first that needs a real AWS account.

---

## File Structure

**New libraries** (each one file per responsibility, mirroring the existing `libs/*` layout):

- `libs/storage/src/types.ts` — `ObjectStore` interface
- `libs/storage/src/gcs.ts` — GCS implementation
- `libs/storage/src/s3.ts` — S3 implementation
- `libs/storage/src/index.ts` — `getObjectStore()` factory switching on `CLOUD_PROVIDER`
- `libs/llm/src/types.ts` — `LlmClient` interface
- `libs/llm/src/vertex.ts` — Vertex AI implementation (moved from `libs/gemini`)
- `libs/llm/src/bedrock.ts` — Bedrock implementation
- `libs/llm/src/index.ts` — `getLlmClient()` factory

**Modified:**

- `libs/messaging/src/index.ts` — split into `types.ts` / `pubsub.ts` / `sqs.ts` / `index.ts`
- `libs/config/src/index.ts` — new env vars
- `apps/ingestion/src/handler.ts` — write raw payloads through `ObjectStore` (gap #4)
- `apps/sentiment-worker/src/handler.ts` — read raw text through `ObjectStore` (gap #4)
- `apps/sentiment-worker/src/main.ts` — SQS consumer mode alongside the HTTP push route
- `apps/api/src/plugins/auth.ts` — pluggable token verifier
- `apps/web/src/lib/auth-provider.ts` (new) — abstracts Firebase vs Cognito
- `commitlint.config.js` — new scopes
- `scripts/build-libs.sh` — new libs in dependency order

**New Terraform tree** — `infra-aws/`, structured identically to `infra/` (`bootstrap/`, `modules/`, `stack/`, `envs/`) so the two are comparable during transition.

---

## Phase 1 — Portability refactor (runs on GCP)

This phase closes two of the four pipeline gaps as a side effect. That is deliberate: gap #4 (raw payloads never stored) has to be implemented somewhere, and implementing it behind an interface means implementing it once rather than once per cloud.

### Task 1: Add build scaffolding for the new libs

**Files:**

- Modify: `commitlint.config.js`
- Modify: `scripts/build-libs.sh`
- Create: `libs/storage/package.json`, `libs/storage/tsconfig.json`, `libs/storage/tsconfig.build.json`, `libs/storage/vitest.config.ts`
- Create: `libs/llm/package.json`, `libs/llm/tsconfig.json`, `libs/llm/tsconfig.build.json`, `libs/llm/vitest.config.ts`

**Interfaces:**

- Consumes: nothing
- Produces: workspace packages `@project-signal/storage` and `@project-signal/llm`, buildable by `nx run-many -t build`

- [ ] **Step 1: Add the new commit scopes**

In `commitlint.config.js`, extend the `scope-enum` array with `"storage"` and `"llm"`. Without this every commit in Phases 1 and 3 is rejected by the `commit-msg` hook.

```js
"scope-enum": [
  2,
  "always",
  [
    "web", "api", "ingestion", "sentiment-worker", "report-worker",
    "shared-types", "db", "config", "gemini", "llm", "messaging",
    "storage", "source-adapters", "infra", "ci", "deps",
  ],
],
```

- [ ] **Step 2: Copy the package scaffolding from an existing lib**

`libs/gemini` is the closest template — it has runtime deps and tests. Copy its four config files into `libs/storage` and `libs/llm`, changing only the package `name` field to `@project-signal/storage` / `@project-signal/llm`.

- [ ] **Step 3: Insert both libs into the build order**

In `scripts/build-libs.sh`, the order must place `storage` after `config` (it reads env) and `llm` after `config`. Both must precede `source-adapters`:

```
config → shared-types → db → storage → llm → messaging → source-adapters
```

- [ ] **Step 4: Verify the workspace resolves**

Run: `yarn install && yarn nx run-many -t build`
Expected: PASS — both new (empty) libs build.

- [ ] **Step 5: Commit**

```bash
git add commitlint.config.js scripts/build-libs.sh libs/storage libs/llm
git commit -m "chore(deps): scaffold storage and llm workspace packages"
```

### Task 2: Define and implement the `ObjectStore` interface (GCS)

**Files:**

- Create: `libs/storage/src/types.ts`, `libs/storage/src/gcs.ts`, `libs/storage/src/index.ts`
- Test: `libs/storage/test/gcs.test.ts`

**Interfaces:**

- Consumes: `getEnv()` from `@project-signal/config`
- Produces: `interface ObjectStore { put(key: string, body: string, contentType?: string): Promise<string>; get(key: string): Promise<string>; }` and `getObjectStore(): ObjectStore`. `put` returns the canonical reference string stored in `signals.raw_storage_ref`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockSave = vi.fn();
const mockDownload = vi.fn();
vi.mock('@google-cloud/storage', () => ({
  Storage: vi.fn(() => ({
    bucket: () => ({ file: () => ({ save: mockSave, download: mockDownload }) }),
  })),
}));

describe('GcsObjectStore', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSave.mockReset();
    mockDownload.mockReset();
    process.env['GOOGLE_CLOUD_PROJECT'] = 'test-project';
    process.env['DATABASE_URL'] = 'postgresql://u:p@localhost:5432/d';
    process.env['RAW_BUCKET'] = 'test-raw';
  });

  it('returns a gs:// reference from put()', async () => {
    const { GcsObjectStore } = await import('../src/gcs.js');
    const store = new GcsObjectStore('test-raw');
    const ref = await store.put('t1/b1/rss/ext-1.json', '{"text":"hello"}');
    expect(ref).toBe('gs://test-raw/t1/b1/rss/ext-1.json');
    expect(mockSave).toHaveBeenCalledOnce();
  });

  it('round-trips content through get()', async () => {
    mockDownload.mockResolvedValue([Buffer.from('{"text":"hello"}')]);
    const { GcsObjectStore } = await import('../src/gcs.js');
    const store = new GcsObjectStore('test-raw');
    await expect(store.get('t1/b1/rss/ext-1.json')).resolves.toBe('{"text":"hello"}');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/storage && yarn vitest run`
Expected: FAIL — cannot resolve `../src/gcs.js`.

- [ ] **Step 3: Add the dependency and write the implementation**

Run `yarn workspace @project-signal/storage add @google-cloud/storage`, then:

```ts
// libs/storage/src/types.ts
export interface ObjectStore {
  /** Stores `body` at `key` and returns the canonical reference to persist. */
  put(key: string, body: string, contentType?: string): Promise<string>;
  /** Fetches the object previously stored at `key`. */
  get(key: string): Promise<string>;
}

/** Builds the deterministic object key for a raw ingested item. */
export function rawKey(
  tenantId: string,
  brandId: string,
  source: string,
  externalId: string,
): string {
  return `${tenantId}/${brandId}/${source}/${encodeURIComponent(externalId)}.json`;
}
```

```ts
// libs/storage/src/gcs.ts
import { Storage } from '@google-cloud/storage';
import type { ObjectStore } from './types.js';

export class GcsObjectStore implements ObjectStore {
  private readonly storage = new Storage();

  constructor(private readonly bucket: string) {}

  async put(key: string, body: string, contentType = 'application/json'): Promise<string> {
    await this.storage.bucket(this.bucket).file(key).save(body, { contentType });
    return `gs://${this.bucket}/${key}`;
  }

  async get(key: string): Promise<string> {
    const [buf] = await this.storage.bucket(this.bucket).file(key).download();
    return buf.toString('utf8');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd libs/storage && yarn vitest run`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/storage
git commit -m "feat(storage): add ObjectStore interface with GCS implementation"
```

### Task 3: Add the `RAW_BUCKET` config and the `getObjectStore()` factory

**Files:**

- Modify: `libs/config/src/index.ts`
- Create: `libs/storage/src/index.ts`
- Test: `libs/storage/test/index.test.ts`, `libs/config/test/index.test.ts`

**Interfaces:**

- Consumes: `GcsObjectStore` from Task 2
- Produces: `getObjectStore(): ObjectStore`, memoised. Throws a named error when `RAW_BUCKET` is unset.

- [ ] **Step 1: Write the failing test**

```ts
it('throws a named error when RAW_BUCKET is unset', async () => {
  delete process.env['RAW_BUCKET'];
  const { getObjectStore } = await import('../src/index.js');
  expect(() => getObjectStore()).toThrow(/RAW_BUCKET/);
});

it('returns a GCS store when CLOUD_PROVIDER is gcp', async () => {
  process.env['RAW_BUCKET'] = 'test-raw';
  process.env['CLOUD_PROVIDER'] = 'gcp';
  const { getObjectStore } = await import('../src/index.js');
  const { GcsObjectStore } = await import('../src/gcs.js');
  expect(getObjectStore()).toBeInstanceOf(GcsObjectStore);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/storage && yarn vitest run test/index.test.ts`
Expected: FAIL — `getObjectStore` is not exported.

- [ ] **Step 3: Add config keys and write the factory**

In `libs/config/src/index.ts` add to the schema:

```ts
CLOUD_PROVIDER: z.enum(['gcp', 'aws']).default('gcp'),
RAW_BUCKET: z.string().optional(),
REPORTS_BUCKET: z.string().optional(),
```

```ts
// libs/storage/src/index.ts
import { getEnv } from '@project-signal/config';
import { GcsObjectStore } from './gcs.js';
import type { ObjectStore } from './types.js';

export type { ObjectStore } from './types.js';
export { rawKey } from './types.js';

let _store: ObjectStore | undefined;

export function getObjectStore(): ObjectStore {
  if (!_store) {
    const env = getEnv();
    if (!env.RAW_BUCKET) {
      throw new Error('RAW_BUCKET must be set to use the object store.');
    }
    _store = new GcsObjectStore(env.RAW_BUCKET);
  }
  return _store;
}
```

The `aws` branch is added in Phase 3 — leaving it out now keeps this task independently reviewable and avoids a dependency on an unwritten S3 client.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn nx run-many -t test --projects=@project-signal/storage,@project-signal/config`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/storage libs/config
git commit -m "feat(storage): add getObjectStore factory and CLOUD_PROVIDER config"
```

### Task 4: Write raw payloads on ingest — closes gap #4 (write side)

**Files:**

- Modify: `apps/ingestion/src/handler.ts`
- Modify: `apps/ingestion/package.json` (add `@project-signal/storage`)
- Test: `apps/ingestion/test/handler.test.ts`

**Interfaces:**

- Consumes: `getObjectStore()`, `rawKey()` from `@project-signal/storage`
- Produces: `signals.raw_storage_ref` now holds a real storage reference (`gs://…` or `s3://…`) instead of `item.url`

- [ ] **Step 1: Write the failing test**

```ts
it('stores the raw item and persists the returned reference', async () => {
  const put = vi.fn().mockResolvedValue('gs://test-raw/t1/b1/rss/ext-1.json');
  vi.doMock('@project-signal/storage', () => ({
    getObjectStore: () => ({ put, get: vi.fn() }),
    rawKey: (t: string, b: string, s: string, e: string) => `${t}/${b}/${s}/${e}.json`,
  }));

  const { ingestSource } = await import('../src/handler.js');
  await ingestSource(sourceConfigFixture);

  expect(put).toHaveBeenCalledWith('t1/b1/rss/ext-1.json', expect.stringContaining('"text"'));
  expect(insertedRows[0].rawStorageRef).toBe('gs://test-raw/t1/b1/rss/ext-1.json');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/ingestion && yarn vitest run`
Expected: FAIL — `rawStorageRef` is still `item.url`.

- [ ] **Step 3: Write the implementation**

In the per-item loop of `handler.ts`, before the DB insert:

```ts
const key = rawKey(config.tenantId, config.brandEntityId, config.sourceType, item.externalId);
const rawStorageRef = await store.put(
  key,
  JSON.stringify({
    externalId: item.externalId,
    url: item.url,
    text: item.text,
    author: item.author,
    publishedAt: item.publishedAt,
    fetchedAt: new Date().toISOString(),
  }),
);
```

Then pass `rawStorageRef` into the insert in place of `item.url`. The `RawItem.text` that was previously discarded is now the payload.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/ingestion && yarn vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ingestion
git commit -m "feat(ingestion): persist raw payloads to object storage"
```

### Task 5: Score the stored text — closes gap #4 (read side)

**Files:**

- Modify: `apps/sentiment-worker/src/handler.ts`
- Modify: `apps/sentiment-worker/package.json`
- Test: `apps/sentiment-worker/test/handler.test.ts`

**Interfaces:**

- Consumes: `getObjectStore()` from `@project-signal/storage`
- Produces: nothing new — this removes the `[placeholder]` warning and scores real text

- [ ] **Step 1: Write the failing test**

```ts
it('scores the stored raw text, not the source URL', async () => {
  const get = vi.fn().mockResolvedValue(JSON.stringify({ text: 'The app keeps crashing.' }));
  vi.doMock('@project-signal/storage', () => ({ getObjectStore: () => ({ get, put: vi.fn() }) }));

  await handlePubSubMessage(messageFor('signal-1'));

  expect(get).toHaveBeenCalledWith('t1/b1/rss/ext-1.json');
  expect(scoreText).toHaveBeenCalledWith('The app keeps crashing.', expect.anything());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/sentiment-worker && yarn vitest run`
Expected: FAIL — `scoreText` still receives `signal.sourceUrl`.

- [ ] **Step 3: Write the implementation**

Replace the placeholder block:

```ts
// Was: console.warn('[placeholder] Using source_url as scoring text…');
//      const text = signal.sourceUrl;
const key = keyFromRef(signal.rawStorageRef);
const raw = JSON.parse(await store.get(key)) as { text: string };
const text = raw.text;
```

Add a small exported helper so both clouds' reference formats parse:

```ts
/** Strips the `gs://bucket/` or `s3://bucket/` prefix, leaving the object key. */
export function keyFromRef(ref: string): string {
  const m = /^(?:gs|s3):\/\/[^/]+\/(.+)$/.exec(ref);
  if (!m?.[1]) throw new Error(`Unrecognised raw_storage_ref: ${ref}`);
  return m[1];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/sentiment-worker && yarn vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/sentiment-worker
git commit -m "fix(sentiment-worker): score stored raw text instead of the source URL"
```

### Task 6: Split messaging behind an interface and read topic names from env — closes gap #7

**Files:**

- Create: `libs/messaging/src/types.ts`, `libs/messaging/src/pubsub.ts`
- Modify: `libs/messaging/src/index.ts`
- Test: `libs/messaging/test/index.test.ts`

**Interfaces:**

- Consumes: `getEnv()`
- Produces: `interface MessagePublisher { publish(topic: string, payload: object): Promise<string>; }`, `getPublisher(): MessagePublisher`, and `topicName(logical: 'item' | 'report'): string` which resolves `ITEM_TOPIC` / `REPORT_TOPIC` from env with the existing `TOPICS` constants as local-dev defaults.

This is gap #7: Terraform already injects `ITEM_TOPIC`, but nothing reads it — ingestion publishes to the hardcoded `TOPICS.ITEM_QUEUE`, which does not exist in a deployed environment.

- [ ] **Step 1: Write the failing test**

```ts
it('prefers ITEM_TOPIC from env over the local default', async () => {
  process.env['ITEM_TOPIC'] = 'staging-item';
  const { topicName } = await import('../src/index.js');
  expect(topicName('item')).toBe('staging-item');
});

it('falls back to the local-dev constant when unset', async () => {
  delete process.env['ITEM_TOPIC'];
  const { topicName } = await import('../src/index.js');
  expect(topicName('item')).toBe('project-signal-item-queue');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/messaging && yarn vitest run`
Expected: FAIL — `topicName` is not exported.

- [ ] **Step 3: Write the implementation**

Add `ITEM_TOPIC` and `REPORT_TOPIC` as optional strings to the config schema, move the existing Pub/Sub client into `pubsub.ts` behind the `MessagePublisher` interface, and export `topicName` from `index.ts`. Update `apps/ingestion` to call `publish(topicName('item'), …)` instead of `TOPICS.ITEM_QUEUE`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn nx run-many -t test --projects=@project-signal/messaging,ingestion`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/messaging libs/config apps/ingestion
git commit -m "fix(messaging): resolve topic names from environment"
```

### Task 7: Move the Vertex client into `libs/llm` behind an interface

**Files:**

- Create: `libs/llm/src/types.ts`, `libs/llm/src/vertex.ts`, `libs/llm/src/index.ts`
- Delete: `libs/gemini/` (after all importers are updated)
- Modify: `apps/sentiment-worker/src/scorer.ts`, `apps/report-worker/src/main.ts`
- Test: `libs/llm/test/vertex.test.ts`

**Interfaces:**

- Consumes: `getEnv()`
- Produces: `interface LlmClient { complete(prompt: string, opts: { model: string; maxTokens: number }): Promise<string>; }` and `getLlmClient(): LlmClient`, `getScorerModel()`, `getReporterModel()` (the latter two keep their existing names and signatures so `scorer.ts` changes only its import path).

- [ ] **Step 1: Write the failing test**

Port `libs/gemini/test/index.test.ts` to `libs/llm/test/vertex.test.ts`, changing the import path and asserting `complete()` returns the model's text rather than the raw Vertex response object.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/llm && yarn vitest run`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`vertex.ts` wraps the existing `@google-cloud/vertexai` code from `libs/gemini/src/index.ts` and exposes it as `complete()`. `index.ts` is the factory; the `aws` branch is added in Phase 3. Update the two importers, then delete `libs/gemini` and remove it from `scripts/build-libs.sh`.

- [ ] **Step 4: Run the full suite**

Run: `yarn test`
Expected: PASS — no references to `@project-signal/gemini` remain.

- [ ] **Step 5: Commit**

```bash
git add libs/llm apps/sentiment-worker apps/report-worker scripts/build-libs.sh
git rm -r libs/gemini
git commit -m "refactor(llm): replace libs/gemini with a provider-agnostic LlmClient"
```

**Phase 1 exit criteria:** `yarn test` and `yarn typecheck` pass; GCP staging still deploys and runs; gaps #4 and #7 are closed. Update `docs/KNOWN-GAPS.md` to mark them resolved in the same commit as the code, per the house rule.

---

## Phase 2 — AWS foundation (Terraform)

Mirrors `infra/` exactly so the two trees are comparable. Nothing here touches application code.

### Task 8: `infra-aws/bootstrap` — OIDC, state backend, ECR

**Files:**

- Create: `infra-aws/bootstrap/{main,variables,outputs,versions}.tf`, `infra-aws/bootstrap/bootstrap.tfvars.example`
- Create: `infra-aws/README.md`

**Interfaces:**

- Produces: outputs `state_bucket_name`, `state_lock_table`, `ci_role_arn`, `ecr_registry_url` — these become the `AWS_ROLE_ARN`, `TF_STATE_BUCKET` GitHub environment secrets

- [ ] **Step 1: Write the bootstrap configuration**

Resources: `aws_s3_bucket` for state (versioned, `prevent_destroy`, SSE-KMS), `aws_dynamodb_table` for state locking, `aws_iam_openid_connect_provider` for `token.actions.githubusercontent.com`, and `aws_iam_role` with a trust policy conditioned on `token.actions.githubusercontent.com:sub` matching `repo:LokimotiveUK/project-signal:*`.

This is the direct analogue of the GCP Workload Identity Federation setup, and the same warning applies: the trust policy pins to one repository, so a rename breaks CI auth with an unhelpful error.

```hcl
data "aws_iam_policy_document" "ci_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:*"]
    }
  }
}
```

- [ ] **Step 2: Validate**

Run: `terraform -chdir=infra-aws/bootstrap init -backend=false && terraform -chdir=infra-aws/bootstrap validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Apply against the real account**

Run: `terraform -chdir=infra-aws/bootstrap apply -var-file=bootstrap.tfvars`
Expected: creates the state bucket, lock table, OIDC provider and CI role. Record the outputs.

- [ ] **Step 4: Commit**

```bash
git add infra-aws/bootstrap infra-aws/README.md
git commit -m "feat(infra): add AWS bootstrap — OIDC, state backend, ECR"
```

### Task 9: Network and data modules — VPC, RDS, S3, Secrets

**Files:**

- Create: `infra-aws/modules/vpc/`, `infra-aws/modules/rds/`, `infra-aws/modules/storage/`, `infra-aws/modules/secrets/`

**Interfaces:**

- Produces: `vpc_id`, `private_subnet_ids`, `public_subnet_ids`, `db_endpoint`, `db_secret_arn`, `raw_bucket`, `reports_bucket`

- [ ] **Step 1: Write the VPC module**

Two AZs, public subnets for the ALB, private subnets for Fargate tasks and RDS. **Use VPC endpoints for S3, ECR, Secrets Manager, SQS and Bedrock rather than a NAT gateway** — a NAT gateway is ~$32/month per AZ and would dominate the bill for a system this size. Interface endpoints are ~$7/month each but only where actually needed.

- [ ] **Step 2: Write the RDS module**

`aws_db_instance`, Postgres 16, `db.t4g.micro`, single-AZ for staging, storage encrypted, `deletion_protection` driven by a variable, credentials generated by `random_password` and written to Secrets Manager — matching the GCP module's shape exactly. Not publicly accessible; reachable only from the Fargate security group.

- [ ] **Step 3: Write the storage and secrets modules**

Two S3 buckets (`raw`, `reports`) with public access blocked, SSE, versioning off, and a 30-day transition to Infrequent Access on `raw` — the analogue of the NEARLINE lifecycle rule. The secrets module creates the _containers_ for `youtube-api-key` and `apify-api-key` only; values are added out-of-band with `aws secretsmanager put-secret-value`, never in state.

- [ ] **Step 4: Validate and commit**

Run: `terraform -chdir=infra-aws/stack init -backend=false && terraform -chdir=infra-aws/stack validate`

```bash
git add infra-aws/modules
git commit -m "feat(infra): add AWS vpc, rds, storage and secrets modules"
```

---

## Phase 3 — AWS adapters (code only, no deployment)

### Task 10: `S3ObjectStore`

**Files:**

- Create: `libs/storage/src/s3.ts`
- Modify: `libs/storage/src/index.ts`
- Test: `libs/storage/test/s3.test.ts`

**Interfaces:**

- Consumes: `ObjectStore` from Task 2
- Produces: `S3ObjectStore` implementing the same interface, returning `s3://bucket/key` from `put()`

- [ ] **Step 1: Write the failing test**

Mirror `test/gcs.test.ts` exactly, mocking `@aws-sdk/client-s3`'s `S3Client.send`, and assert `put()` returns `s3://test-raw/t1/b1/rss/ext-1.json`. Testing both implementations against the same assertions is what makes the interface trustworthy.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/storage && yarn vitest run test/s3.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { ObjectStore } from './types.js';

export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    region: string,
  ) {
    this.client = new S3Client({ region });
  }

  async put(key: string, body: string, contentType = 'application/json'): Promise<string> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
    return `s3://${this.bucket}/${key}`;
  }

  async get(key: string): Promise<string> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return await res.Body!.transformToString('utf8');
  }
}
```

Then add the `aws` branch to `getObjectStore()`.

- [ ] **Step 4: Run tests and commit**

Run: `cd libs/storage && yarn vitest run`

```bash
git add libs/storage
git commit -m "feat(storage): add S3 implementation of ObjectStore"
```

### Task 11: SQS publisher and consumer

**Files:**

- Create: `libs/messaging/src/sqs.ts`
- Modify: `libs/messaging/src/index.ts`
- Test: `libs/messaging/test/sqs.test.ts`

**Interfaces:**

- Consumes: `MessagePublisher` from Task 6
- Produces: `SqsPublisher implements MessagePublisher`, plus `consume(queueUrl: string, handler: (body: unknown) => Promise<void>): Promise<never>` — a long-polling loop that deletes on success and lets the message return to the queue on throw.

**This is the one place the messaging model genuinely differs.** Pub/Sub pushes to an HTTP endpoint; SQS is pulled. The consumer loop below is what replaces the push route. Redrive to a DLQ is configured on the queue in Terraform, not in code — which finally makes gap #9's DLQ real, provided the handler rethrows on transient failures.

- [ ] **Step 1: Write the failing test**

```ts
it('deletes the message after the handler resolves', async () => {
  send.mockResolvedValueOnce({ Messages: [{ Body: '{"signalId":"s1"}', ReceiptHandle: 'r1' }] });
  const handler = vi.fn().mockResolvedValue(undefined);
  await consumeOnce('https://sqs/q', handler);
  expect(handler).toHaveBeenCalledWith({ signalId: 's1' });
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({ input: { QueueUrl: 'https://sqs/q', ReceiptHandle: 'r1' } }),
  );
});

it('does not delete the message when the handler throws', async () => {
  send.mockResolvedValueOnce({ Messages: [{ Body: '{"signalId":"s1"}', ReceiptHandle: 'r1' }] });
  await consumeOnce('https://sqs/q', vi.fn().mockRejectedValue(new Error('transient')));
  expect(send).toHaveBeenCalledTimes(1); // receive only, no delete
});
```

Export `consumeOnce` (one receive/handle/delete cycle) and build `consume` as a loop over it — a `while (true)` loop is untestable, a single cycle is not.

- [ ] **Step 2–4: Implement, test, commit**

```bash
git add libs/messaging
git commit -m "feat(messaging): add SQS publisher and long-polling consumer"
```

### Task 12: Bedrock LLM client

**Files:**

- Create: `libs/llm/src/bedrock.ts`
- Modify: `libs/llm/src/index.ts`, `libs/config/src/index.ts`
- Test: `libs/llm/test/bedrock.test.ts`

**Interfaces:**

- Consumes: `LlmClient` from Task 7
- Produces: `BedrockLlmClient implements LlmClient`

- [ ] **Step 1: Confirm the model is available in-region — do not skip this**

Run: `aws bedrock list-foundation-models --region eu-west-2 --query 'modelSummaries[?contains(modelId,`anthropic`)].modelId'`

eu-west-2 hosts models from Anthropic among others, with both On Demand and EU cross-region inference deployment types — but **in-region availability is narrower than cross-region**, and London data residency rules cross-region inference out. Pick a model that appears in this command's output, and record the chosen ID in `docs/SETUP.md`. This is the same failure mode that retired the Gemini 2.0 defaults: a model ID that was valid when written and is not valid when run.

Claude Haiku 4.5 is the natural analogue of Gemini Flash for high-volume per-item scoring; confirm before committing to it.

- [ ] **Step 2: Write the failing test**

Mock `@aws-sdk/client-bedrock-runtime`'s `InvokeModelCommand`, assert `complete()` returns the extracted text and that `maxTokens` is passed through.

- [ ] **Step 3: Implement, adding `BEDROCK_MODEL_ID` and `AWS_REGION` to the config schema**

`SCORER_MODEL` / `REPORTER_MODEL` keep their use-case names; the factory maps them onto the provider's model IDs, so nothing downstream of `getScorerModel()` changes.

- [ ] **Step 4: Re-validate the scoring prompt against the new model**

Run the sentiment-worker suite plus a manual spot-check over ~20 real signals. Different model families disagree on borderline sentiment, and the scorer's JSON output contract is model-sensitive. Budget real time here — this is the least mechanical task in the plan.

- [ ] **Step 5: Commit**

```bash
git add libs/llm libs/config
git commit -m "feat(llm): add Bedrock implementation of LlmClient"
```

---

## Phase 4 — Compute: ECS Fargate

### Task 13: ECS cluster, ALB, and a reusable service module

**Files:**

- Create: `infra-aws/modules/ecs_cluster/`, `infra-aws/modules/alb/`, `infra-aws/modules/ecs_service/`

**Interfaces:**

- Produces: `ecs_service` module taking `name`, `image`, `cpu`, `memory`, `env`, `secret_env`, `desired_count`, `target_group_arn` (optional) — the direct analogue of the existing `cloud_run` module, so `stack/main.tf` reads almost identically

- [ ] **Step 1: Write the modules**

One ALB with host- or path-based routing to `api` and `web` target groups. Workers get no target group — they are not HTTP services on AWS, they poll SQS, which means they need no ingress at all. That is a genuine simplification over the Cloud Run push model.

Task role vs execution role matters: the **execution** role pulls from ECR and reads secrets at task start; the **task** role is what application code uses at runtime. Grant `s3:GetObject`/`PutObject` on the raw bucket, `sqs:*` on the specific queues, and `bedrock:InvokeModel` on the task role — one role per service, least-privilege, mirroring the GCP `service_accounts` module.

- [ ] **Step 2: Validate and commit**

```bash
git add infra-aws/modules
git commit -m "feat(infra): add ECS cluster, ALB and reusable service modules"
```

### Task 14: Compose the stack and deploy api + web

**Files:**

- Create: `infra-aws/stack/{main,variables,outputs,versions,backend}.tf`, `infra-aws/envs/staging.tfvars`

- [ ] **Step 1: Compose the modules**

Mirror `infra/stack/main.tf` section for section. `image_tag` stays a required variable with no default — the same reasoning applies, and for the same reason there is no `ignore_changes` on the image.

- [ ] **Step 2: Build and push images to ECR, then apply**

- [ ] **Step 3: Smoke test**

Run: `curl https://<alb-dns>/health`
Expected: 200 from the API. The API applies migrations on startup under an advisory lock — confirm in CloudWatch logs that migrations ran exactly once even with two tasks starting simultaneously. This is the highest-risk behaviour change in the whole migration: Cloud Run and Fargate differ in startup concurrency, and the advisory lock is the only thing preventing concurrent migration.

- [ ] **Step 4: Commit**

```bash
git add infra-aws/stack infra-aws/envs
git commit -m "feat(infra): compose AWS stack and deploy api and web"
```

---

## Phase 5 — Workers and scheduling

### Task 15: SQS queues, DLQs, and EventBridge Scheduler

**Files:**

- Create: `infra-aws/modules/sqs/`, `infra-aws/modules/scheduler/`

- [ ] **Step 1: Write the SQS module**

`item` and `report` queues, each with a redrive policy to a DLQ at `maxReceiveCount = 5` — matching the Pub/Sub `max_delivery_attempts`. Set `visibility_timeout_seconds` to at least 6× the p99 handler duration, or messages will be redelivered while still being processed.

- [ ] **Step 2: Write the scheduler module**

Three EventBridge Scheduler schedules replacing the three Cloud Scheduler jobs: ingestion `cron(0 6 ? * MON *)`, report `cron(0 7 ? * MON *)`, sweep `rate(1 hour)`, all in `Etc/UTC`. The ingestion and sweep schedules target the API over the ALB with a bearer credential; the report schedule targets the SQS queue directly.

- [ ] **Step 3: Commit**

```bash
git add infra-aws/modules/sqs infra-aws/modules/scheduler
git commit -m "feat(infra): add SQS queues with DLQs and EventBridge schedules"
```

### Task 16: Switch the workers to consumer mode and make failures visible — closes gap #9

**Files:**

- Modify: `apps/sentiment-worker/src/main.ts`
- Modify: `apps/sentiment-worker/src/handler.ts`
- Test: `apps/sentiment-worker/test/main.test.ts`

**Interfaces:**

- Consumes: `consume()` from Task 11

- [ ] **Step 1: Write the failing test**

```ts
it('rethrows transient failures so the message returns to the queue', async () => {
  scoreText.mockRejectedValue(Object.assign(new Error('throttled'), { $retryable: true }));
  await expect(handleItemMessage({ signalId: 's1' })).rejects.toThrow('throttled');
});

it('swallows permanent failures so the message is not retried forever', async () => {
  scoreText.mockRejectedValue(new SyntaxError('model returned malformed JSON'));
  await expect(handleItemMessage({ signalId: 's1' })).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — the current handler catches everything and returns normally, which is exactly gap #9.

- [ ] **Step 3: Implement the distinction**

Permanent (malformed model output, missing signal row) → log and return, message is deleted. Transient (network, throttling, 5xx) → rethrow, message returns to the queue and eventually dead-letters. `main.ts` keeps `/health` and `/ready` for the ALB health check but starts the `consume()` loop instead of serving a push route.

- [ ] **Step 4: Verify the DLQ actually fills**

Deploy, then publish a message referencing a nonexistent signal and one that forces a transient error. Confirm in the console that the transient one lands in the DLQ after 5 attempts and the permanent one does not. Gap #9 has never been observably true — verify it rather than assuming.

- [ ] **Step 5: Commit**

```bash
git add apps/sentiment-worker
git commit -m "feat(sentiment-worker): consume from SQS and surface transient failures"
```

### Task 17: Implement `POST /reconcile` — closes gap #2

**Files:**

- Modify: `apps/ingestion/src/main.ts`
- Test: `apps/ingestion/test/main.test.ts`

- [ ] **Step 1: Write the failing test**

Assert that signals with no matching `sentiment_results` row are re-published to the item queue and that already-scored signals are not.

- [ ] **Step 2–4: Implement, test, commit**

```bash
git add apps/ingestion
git commit -m "feat(ingestion): add /reconcile sweep endpoint"
```

---

## Phase 6 — Cognito

The deepest application change in the plan. Authorisation currently reads Firebase custom claims (`role`, `tenantId`, `brandEntityId`) — not the `users` table — so this touches every layer.

### Task 18: Cognito user pool and pre-token-generation Lambda

**Files:**

- Create: `infra-aws/modules/cognito/`, `infra-aws/modules/cognito/lambda/pre-token-generation.mjs`

**Interfaces:**

- Produces: `user_pool_id`, `user_pool_client_id`, `issuer_url`

- [ ] **Step 1: Write the user pool**

Email sign-in, no self-registration (users are provisioned by admins, as today). The claims the API depends on are injected by a **pre token generation** Lambda trigger, which reads the user's attributes and writes `role`, `tenantId` and `brandEntityId` into the ID token.

Version note: **V1_0 is sufficient here** because the app reads claims from the **ID token** (`getIdTokenResult()` today, `idToken` under Cognito). V2*0 — which is what you need to customise \_access* token claims — requires the Essentials or Plus feature plan and therefore costs more. Do not reach for V2_0 unless you move authorisation to the access token.

```js
// pre-token-generation.mjs
export const handler = async (event) => {
  const attrs = event.request.userAttributes;
  event.response = {
    claimsOverrideDetails: {
      claimsToAddOrOverride: {
        role: attrs['custom:role'] ?? 'user',
        tenantId: attrs['custom:tenantId'] ?? '',
        brandEntityId: attrs['custom:brandEntityId'] ?? '',
      },
    },
  };
  return event;
};
```

- [ ] **Step 2: Commit**

```bash
git add infra-aws/modules/cognito
git commit -m "feat(infra): add Cognito user pool with claim injection"
```

### Task 19: Pluggable token verification in the API

**Files:**

- Modify: `apps/api/src/plugins/auth.ts`
- Test: `apps/api/test/plugins/auth.test.ts`

**Interfaces:**

- Produces: `verifyToken(token: string): Promise<{ uid: string; role: Role; tenantId: string; brandEntityId?: string }>` — one implementation per provider, selected by `CLOUD_PROVIDER`

- [ ] **Step 1: Write the failing test**

Assert a valid Cognito JWT (signed with a test JWKS) yields the same `request.user` shape the Firebase path produces, and that a token with a wrong `iss` or `aud` is rejected.

- [ ] **Step 2–4: Implement with `aws-jwt-verify`, test, commit**

Keeping `request.user`'s shape identical is what stops this change from reaching the route handlers at all.

```bash
git add apps/api
git commit -m "feat(api): support Cognito token verification"
```

### Task 20: Web auth provider and the owner bootstrap script

**Files:**

- Create: `apps/web/src/lib/auth-provider.ts`
- Modify: `apps/web/src/lib/auth.tsx`, `apps/web/src/lib/firebase.ts`, `apps/web/src/components/SignIn.tsx`
- Create: `apps/api/scripts/bootstrap-owner-cognito.ts`

- [ ] **Step 1: Extract the auth surface the app actually uses**

`{ signIn, signOut, onAuthStateChanged, getIdToken, getClaims }` — five functions. `AuthGate`, `SignIn` and `useAuth()` consume only these, so both providers can satisfy them and the components need no changes beyond their import.

- [ ] **Step 2: Implement the Cognito provider and port the bootstrap script**

The Cognito equivalent of `setCustomUserClaims` is setting `custom:role` on the user, which the Task 18 Lambda then projects into the token. The same staleness caveat applies: a user must re-authenticate before a changed role takes effect.

- [ ] **Step 3: Verify sign-in end to end against the deployed pool**

- [ ] **Step 4: Commit**

```bash
git add apps/web apps/api/scripts
git commit -m "feat(web): add Cognito auth provider behind a shared interface"
```

---

## Phase 7 — Cutover and decommission

### Task 21: CI/CD for AWS

**Files:**

- Create: `.github/workflows/deploy-staging-aws.yml`, `.github/workflows/deploy-production-aws.yml`
- Modify: `.github/workflows/terraform-plan.yml`

- [ ] **Step 1: Port the deploy workflow**

`aws-actions/configure-aws-credentials` with `role-to-assume` replaces `google-github-actions/auth`. The build matrix, `image_tag` discipline and the `web`-only build-args step all carry over unchanged — including `NEXT_PUBLIC_API_URL`, which has the same chicken-and-egg on AWS: the ALB DNS name is not known until the first apply.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows
git commit -m "feat(ci): add AWS deploy workflows"
```

### Task 22: Data migration and cutover

- [ ] **Step 1: Dump and restore**

```bash
pg_dump --no-owner --no-acl -Fc -f signal.dump "<cloud-sql-connection>"
pg_restore --no-owner --no-acl -d "<rds-connection>" signal.dump
```

Run against a **paused** ingestion schedule so no writes land mid-dump. Verify row counts per table on both sides before proceeding.

- [ ] **Step 2: Migrate stored objects**

`gs://` → `s3://` for the raw bucket. Then run a one-off script rewriting `signals.raw_storage_ref` from the `gs://` prefix to `s3://`. Keying is identical by construction (Task 2's `rawKey`), so only the prefix changes.

- [ ] **Step 3: Re-provision users**

Cognito cannot import Firebase password hashes. Users must be re-invited via the set-password flow. Plan the comms — this is user-visible and is the only genuinely irreversible step in the cutover.

- [ ] **Step 4: Flip `CLOUD_PROVIDER=aws`, cut DNS, monitor for 48 hours**

- [ ] **Step 5: Commit**

```bash
git commit -m "chore(infra): cut staging over to AWS"
```

### Task 23: Decommission GCP

- [ ] **Step 1: Delete the GCP implementations**

`libs/storage/src/gcs.ts`, `libs/messaging/src/pubsub.ts`, `libs/llm/src/vertex.ts`, their tests, and the `CLOUD_PROVIDER` switch itself. The abstraction earned its keep during transition; keeping it afterwards is carrying cost for an option you have already exercised. Delete `infra/` once the AWS environment has been stable for a full billing cycle.

- [ ] **Step 2: Rewrite the docs**

`docs/ARCHITECTURE.md` §12, `docs/SETUP.md` in full, `infra/README.md` → `infra-aws/README.md`, and `CLAUDE.md`'s house rules. Per the project's own rule, these ship in the same change as the code.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(infra): remove GCP implementations and documentation"
```

---

## Estimate

| Phase                      | Effort    | Risk                                              |
| -------------------------- | --------- | ------------------------------------------------- |
| 1 — Portability refactor   | 5–7 days  | Low — all on GCP, fully testable                  |
| 2 — AWS foundation         | 3–4 days  | Low                                               |
| 3 — AWS adapters           | 4–6 days  | **Bedrock prompt re-validation is the wildcard**  |
| 4 — ECS Fargate            | 5–7 days  | Medium — migration-on-startup under concurrency   |
| 5 — Workers and scheduling | 4–5 days  | Medium — push→pull is a real model change         |
| 6 — Cognito                | 7–10 days | **High — deepest app change, user-visible**       |
| 7 — Cutover                | 3–5 days  | Medium — password re-provisioning is irreversible |

**Total: 31–44 working days — call it 6–9 calendar weeks for one engineer.** That is above the 4–7 weeks estimated before these decisions were made, and the delta is almost entirely Phase 1: the portability refactor is work that a direct lift-and-shift would skip. It buys a GCP environment that keeps working throughout, which was a stated requirement.

## Known gaps: what this plan closes, and what it does not

Closed as a by-product, because the work had to happen on one cloud or the other and doing it
twice would be waste:

- **#4** (raw payloads never stored, scoring reads a URL) — Tasks 4 and 5
- **#7** (topic names differ between code and Terraform) — Task 6
- **#2** (scheduler calls a nonexistent `/reconcile`) — Task 17
- **#9** (worker swallows errors, DLQ never fires) — Task 16
- **#1** (push endpoint mismatch) — dissolved rather than fixed: SQS is pulled, so there is no
  push endpoint to mismatch
- **#3** (Cloud Tasks provisioned but unused) — dissolved: SQS covers both roles

**Prerequisites, not out of scope.** The owner ruled on 2026-08-06 that `KNOWN-GAPS.md` is the
backlog and is burned down _before_ new work — which includes this migration. These are
application defects unrelated to the cloud, and they must be closed before Phase 1 starts:

- ~~**#5** — brand-scoped reads don't enforce `brandEntityId`~~ ✅ resolved 2026-08-06
- ~~**#6** — cursor pagination has no `ORDER BY`~~ ✅ resolved 2026-08-06
- **#11** — unused denormalised sentiment columns on `signals`
- **#12** — `POST /admin/users` role gating and the missing users UI
- **#13** — six dashboard views still render mock data (the largest item)

See `docs/KNOWN-GAPS.md` § Burn-down order for the full sequence. Gaps #2, #4, #7 and #9 remain
inside this plan rather than ahead of it, because the phases below implement them once, on the
interfaces, instead of twice.

## Open items requiring a decision before Phase 3

1. **Bedrock model ID** — must be confirmed in-region for eu-west-2 (Task 12, Step 1).
2. **Scoring prompt parity** — if Claude and Gemini disagree materially on your real signals, sentiment history before and after the cutover is not comparable. Decide whether to re-score the backlog.
3. **`report-worker`** — it is a health-check skeleton. Consider dropping it from the AWS stack entirely until Epic 12 rather than porting a skeleton and paying for an idle Fargate task.
