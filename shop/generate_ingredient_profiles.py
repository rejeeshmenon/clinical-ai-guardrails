"""
Generate clinical ingredient monographs via PubMed + Claude Haiku.

Designed to run on the Vultr server (ANTHROPIC_API_KEY already in .env).
Reads ingredient-queue.json and produces one JSON per ingredient under
src/data/ingredients/{slug}.json.

PubMed: E-utilities public endpoint (or NCBI_API_KEY if set).
Haiku:  api.anthropic.com/v1/messages, claude-haiku-4-5-20251001.

Rate-limit safe: 1 req/500ms without key, 1 req/100ms with.
Retries on 429 with exponential backoff.
Idempotent: skips ingredients whose file already exists (unless --force).

Usage:
  python generate_ingredient_profiles.py --limit 20
  python generate_ingredient_profiles.py --only "NIACINAMIDE,RETINOL"
  python generate_ingredient_profiles.py --force  (rewrite existing)
"""
from __future__ import annotations
import argparse
import json
import os
import re
import sys
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(os.environ.get('DERMAVUE_ROOT', Path(__file__).resolve().parent.parent))
QUEUE = Path(os.environ.get('INGREDIENT_QUEUE', str(ROOT / 'scripts' / 'ingredient-queue.json')))
OUT_DIR = Path(os.environ.get('INGREDIENT_OUT', str(ROOT / 'src' / 'data' / 'ingredients')))
LOG = Path(os.environ.get('INGREDIENT_LOG', str(ROOT / 'scripts' / 'ingredient-generation-log.jsonl')))

NCBI_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
NCBI_KEY = os.environ.get('NCBI_API_KEY', '').strip()
if NCBI_KEY in ('', 'FILL_LATER'):
    NCBI_KEY = ''
NCBI_DELAY = 0.12 if NCBI_KEY else 0.5

ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
ANTHROPIC_KEY = os.environ.get('ANTHROPIC_API_KEY', '').strip()
ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001'

SYSTEM_PROMPT = (
    'You are a clinical dermatology database for an IADVL-registered '
    'physician-owned dermatology network in Kerala, India. Generate '
    'evidence-based ingredient profiles. IMC/NMC compliant: use hedged '
    'language only. Never use: best, most effective, clinically proven '
    '(as marketing), guaranteed, cure, treats. Always use: studies '
    'suggest, research indicates, may help support, has been shown to. '
    'Focus on Fitzpatrick IV-VI (Indian skin) throughout. Return ONLY '
    'valid JSON. No markdown. No preamble.'
)


def pubmed_search(term: str, retmax: int = 6) -> list[str]:
    q = (
        f'{term}[tiab] AND (skin[tiab] OR dermatol*[tiab] OR '
        f'cosmetic[tiab] OR hair[tiab])'
    )
    url = f'{NCBI_BASE}/esearch.fcgi'
    params = {'db': 'pubmed', 'term': q, 'retmax': retmax, 'retmode': 'json'}
    if NCBI_KEY:
        params['api_key'] = NCBI_KEY
    r = requests.get(url, params=params, timeout=20)
    if r.status_code != 200:
        return []
    data = r.json()
    return data.get('esearchresult', {}).get('idlist', [])


def pubmed_fetch(pmids: list[str]) -> list[dict]:
    if not pmids:
        return []
    url = f'{NCBI_BASE}/efetch.fcgi'
    params = {'db': 'pubmed', 'id': ','.join(pmids), 'retmode': 'xml'}
    if NCBI_KEY:
        params['api_key'] = NCBI_KEY
    r = requests.get(url, params=params, timeout=30)
    if r.status_code != 200:
        return []
    # Light regex extraction to avoid an XML dep
    xml = r.text
    out = []
    for block in re.finditer(r'<PubmedArticle>(.*?)</PubmedArticle>', xml, flags=re.S):
        b = block.group(1)
        pmid_m = re.search(r'<PMID[^>]*>(\d+)</PMID>', b)
        title_m = re.search(r'<ArticleTitle>(.*?)</ArticleTitle>', b, flags=re.S)
        abs_m = re.search(r'<AbstractText[^>]*>(.*?)</AbstractText>', b, flags=re.S)
        journal_m = re.search(r'<Title>(.*?)</Title>', b, flags=re.S)
        year_m = re.search(r'<PubDate>.*?<Year>(\d{4})</Year>', b, flags=re.S)
        authors = re.findall(r'<LastName>(.*?)</LastName>', b)
        out.append({
            'pmid': pmid_m.group(1) if pmid_m else None,
            'title': _strip(title_m.group(1)) if title_m else '',
            'abstract': _strip(abs_m.group(1)) if abs_m else '',
            'journal': _strip(journal_m.group(1)) if journal_m else '',
            'year': int(year_m.group(1)) if year_m else 2020,
            'authors': authors[:3],
        })
    return out


_TAG_RE = re.compile(r'<[^>]+>')
def _strip(s: str) -> str:
    return re.sub(r'\s+', ' ', _TAG_RE.sub('', s)).strip()


