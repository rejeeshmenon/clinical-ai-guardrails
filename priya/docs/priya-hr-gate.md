# Runbook — Priya recruitment gate (`PRIYA_HR_GATE_MODE`)

**Owner:** Dr. Rejeesh Menon · **Created:** 2026-07-28 (Gate D remediation) · **Service:** `dermavue-webhooks`

The gate lets Priya **decline to create a CRM lead** when an inbound is a job
application. It is the only code path in the system that deliberately withholds
a lead, so it carries a runbook of its own.

---

## 1. THE TWO RULES THAT WILL BITE YOU

These are not style preferences. Both were proven empirically on 2026-07-28.

### Rule 1 — revert with `=off`, NEVER by deleting the line

`/opt/dermavue-webhooks/Dockerfile` is `COPY . .` and `.dockerignore` does **not**
exclude `.env`, so a copy of `.env` is **baked into the image** at `/app/.env`.
`ConfigModule.forRoot()` has no `ignoreEnvFile`, so the baked copy **backfills any
key missing from the injected env**.

Consequence: deleting `PRIYA_HR_GATE_MODE` from the host `.env` does **not**
disarm the gate — the baked value wins.

```bash
# WRONG — the baked /app/.env still supplies the old value
sed -i '/^PRIYA_HR_GATE_MODE=/d' /opt/dermavue-webhooks/.env

# RIGHT — an explicit value overrides the baked copy
sed -i 's/^PRIYA_HR_GATE_MODE=.*/PRIYA_HR_GATE_MODE=off/' /opt/dermavue-webhooks/.env
```

### Rule 2 — a flag change REQUIRES a full rebuild

`deploy.sh rollback <tag>` re-tags and swaps **without rebuilding**, so it restores
an image whose baked `.env` carries the *old* flag value — then health-checks 200,
flips nginx, and reports **success** with the gate silently still armed.

```bash
# WRONG for a flag change — no rebuild, baked env wins
bash /opt/dermavue-webhooks/deploy.sh rollback <tag>

# RIGHT — full rebuild bakes the new value
bash /opt/dermavue-webhooks/deploy.sh
```

`rollback <tag>` **is** valid for a pure code rollback to a tag that predates the
flag entirely.

> **Related, unfixed:** the same `COPY . .` bakes the full production `.env`
> (~10 KB, 16 secret-bearing lines: Twenty API key, Meta system-user token, DB
> credentials) into **every image layer**. Any `docker save` / registry push
> leaks the set. Tracked as `FU-DOCKER-ENV-SECRET-BAKING`. Fixing it (adding
> `.env` to `.dockerignore`) also removes the fallback described in Rule 1, so
> the two must land together and Rule 1 must be re-verified afterwards.

---

## 2. Modes

| Value | Behaviour |
|---|---|
| unset / `off` / anything unrecognised | No classification at all. Byte-identical to pre-gate. |
| `shadow` | Classifies, counts, writes a `🔍 SHADOW` private note — **always creates the lead**. Zero patient risk. |
| `enforce` | Withholds the lead on strong evidence; replies with HR contact; labels `hiring`; hands to hub team. |

Parsing fails safe: a typo (`enfroce`) resolves to `off`. It can never
accidentally arm.

---

## 3. Is it armed right now?

```bash
docker logs $(docker ps --format '{{.Names}}' | grep dermavue-webhooks) 2>&1 \
  | grep priya_flags_at_boot | tail -1
```
```json
{"event":"priya_flags_at_boot", ... "hr_gate_mode":"off","hr_gate_can_withhold":false}
```

`hr_gate_can_withhold` is the field that matters. **Do not** infer state from the
host `.env` — see Rule 1.

---

## 4. Arming it

```bash
ssh dermavue
cp /opt/dermavue-webhooks/.env /root/.env.bak.$(date +%Y%m%d-%H%M%S)
tail -c1 /opt/dermavue-webhooks/.env | od -c | head -1     # confirm trailing newline
printf 'PRIYA_HR_GATE_MODE=enforce\n' >> /opt/dermavue-webhooks/.env
bash /opt/dermavue-webhooks/deploy.sh                       # FULL rebuild, ~70s
```

Verify all three:
```bash
C=$(docker ps --format '{{.Names}}' | grep dermavue-webhooks)
docker exec $C printenv PRIYA_HR_GATE_MODE                       # enforce
docker logs $C 2>&1 | grep priya_flags_at_boot | tail -1         # can_withhold:true
curl -s -o /dev/null -w '%{http_code}\n' https://crm.dermavue.com/webhooks/health   # 200
```

Prefer **IST business hours**, so the hub team is watching the Chatwoot queue live.

---

## 5. Rolling back

