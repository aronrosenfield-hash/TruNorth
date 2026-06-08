#!/usr/bin/env python3
"""Scan TruNorth per-company JSON files for biased / editorializing language.

This is the audit tool that produced docs/neutrality-audit/per-company-narratives.md.
Re-run before any launch milestone or major data-source addition.

Expected steady-state output: 37 hits, ALL false positives:
  - 2 CRITICAL: "Shady Records" (Eminem's record label — proper noun)
  - 35 MAJOR: ATF FFL category names containing "Destructive Devices" (27 CFR 478.11)

Any new CRITICAL hit not on that allowlist is a regression — investigate before shipping.

Usage:
    python3 scripts/audit/scan-narrative-bias.py
"""
import json
import os
import re
import glob

# Resolve the company-data dir relative to repo root (this script lives at
# scripts/audit/, two levels deep), so the tool works in any worktree.
HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
COMPANY_DIR = os.path.join(REPO_ROOT, "public", "data", "companies")

# Skip these path-substrings (verbatim from external sources — out of scope
# for editorial cleanup; we're auditing TruNorth's own voice, not third-party
# press releases / Wikipedia / government labels).
SKIP_PATH_FRAGMENTS = (
    "wiki.controversies", "wiki.extract", "wiki.description",
    "secLitigation.sampleReleases", "secLitigation.releases",
    "enriched.secLitigation",
    "cpsc.sampleRecalls", "cpsc.topHazards",
    "doj.recentReleases", "doj.sampleActions",
    "hhsOig.exclusionSample", "hhsOig.sampleActions",
    "osha.sampleRecords", "oshaSevereInjury.sampleRecords",
    "enriched.oshaSevereInjury",
    "asYouSow.lists", "asYouSow.bestScores", "asYouSow.worstScores",
    "courtlistener.cases", "litigation_courtlistener",
    "news.",
    "wikipediaUrl", "logoUrl", "profileUrl", "sourceUrl", "url",
    "keyPeople", "parent", "industry",
    "primaryOffenses",
    "offenseGroups",
    "topHazards", "sampleRecalls",
    "exclusionSample",
)

PATTERNS = [
    # CRITICAL - clearly biased advocacy
    (r"\bshifts? the burden\b", "CRITICAL"),
    (r"\bburden onto\b", "CRITICAL"),
    (r"\bburden on famil(y|ies)\b", "CRITICAL"),
    (r"\bexploits? (workers?|customers?|consumers?)\b", "CRITICAL"),
    (r"\bscrews? over\b", "CRITICAL"),
    (r"\bpreyed upon\b", "CRITICAL"),
    (r"\bpreys? on (workers|consumers|customers|families)\b", "CRITICAL"),
    (r"\bdeserves to know\b", "CRITICAL"),
    (r"\bdeserves better\b", "CRITICAL"),
    (r"\bworst offender\b", "CRITICAL"),
    (r"\bringleader\b", "CRITICAL"),
    (r"\b(extreme|extremist) (right|left|partisan)\b", "CRITICAL"),
    (r"\bradical (right|left|partisan|ideolog)", "CRITICAL"),
    (r"\bideological\w*\b", "CRITICAL"),
    (r"\banti-worker\b", "CRITICAL"),
    (r"\banti-environment\b", "CRITICAL"),
    (r"\banti-consumer\b", "CRITICAL"),
    (r"\b(greedy|shady|shadowy)\b", "CRITICAL"),
    (r"\b(slapped with)\b", "CRITICAL"),
    (r"\b(evades?|evading|evaded) (tax|taxes|regulation|oversight)", "CRITICAL"),
    # MAJOR - editorial adjectives; propose fix, don't auto-edit
    (r"\begregious\b", "MAJOR"),
    (r"\bshameful\b", "MAJOR"),
    (r"\boutrageous\b", "MAJOR"),
    (r"\bappalling\b", "MAJOR"),
    (r"\bharmful\b", "MAJOR"),
    (r"\birresponsible\b", "MAJOR"),
    (r"\bnegligent\b", "MAJOR"),
    (r"\bdestructive\b", "MAJOR"),
    (r"\bdestroy(ed|ing)\b", "MAJOR"),
    (r"\bwipe(s|d) out\b", "MAJOR"),
    (r"\bleaving (workers|customers|families|consumers) without\b", "MAJOR"),
    # MINOR - subjective but defensible
    (r"\bcontroversial\b", "MINOR"),
    (r"\bproblematic\b", "MINOR"),
    (r"\btroubling\b", "MINOR"),
    (r"\bconcerning\b", "MINOR"),
]


def walk_strings(obj, path=""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            new_path = f"{path}.{k}" if path else k
            yield from walk_strings(v, new_path)
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            yield from walk_strings(item, f"{path}[{i}]")
    elif isinstance(obj, str):
        yield (path, obj)


def is_excluded(path):
    return any(frag in path for frag in SKIP_PATH_FRAGMENTS)


def scan():
    findings = []
    files = sorted(glob.glob(os.path.join(COMPANY_DIR, "*.json")))
    total = 0
    for fp in files:
        try:
            with open(fp) as fh:
                data = json.load(fh)
        except Exception:
            continue
        total += 1
        for path, text in walk_strings(data):
            if is_excluded(path):
                continue
            if not text or len(text) > 5000:
                continue
            for pat, sev in PATTERNS:
                m = re.search(pat, text, re.IGNORECASE)
                if m:
                    findings.append((fp, path, sev, pat, m.group(0), text))
                    break
    return total, findings


if __name__ == "__main__":
    total, findings = scan()
    print(f"SCANNED: {total} files")
    print(f"TOTAL FINDINGS: {len(findings)}")
    sev = {}
    for f in findings:
        sev[f[2]] = sev.get(f[2], 0) + 1
    print(f"SEVERITY: {sev}")
    for f in findings:
        fp, path, sev_l, pat, match, text = f
        slug = os.path.basename(fp).replace(".json", "")
        print(f"\n[{sev_l}] {slug} :: {path}")
        print(f"  match: {match!r}")
        print(f"  text: {text[:300]}")
