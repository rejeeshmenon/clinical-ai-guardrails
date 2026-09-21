-- Priya operations dashboard — ready-to-run Postgres queries.
--
-- Target DB: dermavue_crm (chatwoot-postgres instance, port 5432)
-- Sources: chatwoot label data (read via Chatwoot's `labels` +
--          `conversation_labels` tables — schema varies by Chatwoot
--          version; adjust column names if the admin built on a
--          different version).
--
-- Each query is intended to answer a specific weekly-review question
-- the hub physician has about Priya's behavior.
--
-- Run via: psql -U chatwoot -d dermavue_crm -f scripts/priya-ops-queries.sql
-- Or interactively: psql → \i scripts/priya-ops-queries.sql
--
-- Author: section 8 (observability)
-- Marker: isSelfAuthored

-- ─────────────────────────────────────────────────────────────────────
-- 1. Handoff reasons today — spot infra vs policy
-- ─────────────────────────────────────────────────────────────────────

-- Note: chatwoot's label table names:
--   label                   — catalog of label strings
--   conversation_labels     — many-to-many join with timestamps
-- If your Chatwoot install uses a different schema (Rails naming
-- conventions vary across v2 / v3), adjust JOIN targets.

\echo '── Handoff reasons (today) ──'

SELECT
  l.title                                AS label,
  COUNT(*)                               AS count
FROM conversation_labels cl
JOIN tags l ON l.id = cl.tag_id
WHERE l.title LIKE 'priya-handoff-%'
  AND cl.created_at > now() - interval '1 day'
GROUP BY l.title
ORDER BY count DESC;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Policy vs infrastructure breakdown (last 7 days)
-- ─────────────────────────────────────────────────────────────────────

\echo ''
\echo '── Policy vs infrastructure handoffs (7d) ──'

SELECT
  CASE
    WHEN l.title IN (
      'priya-handoff-llm-down',
      'priya-handoff-llm-timeout',
      'priya-handoff-cost-cap',
      'priya-handoff-redis-down',
      'priya-handoff-chatwoot-unreachable',
      'priya-handoff-twenty-down',
      'priya-handoff-manual-off'
    ) THEN 'infrastructure'
    WHEN l.title LIKE 'priya-handoff-%' THEN 'policy'
    ELSE NULL
  END                                    AS category,
  COUNT(*)                               AS count
FROM conversation_labels cl
JOIN tags l ON l.id = cl.tag_id
WHERE l.title LIKE 'priya-handoff-%'
  AND cl.created_at > now() - interval '7 days'
GROUP BY 1
ORDER BY 2 DESC;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Qualification rate by day (7-day rolling)
--    Qualification = Priya captured a phone → Twenty Person created.
-- ─────────────────────────────────────────────────────────────────────

\echo ''
\echo '── Qualification rate — Priya-qualified / Priya-handled (7d) ──'

WITH daily AS (
  SELECT
    DATE_TRUNC('day', cl.created_at AT TIME ZONE 'Asia/Kolkata') AS day,
    SUM(CASE WHEN l.title = 'priya-qualified'  THEN 1 ELSE 0 END) AS qualified,
    SUM(CASE WHEN l.title = 'priya-handled'    THEN 1 ELSE 0 END) AS handled
  FROM conversation_labels cl
  JOIN tags l ON l.id = cl.tag_id
  WHERE cl.created_at > now() - interval '7 days'
    AND l.title IN ('priya-qualified', 'priya-handled')
  GROUP BY 1
)
SELECT
  day,
  handled,
  qualified,
  ROUND(100.0 * qualified / NULLIF(handled, 0), 1) AS qualification_pct
FROM daily
ORDER BY day DESC;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Top escalation triggers (lexicon+pattern detail is in Chatwoot
--    private notes — read those by conversation where label fired)
-- ─────────────────────────────────────────────────────────────────────

\echo ''
\echo '── Top policy escalation labels (30d) ──'

SELECT
  l.title,
  COUNT(*) AS count,
  ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM conversation_labels cl2
                              JOIN tags l2 ON l2.id = cl2.tag_id
                              WHERE l2.title LIKE 'priya-handoff-%'
                                AND cl2.created_at > now() - interval '30 days'),
        1) AS pct_of_handoffs
FROM conversation_labels cl
JOIN tags l ON l.id = cl.tag_id
WHERE l.title LIKE 'priya-handoff-%'
  AND l.title NOT LIKE 'priya-handoff-llm%'
  AND l.title <> 'priya-handoff-redis-down'
  AND l.title <> 'priya-handoff-chatwoot-unreachable'
  AND l.title <> 'priya-handoff-twenty-down'
  AND l.title <> 'priya-handoff-cost-cap'
  AND l.title <> 'priya-handoff-manual-off'
  AND cl.created_at > now() - interval '30 days'
GROUP BY l.title
ORDER BY count DESC;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Priya notification failures (from priya_notification_failures table)
-- ─────────────────────────────────────────────────────────────────────

\echo ''
\echo '── Dispatcher failures by day + adapter (7d) ──'

SELECT
  DATE_TRUNC('day', created_at AT TIME ZONE 'Asia/Kolkata') AS day,
  (jsonb_array_elements(attempted_adapters) ->> 'name') AS adapter,
  COUNT(*) AS failures
FROM priya_notification_failures
WHERE created_at > now() - interval '7 days'
GROUP BY 1, 2
ORDER BY 1 DESC, 3 DESC;
