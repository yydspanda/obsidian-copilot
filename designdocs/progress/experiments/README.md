# Experiment Evidence Log

Create one `YYYY-MM.md` file per month and append one block for every model, data, configuration,
quality, or performance experiment. Ordinary deterministic test runs belong in progress
verification, not here.

Do not record secrets, raw private data, or unredacted prompts. Hash the exact canonical bytes used
for configuration and data. For a deliberately model-free experiment, record `Model: none` and
still hash the canonical model/config declaration so the run remains reproducible.
If the provider does not expose an immutable model revision, record it as unavailable and retain
the requested and observed model names; do not substitute a release date for a revision.

```markdown
## Experiment `EXP-20260826-001`

- Task ID: `PK-PERF-LARGE-VAULT`
- Upstream commit: `0123456789abcdef0123456789abcdef01234567`
- Model: `provider/model@immutable-revision`
- Model config hash: `sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`
- Data hash: `sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`
- Hardware: `Windows 11; CPU model; RAM; GPU or none`
- Command: `the exact reproducible command`
- Metrics: `metric_name=value unit; sample_count=n`
```

The progress validator rejects incomplete blocks, malformed hashes/commits, duplicate experiment
IDs, unknown Task IDs, pending tasks in monthly archives, and month files whose dated records do not
match their filename.
