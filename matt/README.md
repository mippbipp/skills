# matt

Curated copy of [mattpocock/skills](https://github.com/mattpocock/skills), laid out in
upstream's bucket structure.

- **Upstream commit:** `4ae2317` (2026-10-31), package version `1.3.2`
- **Buckets:** `engineering/` (20 skills), `productivity/` (7 skills)
- **Excluded:** `misc/`, `in-progress/`, `deprecated/` (not promoted upstream)

## Syncing

Upstream is the source of truth. To re-sync:

```bash
git clone https://github.com/mattpocock/skills /tmp/matt-skills
cd /tmp/matt-skills && git fetch --unshallow   # full history for diffing
```

Then copy each skill over wholesale, `engineering/<name>` and `productivity/<name>`
matching upstream paths. Do not hand-merge individual files; every file here is a
verbatim copy.

Skills come and go. Upstream retired `resolving-merge-conflicts` on 2026-09-24 with no
replacement. Check `skills/*/README.md` upstream for the current promoted set.

## Upstream conventions worth knowing

- Skills carry `agents/openai.yaml` alongside `SKILL.md` for Codex UI metadata. Harmless
  elsewhere; leave it in place.
- Prose is em-dash free by policy (`CLAUDE.md` upstream forbids reintroducing them).
- The domain-doc convention is `GLOSSARY.md` / `GLOSSARY-MAP.md`. The old
  `CONTEXT.md` / `CONTEXT-MAP.md` names were renamed on 2026-08-15 and appear nowhere here.
