# Priya (AI receptionist) — operations runbook
Last updated: 2026-04-21

Hub-centric Phase 1 rollout. Central hub (TVLA) staffs Priya; she handles
Facebook Messenger (Chatwoot inbox 12) + Instagram DM (inbox 15) on behalf
of the hub. WhatsApp is **out of scope for Phase 1** — separate future
project.

Training footprint: **one team** (hub), not eight.

---

## 0. Roles + mental model

- **Priya** — AI receptionist persona. Runs in `nestjs-src/ai-agent/`.
  Replies via Chatwoot, escalates per guardrails, writes leads to Twenty CRM.
- **Hub team** — a single Chatwoot team (env `CHATWOOT_HUB_TEAM_ID`).
  Picks up every Priya handoff from the team queue via standard Chatwoot UI.
- **Clinic teams** — unchanged from today. Receive leads via
  Twenty CRM + NotificationDispatcher (WAHA for Phase 1, Twenty in-app later).
  Do NOT interact with Priya directly.

---

## 1. Go-live stages

> Stage 1 shadow mode uses prompt **v2.0.1** (2026-04-24 — combined phone+city ask, one-soft-follow-up, paravur disambiguation). v2.0 archived at `nestjs-src/ai-agent/prompts/v2/priya.prompt.v2.0.ts`. v1.0 archived at `nestjs-src/ai-agent/prompts/v1/priya.prompt.v1.ts`.
>
> **Notification path (v2.0.1 onward)**: `LeadCreationService` → `PriyaLeadNotifierService` (in `nestjs-src/notifications/`) → `NotificationService.notifyNewLead()` → WAHA message + email via `cron/instant_lead_notify.py`. BullMQ `priya-lead-notify` queue + `LeadNotifyWorker` have been deleted; `NotificationDispatcher` remains registered but unused by Priya (see `docs/priya/FOLLOWUPS-2026-04-24.md` F7 for Phase 2 decision).
>
> **Clinic routing (v2.0.1 onward)**: `ClinicRegistry` expanded to ~187 canonical entries across 7 clinics (owner-vetted). `ClinicRegistry.resolveCity(freeText)` returns a discriminated union (`matched` / `ambiguous` / `not_found`). `AMBIGUOUS_TOKENS` handles paravur-style two-candidate cases. `ROUTING_ALTERNATIVES` logs secondary clinics for analytics without affecting routing.

Every stage has a **numeric exit gate** you can check with `curl` against
`/health/priya`. No subjective assessments; no "it feels ok, ship it".

### Stage 0 — staging deploy + sanity

Prereqs:
- `CHATWOOT_HMAC_SECRET` generated (`openssl rand -hex 32`) and set in
  Chatwoot's webhook config panel
