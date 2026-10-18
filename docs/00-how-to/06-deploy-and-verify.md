**Back:** [00-overview](./00-overview.md)

**Verified against:** `template.yaml` read in full on 2026-10-04 — every parameter name, type, default and `NoEcho` flag, all nine outputs, the four log groups, the four queues and both `Conditions` taken from the parsed document rather than from memory; `package.json` for the exact gate commands; `.env.example` for the variable names; `src/lib/ringClient.ts` for `DEFAULT_OAUTH_URL`, the `grant_type=refresh_token` exchange, and the ~30-day refresh-token lifetime; `src/lib/snapshotStore.ts`, `src/handlers/overlayPusher.ts` and `src/handlers/eventQuery.ts` for `S3_SNAPSHOT_BUCKET`, `WEBSOCKET_ENDPOINT` and `QUERY_API_KEY`. **Not verified:** any step below has been run. There is no AWS account and no SAM CLI in this environment, so this is a procedure assembled from the template and the code, not a transcript of a deployment. Expect to change something on the first attempt — that is what the second half of this page is for.

# Recipe: deploy, then prove it works

Six steps, in order. Steps 1–3 need an AWS account and are the only ones that can still
invalidate the code. Steps 4–6 are submission paperwork.

Why this order, and why step 1 is not optional: **the fixture demos and the full test
suite cannot find integration bugs.** The CORS configuration was missing from
`template.yaml` for the whole life of the file, and every gate stayed green while the live
dashboard would have failed against a correct deployment (D037). One hour against a real
account verifies more than the entire 483-test suite.

## What you need before starting

| Requirement | Notes |
|---|---|
| An AWS account | Bedrock must be enabled **in the region you deploy to**, and model access granted in the console. This is a separate console action from deploying |
| The SAM CLI | `pip install aws-sam-cli` or the installer. Not in this environment — see [02-toolchain](../03-repository/02-toolchain.md) |
| A Ring Partner account | To get the four Ring parameters. ~30 day refresh tokens, so this is the step most likely to expire on you |
| `npm install` done | `npm run build` must run before `sam deploy`; the template deploys from `dist/`, not from source |

## Step 1 — Get the four Ring values

Four template parameters come from Ring and from nowhere else. In the Ring Partner
developer portal, create an application to obtain the client id and secret, then complete
the authorization flow to obtain a **refresh token**.

| Parameter | What it is | Lifetime |
|---|---|---|
| `RingClientId` | Application client id | permanent |
| `RingClientSecret` | Application client secret | permanent |
| `RingRefreshToken` | From the authorization flow | **~30 days** |
| `WebhookSecret` | The X-Signature HMAC key, shown once when the app is created | cannot be regenerated — if you lose it, create a new app |

Two facts worth knowing before you start:

- The refresh token is exchanged at `POST https://oauth.ring.com/oauth/token` with
  `grant_type=refresh_token`. It is **never** used as a bearer token; the client always
  obtains a short-lived access token first.
- The ~30-day lifetime means a token obtained today will be dead before a judge views the
  demo if you leave it. **Re-authorize the day you record, and again the day you submit.**

## Step 2 — Decide the CORS origin *before* you deploy, not after

`DashboardAllowedOrigins` defaults to `*`. That works, but it means any page on the internet
could read `GET /events/today` if it somehow had the key.

Your Pages URL is deterministic: it is `https://<owner>.github.io` for the `armageden`
repository remote. Set it explicitly:

```bash
sam deploy --guided --parameter-overrides DashboardAllowedOrigins=https://armageden.github.io
```

You will not know the Pages URL is live until step 4, so the pragmatic order is: deploy
once with `*` to prove it works, then redeploy with the narrowed origin. Both are recorded
in the stack's parameter history.

## Step 3 — Deploy

```bash
npm ci
npm run all          # must be green BEFORE deploying; it builds dist/
sam validate --lint  # catches what a YAML parser cannot, and needs no account
sam build
sam deploy --guided
```

`sam deploy --guided` will ask for all 15 parameters. Five have **no default** and it
cannot proceed without them:

| Parameter | Default if you accept it |
|---|---|
| `WebhookSecret` | **required** |
| `RingClientId` | **required** |
| `RingClientSecret` | **required** |
| `RingRefreshToken` | **required** |
| `QueryApiKey` | **required** — generate one: `openssl rand -hex 32` |
| `DailySummaryTimezone` | `UTC` — see D025 before changing this |
| `BedrockModelId` | `anthropic.claude-3-haiku-20240307-v1:0` |
| `SnapshotBucketName` | `front-door-snapshots` |
| `EventsTableName` | `FrontDoorEvents` |
| `ConnectionsTableName` | `FrontDoorConnections` |
| `IdempotencyTableName` | `FrontDoorIdempotency` |
| `LogRetentionDays` | `14` |
| `BedrockMonthlyBudgetUsd` | `10` |
| `CostAlarmEmail` | empty — the budget is created with no subscriber (D027) |
| `DashboardAllowedOrigins` | `*` |

`sam deploy` prints nine outputs. Keep them:

