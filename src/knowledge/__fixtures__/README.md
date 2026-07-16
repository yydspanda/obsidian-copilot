# Knowledge Contract Fixtures

These fixtures are deterministic, synthetic inputs for the Windows-only knowledge contracts. Native Windows paths and reserved device names are encoded as JSON strings so the repository remains checkout-safe on Windows.

- `source-text-cases.json`: LF, CRLF, BOM, Chinese, and emoji source text.
- `windows-path-cases.json`: Vault paths, drive paths, UNC paths, collisions, and reserved names.
- `pdf-locator.json`: a parsed-page fixture; it is not a complete PDF parser fixture.
- `okf-round-trip.json`: a minimal OKF concept with a source-backed citation.
- `file-lock-cases.json`: error codes for the recoverable Vault adapter planned in Slice 1B.

The file-lock cases are pure adapter inputs. Real Windows sharing-violation integration tests belong in the Windows test Vault rather than the platform-independent domain layer.
