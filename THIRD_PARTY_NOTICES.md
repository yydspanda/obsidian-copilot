# Third-Party Notices

Last updated: 2026-07-16

## Scope

This file tracks source code, tests, documentation, fixtures, and assets that are manually copied or derived from an external project into this repository. Ordinary package-manager dependencies remain tracked by `package.json` and `package-lock.json`; a distribution-level inventory of the production dependency graph is a separate release-compliance requirement.

As of this revision, no source code or assets from the five research candidates below have been copied or adapted into this repository. Design references, behavior research, and independent implementations do not mean that candidate code is incorporated or distributed.

## Audited Candidates — Not Incorporated

| Project                                                                                                                                         | Audited commit                             | License at audited source                                    | Current status                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| [atomicstrata/llm-wiki-compiler](https://github.com/atomicstrata/llm-wiki-compiler/tree/6963a7f8374282de5d4084a324be69b50f62a32d)               | `6963a7f8374282de5d4084a324be69b50f62a32d` | MIT                                                          | Not incorporated; research/reference only                                                        |
| [nashsu/llm_wiki](https://github.com/nashsu/llm_wiki/tree/38f4cb1dc8757059be618af215d14a5bebbf820d)                                             | `38f4cb1dc8757059be618af215d14a5bebbf820d` | GPL-3.0                                                      | Not incorporated; research/reference only                                                        |
| [AgriciDaniel/claude-obsidian](https://github.com/AgriciDaniel/claude-obsidian/tree/cb93ff6d82f9c35a08bf6010e7fac36dfddc827b)                   | `cb93ff6d82f9c35a08bf6010e7fac36dfddc827b` | MIT at repository root; path-level exceptions require review | Not incorporated; research/reference only                                                        |
| [GoogleCloudPlatform/knowledge-catalog](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/d44368c15e38e7c92481c5992e4f9b5b421a801d) | `d44368c15e38e7c92481c5992e4f9b5b421a801d` | Apache-2.0 for the OKF specification                         | Specification independently implemented; no source, examples, or specification text incorporated |
| [getzep/graphiti](https://github.com/getzep/graphiti/tree/5e2be0faf7038a5b40e700d757b2c337e96b3a05)                                             | `5e2be0faf7038a5b40e700d757b2c337e96b3a05` | Apache-2.0                                                   | Not incorporated; research/reference only                                                        |

The detailed Copy / Port / Reference decisions are maintained in [`designdocs/OPEN_SOURCE_REUSE_PLAN.md`](./designdocs/OPEN_SOURCE_REUSE_PLAN.md).

## Incorporation Record Template

Add one record in the same commit that first introduces external material:

```text
Project:
Repository:
Pinned commit:
Upstream paths:
Local paths:
Upstream copyright:
SPDX license identifier:
Modification date and summary:
Tests carried, ported, or rewritten:
License file under third_party/licenses/:
Upstream NOTICE file, if any:
```

Each derived local source file should also identify the pinned repository commit and upstream path, retain required copyright and license statements, state that it was modified, and point back to this notice.

## Distribution Gate

The current plugin release workflow publishes `main.js`, `manifest.json`, and `styles.css`. Before distributing a build that incorporates externally copied material, the release must also make this notice, the project license, all applicable third-party license/NOTICE texts, and an inventory of actually bundled production dependencies available to recipients. Keeping notice files only in the source repository is not sufficient for that release gate.