| Output | Use |
|---|---|
| `WebhookEndpoint` | The URL to configure in Ring. **Do this before testing** |
| `EventsQueryEndpoint` | What the dashboard calls |
| `OverlayWebSocketUrl` | What the overlay client connects to |
| `DescribeDeadLetterQueueUrl` | Events that failed five times |
| `OverlayDeadLetterQueueUrl` | Pushes that failed five times |
| `EventsTableName`, `IdempotencyTableName` | For the console |
| `DailySummaryTimezone` | Confirms what the schedule resolved to |
| `BedrockBudgetName` | The budget tracking Bedrock spend |

Then configure the webhook: paste `WebhookEndpoint` into the Ring portal. **The
`X-Signature` check is verified against the raw request body**, so if the Ring portal offers
any request/response mapping that re-serialises the payload, leave it off — a re-serialised
body produces a different digest and every event will 401.

## Step 4 — Prove it, in this order

Cheapest and most decisive first. Each of these is something no test covers.

```bash
# 1. Does the API answer at all?
curl -i "$(sam list outputs --output json | jq -r '.EventsQueryEndpoint')" \
  -H "X-Query-Key: <your QueryApiKey>"
# expect 403 without the key, 200 with it. A browser CORS error here means
# DashboardAllowedOrigins is wrong — that is the D037 failure.

# 2. Does the webhook accept a signed body? (the §9.1 fixture)
BODY=$(cat test/fixtures/ring_motion_event.json)
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')
curl -i "$(sam list outputs --output json | jq -r '.WebhookEndpoint')" \
  -H "Content-Type: application/json" -H "X-Signature: sha256=$SIG" -d "$BODY"
# expect 200 and {"status":"accepted"}

# 3. Did an event actually get described? (this is the Bedrock envelope test)
aws dynamodb scan --table-name FrontDoorEvents --projection-expression \
  "event_id,description,description_source,device_name,snapshot_s3_key"
# description_source = 'ai' means Claude actually ran.
```

`description_source: "fallback"` everywhere means **the Bedrock call failed and the
deterministic sentence was written instead.** That is the FR11 fallback working, and it is
also a silent failure of the thing the judges are judging. Check the `DescribeLogGroup`.

Then open the dashboard, paste `EventsQueryEndpoint` and the key, and load. Then open
`firetv/dist/overlay.html?endpoint=<OverlayWebSocketUrl>` and press the doorbell.

### The four things most likely to break

In the order I would expect them:

1. **Bedrock access.** `bedrock:InvokeModel` is granted in the template, but *model access*
   is a separate console toggle per account per region. An `AccessDeniedException` produces
   `description_source: "fallback"` and nothing else — the pipeline keeps working, which is
   exactly why it is easy to miss.
2. **The Ring refresh token.** If it has expired, media fetches fail, and every event falls
   back too. The tell is the same `fallback` marker, which is why step 3 is the one to run.
3. **CORS.** Covered above.
4. **Bucket name collision.** `front-door-snapshots` is a global S3 namespace. If you have
   deployed before and it still exists, the stack will fail to create. Pass a unique name.

### Where to look when it goes wrong

Four log groups, one per stage, all with `LogRetentionDays` retention:

| Log group | Stage |
|---|---|
| `WebhookLogGroup` | signature, idempotency, storage |
| `DescribeLogGroup` | **the Ring and Bedrock calls** |
| `OverlayLogGroup` | pushes and prunes |
| `DailySummaryLogGroup` | the scheduled summary |

Plus `DescribeDeadLetterQueueUrl` — messages there are events with no description, and the
event row still exists, so nothing is lost and it is safe to re-drive.

## Step 5 — Publish the demos

`.github/workflows/demos.yml` publishes both demo pages to GitHub Pages on every push to
`main`, so there is nothing to run.

**One manual step, once:** repository Settings → Pages → Source → **GitHub Actions**.
Until that is set, the workflow has no environment to deploy into and will fail.

After it is enabled, your Pages URL is `https://armageden.github.io` and the demos are at
the dashboard demo at `web/dist/pipeline.html` and the overlay at
`firetv/dist/overlay.html` as staged under the Pages root. Then redeploy with
`DashboardAllowedOrigins=https://armageden.github.io` to close the `*`.

## Step 6 — The submission items

| Item | Action |
|---|---|
| Repo public, MIT in About | Settings → General → Danger Zone → "Change visibility"; the licence is picked in the About section |
| Demo video, under 3 minutes | Record it against the **deployed** stack, not the fixtures. Record the day your refresh token is fresh. For the **Fire TV** track the video must show the overlay running on an actual Fire TV device or the Fire TV/Vega simulator; for the **Ring** track it must show the project working through a simulator or an actual Ring device |
| Devpost form | Tracks: **Ring, Fire TV**. The form asks for the repo URL, the video URL, and the live demo |
| A **second** public repo | Required for the Open Source mini-challenge, and it must be a *different* repository from the submission. Entry 18 records that the two are easy to conflate |

## When it works, write it down

Add a Friction Log entry for whatever broke, using
[03-add-a-friction-log-entry](./03-add-a-friction-log-entry.md). The Rules score this log,
so an entry saying "the Bedrock integration was never run and I assumed the envelope from
memory, and here is what actually happened" is worth more than any entry already in the file.

Then update three things: the provenance line on
[01-current-state](../03-repository/01-current-state.md), the FR status rows in
[01-requirements-index](../01-product/01-requirements-index.md) — FR4, FR6 and FR13 still
say *unmeasured* and *not implemented* respectively, and a deployment is exactly what makes
those true or false — and this page, replacing the "not verified" line at the top with what
actually happened.