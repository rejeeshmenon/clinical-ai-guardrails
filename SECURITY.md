# Security and privacy notes for this extract

This repository was assembled from three private production codebases by copying individual files, never by cloning or forking. It has a fresh git history. Before the first push, two scanners were run over every file and over every blob in the history:

- a secret scanner (gitleaks when available, plus an independent regular-expression pass for API keys, private keys, connection strings, `password=`/`secret=`/`token=` assignments, `define('..._SECRET', ...)` constants and payment or form tokens);
- a PHI scanner for Indian mobile numbers, Aadhaar and ABHA number shapes, e-mail addresses, the medical-record-number pattern used in the source EMR, and a private list of real patient and staff names.

## Values that are intentionally present

The redaction and sanitisation tests need fake identifiers to prove that identifiers are removed. Every such value is synthetic and appears only in test files, in the proof script, or in code comments:

- phone numbers `9845012345`, `9198450123`, `9198765432` and `9876543210`;
- Aadhaar-shaped strings `1234 5678 9012`, `1234-5678-9012`, `2222-2222-2222`;
- e-mail addresses at `example.com`, `example.invalid` and the placeholders `a@b.com`, `dr@...`;
- one synthetic date of birth in the proof script (`1988-04-12`) attached to an invented patient ("Priya Nair") whose only purpose is to be redacted;
- the two public crisis helplines quoted in the escalation table (iCall, AASRA).

Nothing in this repository identifies a real patient, clinician, or clinic staff member.

## What is deliberately not here

- No `.env` files, keys, hostnames, IP addresses, bucket names or database URLs from production.
- No route handlers, database access layers or infrastructure code (they would reveal deployment details and are not needed to read the guardrails).
- No production data, logs, screenshots or exports.
- The full Priya system prompt (it contains clinic telephone numbers and pricing); only its safety sections are reproduced.

## Reporting

If you find anything in this repository that you believe identifies a real person or exposes a credential, open an issue with the file path only (do not paste the content) or contact the author directly.