```bash
ssh dermavue
sed -i 's/^PRIYA_HR_GATE_MODE=.*/PRIYA_HR_GATE_MODE=off/' /opt/dermavue-webhooks/.env
grep -c '^PRIYA_HR_GATE_MODE=off$' /opt/dermavue-webhooks/.env   # must print 1
bash /opt/dermavue-webhooks/deploy.sh
```
~70 s. Zero downtime (blue/green), but note **every** deploy bounces the whole
webhook service — Meta ingestion, WAHA, Chatwoot, PWA API — and both colours run
concurrently for ~30 s, with PG advisory locks (4242005 reconcile worker,
4242003 leave-reconcile) preventing double-drain.

Via the GitHub deploy workflow the same operation took **7m19s** (≈6.5 min of
runner queue). **Under incident, use the server path.**

---

## 6. What to watch

`GET /webhooks/health` (auth-gated; 401 unauthenticated is healthy) →
`phone_short_circuit_today`:

| Counter | Meaning | Action |
|---|---|---|
| `hr_lead_suppressed` | A lead was **withheld** | First 48 h: **any** non-zero → read the conversation. After: **>3/IST-day → page.** Steady state should trend to **0** once follow-up messaging is disabled on HR ads. |
| `hr_near_miss` | Echo + exactly **1** signal group | Leading indicator of threshold drift. If it runs far ahead of suppressions, re-examine the vocabulary before it touches patients. |
| `hr_suppress_aborted_no_trace` | Suppression abandoned, lead **created** | Chatwoot is degraded — not a classifier fault. Investigate Chatwoot. |
| `hr_shadow_would_suppress` | Shadow only | Should be 0 in `enforce`. |

Live tail:
```bash
docker logs -f $(docker ps --format '{{.Names}}' | grep dermavue-webhooks) 2>&1 \
  | grep --line-buffered 'priya-hr-gate'
```

Absent Redis keys read as `0` (36 h TTL on the counters), so `0` cannot
distinguish "no HR traffic" from "gate not running". Cross-check
`lead_ad_first_touch_detected` — if that is non-zero for days while
`hr_lead_suppressed` stays absent, confirm the gate is actually armed (§3).

---

## 7. Abort criteria — any ONE triggers §5 immediately

- **Any suppressed conversation a human judges to be a patient.** One is enough.
  A wrongly-created lead costs a phone call; a wrongly-withheld one is invisible
  and unrecoverable.
- `hr_lead_suppressed` **> 5 in the first 4 hours** — firing far wider than the
  historical dry-run predicted.
- Any suppression on a conversation **without** the lead-ad form echo — the
  gate's entire safety argument rests on that precondition holding.
- Any new ERROR class after the swap.

---

## 8. Recovering a wrong suppression

No `lead_sla` row and no `priya_pending_reconcile` row are written, so there is
nothing to "un-suppress". Recovery is manual:

1. Find the conversation — Chatwoot label **`hiring`**, hub team queue.
2. The private note lists the matched signals and the phone's last 4 digits.
3. Create the lead manually in the PWA.
4. `humanAssigned` is deliberately **not** latched (Gate D M-3), so Priya can
   still hear the patient correcting themselves — the conversation is not a
   one-way door.

---

## 9. Why the design is shaped this way

Evidence behind each guard, so a future reader does not "simplify" one away:

- **Label-side classification only.** `processTurnCore` receives the
  debounce-**concatenated** buffer (up to 20 messages, `\n\n`-joined, ~60 s
  window; `PRIYA_DEBOUNCE_ENABLED` defaults **true** and is unset in prod).
  v1 classified the whole buffer and would have withheld real patients — e.g.
  *"i applied the cream u gave, very bad experience"*. Classifying only the
  question-label side of `Label: value` lines mirrors the poller
  (`lead_poller.py:844` matches Meta field **names**) and makes patient prose
  structurally unreachable.
- **Existing patients are never withheld** (Gate D M-2).
- **The audit note is a hard gate** (M-1) — no durable trace ⇒ create the lead.
- **`humanAssigned` is not latched** (M-3) — no one-way door.
- **Historical validation:** 948 form-echo conversations over 60 days →
  29 would suppress, **22 map exactly onto the 22 known HR applicants** found by
  an independent Meta-phone sweep, **0 patients**, 0 near-misses.

## 10. Known gaps

- **No durable suppression ledger.** The only artefacts are the Chatwoot label,
  the private note, and a Redis counter with a **36 h TTL**. → `FU-PRIYA-HR-SUPPRESSION-LEDGER`
- **No push digest.** Detection is pull-only; someone must look. → `FU-PRIYA-HR-DAILY-DIGEST`
- **The gate only covers `tryPhoneShortCircuit`.** An applicant who free-texts
  their number without a form echo is still qualified as a patient. Deliberate,
  under the golden rule. → `FU-PRIYA-FREEHAND-APPLICANT`