- Chatwoot agent-bot user created; token copied to `CHATWOOT_BOT_TOKEN`
- Admin token from a hub-admin user copied to `CHATWOOT_ADMIN_TOKEN`
- Hub team created in Chatwoot UI; team id in `CHATWOOT_HUB_TEAM_ID`
- `ANTHROPIC_API_KEY` staging key set (low cap, $20/month — safe if leaked)
- `HEALTH_BASIC_AUTH="admin:<strong-random-pass>"`
- `PRIYA_ENABLED=false` (controller inert until we're ready)

Deploy:
```
cd /opt/dermavue-webhooks
./deploy.sh
```

Exit gate:
```
# /health/priya returns 200 even when PRIYA_ENABLED=false
curl -sf -u "$HEALTH_BASIC_AUTH" https://staging.crm.dermavue.com/webhooks/health/priya \
  | jq '.enabled, .dependencies'

# expect .enabled=false, .dependencies.redis="ok"
```

Run the Anthropic cache-verification harness:
```
ANTHROPIC_API_KEY=$(grep ANTHROPIC_API_KEY .env | cut -d= -f2-) \
  node scripts/priya-cache-verify.mjs
```
Must exit 0 with `cache_read > 0` on turns 2-10.

Apply Postgres migration (if not applied):
```
psql -U chatwoot -d dermavue_crm -f scripts/migrations/2026-04-21-priya-notification-failures.sql
```

### Stage 1 — Instagram shadow mode (48 h)

Flip:
```
PRIYA_ENABLED=true
PRIYA_SHADOW_MODE=true
PRIYA_INBOX_IDS=15             # Instagram only; Messenger later
```
Deploy. Every patient message on inbox 15 now:
- Triggers Priya's full pipeline (LLM, phone detection, escalation, telemetry)
- Posts Priya's intended reply as a **Chatwoot private note** (patient never sees it)
- Hub staff reads the note, decides manually whether to copy-paste to the patient

Hub physician reviews ≥30 exchanges over 48 h. Veto criteria:
- Diagnosis language ever appears in a Priya draft
- Drug name named in response to a symptom
- Price quoted beyond consultation fee
- Wrong language / tone-deaf / generic
- Voice drift — Priya writing in sir/madam or full-sentence paragraphs instead of v2.0 Indian-girl-texting register.

Exit gate (run at +48 h):
```
curl -sf -u "$HEALTH_BASIC_AUTH" https://crm.dermavue.com/webhooks/health/priya | jq '
  .conversations.handoffs_today,
  .anthropic.trip_count_today,
  .cost.daily_spend_inr,
  .latency_ms.p95
'
```
Proceed to Stage 2 if:
- Hub physician signs off on quality review
- Anthropic circuit trip count = 0
- p95 latency < 6000 ms
- Daily spend well under ₹800 (should be well under ₹100 during shadow)

### Stage 2 — Instagram live (1 week)

Flip:
```
PRIYA_SHADOW_MODE=false
# PRIYA_INBOX_IDS still 15 (Instagram only)
```
Deploy. Patients now see Priya's replies directly.

Monitor daily:
```
curl -sf -u "$HEALTH_BASIC_AUTH" https://crm.dermavue.com/webhooks/health/priya | jq '{
  enabled, kill_switch_reason,
  circuit: .anthropic.circuit_state,
  qualification_rate: .conversations.qualification_rate_today,
  infra_handoffs: .conversations.handoffs_today.infrastructure,
  total_handoffs: .conversations.handoffs_today.total,
  cost: .cost.daily_spend_inr
}'
```

**Exit gates** (averaged over 7 days):
- `qualification_rate_today` ≥ **0.40** (≥40% of Priya-handled conversations yield a captured phone)
- `handoffs_today.infrastructure` / `total_handoffs` < **0.05** (infra < 5% of all handoffs)
- `anthropic.trip_count_today` ≤ 1/day
- No diagnosis / drug / price violations in hub QA sample

If gate fails:
```
# Emergency kill — <5 second stop, no deploy needed
curl -u "$HEALTH_BASIC_AUTH" -X POST \
  https://crm.dermavue.com/webhooks/admin/priya/kill-switch \
  -H 'Content-Type: application/json' \
  -d '{"enabled":false}'

# Re-enable
curl -u "$HEALTH_BASIC_AUTH" -X POST \
  https://crm.dermavue.com/webhooks/admin/priya/kill-switch \
  -H 'Content-Type: application/json' \
  -d '{"enabled":true}'
```

### Stage 3 — Messenger live (1 week)

```
PRIYA_INBOX_IDS=12,15            # add Messenger
PRIYA_INBOX_CLINIC_MAP=12:TVLA,15:TVLA
```
Deploy. Same monitoring + exit gates as Stage 2. No shadow re-run — Messenger
shares the prompt, the flow, and the guardrails with Instagram.

### Stage 4 — data collection + Phase 2 decision (2 weeks)

No code changes. Run for 2 weeks post Stage 3 exit. Export:
- `scripts/priya-ops-queries.sql` → run weekly, CSV to the hub physician
- Corpus log (`priya.corpus.inbound_first_sentence` channel) — count voice-note
  frequency to decide Sarvam STT (Phase 2 gate: ≥10% of conversations carry a
  voice note → build STT; <10% → stay stub)
- Lead summarizer amendment — if ≥40% of qualified leads need 2+ hub clarifications,
  add a pre-handoff summary block to the prompt

---

## 2. Kill-switch runbook (for SRE on-call)

**When to flip**: patient complaints, wrong-language replies, cost runaway,
circuit repeatedly tripping.

```
# Immediate disable — Priya silent on next inbound (<5 s)
curl -u "$HEALTH_BASIC_AUTH" -X POST \
  https://crm.dermavue.com/webhooks/admin/priya/kill-switch \
  -H 'Content-Type: application/json' \
  -d '{"enabled":false}'

# Verify
curl -sf -u "$HEALTH_BASIC_AUTH" https://crm.dermavue.com/webhooks/health/priya | jq '.kill_switch_reason'
# expect "manual"
```

**Re-enable**:
```
curl -u "$HEALTH_BASIC_AUTH" -X POST \
  https://crm.dermavue.com/webhooks/admin/priya/kill-switch \
  -d '{"enabled":true}'
```

**Precedence** (highest wins):
1. `PRIYA_ENABLED=false` in `.env` — controller refuses every webhook (deploy required to flip)
2. Kill-switch flag in Redis — every inbound gets `priya-handoff-manual-off` + fallback template
3. Daily cost cap tripped — every inbound gets `priya-handoff-cost-cap` (automatic)
4. Normal flow

---

## 3. Deploy.sh preflight — what it checks

Runs before every build. Fails fast with remediation hint on violation.

Existing checks (pre-§9): uncommitted-changes, disk space, canary grep,
IG/Messenger controller must have zero CRM imports, Chatwoot webhook
controller must have zero WAHA imports, TS↔Python clinic registry parity.

§9 Priya-specific:
- All required Priya env vars set when `PRIYA_ENABLED=true`
- `CHATWOOT_HUB_TEAM_ID` + `CHATWOOT_AGENT_BOT_USER_ID` numeric-positive
- `PRIYA_INBOX_IDS` parseable as comma-separated ints
- `NODE_ENV=production` + `PRIYA_ALLOW_COST_OVERRIDE=true` → fail
- `NOTIFICATION_CHANNELS` contains only `waha` / `twenty_inapp`
- Twenty single-writer rule (CRM mutations only inside `common/twenty*.ts`)
- `scripts/priya-dispatcher-grep-gate.sh` (no WahaService/NotificationService
  in ai-agent/, no @anthropic-ai/sdk, chatwoot.client.ts token scope)

---

## 4. CI gate (`.github/workflows/priya-ci-gates.yml`)

Every PR to `main` runs:
1. TypeScript compile (`npm run build`)
2. `scripts/priya-dispatcher-grep-gate.sh`
3. Twenty single-writer grep
4. All 7 standalone harnesses (hmac, language, dispatcher, handoff,
   escalation, circuit-breaker, observability) — 150+ tests

Any rule fail blocks the merge. No override.

---

## 5. Migrations (run order)

Ordered chronologically — apply in this sequence on a fresh staging DB:

| When | Script | Target DB |
|---|---|---|
| 2026-04-18 | `scripts/migrations/2026-04-18-lead-sla-phase1.sql` | dermavue_crm |
| 2026-04-21 | `scripts/migrations/2026-04-21-priya-notification-failures.sql` | dermavue_crm |

Apply:
```
for f in scripts/migrations/*.sql; do
  echo "→ $f"
  psql -U chatwoot -d dermavue_crm -f "$f"
done
```

Each migration is idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).