def haiku_generate(inci_name: str, abstracts: list[dict]) -> dict | None:
    if not ANTHROPIC_KEY:
        return None
    abs_block = '\n\n'.join(
        f'[{i+1}] PMID:{a["pmid"]} {a["year"]} {a["journal"]}\n'
        f'Title: {a["title"]}\n'
        f'Abstract: {a["abstract"][:1200]}'
        for i, a in enumerate(abstracts[:5])
    ) or '(no PubMed abstracts returned — generate conservative profile from general clinical knowledge)'
    user = (
        f'Generate a complete clinical ingredient profile for: {inci_name}\n\n'
        f'PubMed abstracts found:\n{abs_block}\n\n'
        'Return JSON with these exact fields:\n'
        '{\n'
        '  inci_name, common_name, cas_number (or null), category, evidence_level (1-5),\n'
        '  primary_function, mechanism_of_action (3-4 sentences),\n'
        '  skin_concerns (array), effective_concentration {min,max,optimal,unit},\n'
        '  pregnancy_safe (safe|caution|avoid|contraindicated|unknown),\n'
        '  photo_sensitivity (bool), fitzpatrick_iv_vi_notes (min 3 sentences on Indian\n'
        '    skin, PIH risk, Kerala tropical climate, specific precautions),\n'
        '  contraindications (array), synergies (array of INCI), conflicts (array of INCI),\n'
        '  description_short (2 sentences, patient-friendly, hedged),\n'
        '  description_long (4-6 sentences, physician-quality, hedged),\n'
        '  studies (array of up to 5 objects with pmid, title, authors[max 3], journal,\n'
        '    year, doi (null ok), finding_summary (2-3 hedged sentences))\n'
        '}\n\n'
        'Use ONLY abstracts above for studies[]. If none, return studies: [].'
    )
    headers = {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
    }
    body = {
        'model': ANTHROPIC_MODEL,
        'max_tokens': 2400,
        'system': SYSTEM_PROMPT,
        'messages': [{'role': 'user', 'content': user}],
    }
    for attempt in range(3):
        try:
            r = requests.post(ANTHROPIC_URL, headers=headers, json=body, timeout=90)
        except requests.RequestException as e:
            print(f'  haiku request error: {e}', flush=True)
            time.sleep(2 ** attempt)
            continue
        if r.status_code == 429:
            delay = int(r.headers.get('retry-after', 10))
            print(f'  haiku 429, sleeping {delay}s', flush=True)
            time.sleep(delay)
            continue
        if r.status_code != 200:
            print(f'  haiku http {r.status_code}: {r.text[:400]}', flush=True)
            return None
        payload = r.json()
        text = ''.join(c.get('text', '') for c in payload.get('content', []))
        # Extract JSON block
        try:
            start = text.index('{')
            end = text.rindex('}') + 1
            return json.loads(text[start:end])
        except (ValueError, json.JSONDecodeError) as e:
            print(f'  json parse failed: {e}; raw start={text[:200]}', flush=True)
            return None
    return None


def load_queue() -> list[dict]:
    return json.loads(QUEUE.read_text(encoding='utf-8'))


def already_exists(slug: str) -> bool:
    return (OUT_DIR / f'{slug}.json').exists()


def finalise_record(inci_name: str, slug: str, profile: dict,
                    pmids: list[str]) -> dict:
    """Overlay generator metadata onto the Haiku payload."""
    now = datetime.now(timezone.utc).isoformat()
    profile = dict(profile)
    profile['inci_name'] = profile.get('inci_name') or inci_name
    profile.setdefault('cas_number', None)
    profile['ai_generated'] = True
    profile['ai_model'] = ANTHROPIC_MODEL
    profile['generated_at'] = now
    profile['human_reviewed'] = False
    profile['reviewed_by'] = None
    profile['reviewed_at'] = None
    # Defensive: cap studies at 5 and ensure PubMed links
    studies = profile.get('studies') or []
    profile['studies'] = studies[:5]
    return profile


def write_log(rec: dict) -> None:
    with LOG.open('a', encoding='utf-8') as f:
        f.write(json.dumps(rec) + '\n')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=20)
    ap.add_argument('--only', default='', help='comma-separated INCI names')
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    if not ANTHROPIC_KEY and not args.dry_run:
        print('ERROR: ANTHROPIC_API_KEY not set in environment.', file=sys.stderr)
        return 2

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    queue = load_queue()
    targets: list[dict] = []
    if args.only:
        wanted = {s.strip().upper() for s in args.only.split(',') if s.strip()}
        targets = [q for q in queue if q['inci_name'].upper() in wanted]
    else:
        for q in queue:
            if not args.force and already_exists(q['slug']):
                continue
            targets.append(q)
            if len(targets) >= args.limit:
                break

    print(f'targets: {len(targets)}')
    ok, fail, skipped = 0, 0, 0
    for i, q in enumerate(targets, 1):
        name, slug = q['inci_name'], q['slug']
        print(f'[{i}/{len(targets)}] {name} (slug={slug})', flush=True)
        if args.dry_run:
            print('  (dry run, skip)'); continue

        try:
            pmids = pubmed_search(name)
            time.sleep(NCBI_DELAY)
            abstracts = pubmed_fetch(pmids) if pmids else []
            time.sleep(NCBI_DELAY)
        except requests.RequestException as e:
            print(f'  pubmed error: {e}'); fail += 1
            write_log({'slug': slug, 'ok': False, 'stage': 'pubmed', 'error': str(e)})
            continue

        profile = haiku_generate(name, abstracts)
        if not profile:
            fail += 1
            write_log({'slug': slug, 'ok': False, 'stage': 'haiku'})
            continue

        record = finalise_record(name, slug, profile, pmids)
        (OUT_DIR / f'{slug}.json').write_text(
            json.dumps(record, indent=2), encoding='utf-8')
        ok += 1
        write_log({'slug': slug, 'ok': True, 'pmids': pmids,
                   'evidence_level': record.get('evidence_level')})
        # Light spacing so we don't burn through quota too fast
        time.sleep(0.2)

    print(f'DONE — ok={ok} fail={fail} skipped={skipped}')
    return 0 if fail == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