---

## 6. Operational dashboards

Run these weekly during the hub physician review:
```
psql -U chatwoot -d dermavue_crm -f scripts/priya-ops-queries.sql
```

Includes: handoff reasons today, policy vs infrastructure 7-day split,
qualification rate by day, top escalation labels 30-day, dispatcher failures
by adapter 7-day.

---

## 7. Cost monitoring

Daily spend: `.cost.daily_spend_inr` from `/health/priya`.
Cap: `PRIYA_DAILY_COST_CAP_INR` (default ₹800).

Expected at typical volume:
- 1000 conversations/day × ~4 turns avg × ~0.2 INR/turn = ~₹800/day at scale
- Cache hit rate ~90% after warmup → ~₹200/day effective
- Cap tripping should be an alarm, not routine

When cap trips: Priya posts `priya-handoff-cost-cap` handoff to every inbound
for the rest of the IST day. Resets at IST midnight.

---

## 8. Phase 2 triggers (don't build before the data supports it)

| Feature | Trigger |
|---|---|
| Sarvam STT (voice) | ≥10% of patient turns contain a voice note over 2-week sample |
| Lead summarizer amendment | Hub agents report >40% of qualified leads need 2+ clarification messages |
| Twenty in-app notifications → dispatcher flip | Twenty rolls out mobile push; `NOTIFICATION_CHANNELS` env flip, no code |
| WhatsApp expansion | Separate project — requires Meta Cloud API per-clinic provisioning first |

---

## 9. Architecture invariants (baked in — do not violate)

From CLAUDE.md + enforced by deploy.sh preflight + CI gates:

1. Priya's orchestrator must **never** import `WahaService` or
   `NotificationService` directly. All notifications via `NotificationDispatcher`.
2. Priya uses axios, **never** `@anthropic-ai/sdk`.
3. Chatwoot label / custom_attribute endpoints use `CHATWOOT_ADMIN_TOKEN`;
   messages / toggle_status use `CHATWOOT_BOT_TOKEN`.
4. Twenty GraphQL mutations only inside `nestjs-src/common/twenty*.ts`.
5. Priya is the hub receptionist — every handoff → `CHATWOOT_HUB_TEAM_ID` +
   `status=pending`. Never a per-clinic team in Priya's flow.
6. `state.humanAssigned` and `state.leadCreated` latch one-way — enforced by
   `StateService.prepareForWrite`, verified by the handoff harness.
7. No PHI in logs. Phone scrubbed via `PhoneExtractor.scrub`; pattern NAMES
   only (never content); SHA256 conversation fingerprint instead of raw IDs.

Break any of these and `deploy.sh` or the CI gate will block the change.
