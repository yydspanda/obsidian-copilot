# Third-Party License Payloads

This directory contains verbatim license and NOTICE texts only for manually copied or derived external material that is actually present in the current source tree.

It is intentionally empty at this baseline: the audited knowledge-system candidates are research references and none of their source code or assets has been incorporated. Do not add their license texts preemptively, because that would incorrectly suggest the corresponding component is included.

When external material is first incorporated:

1. Add its exact upstream license text and any required NOTICE in the same commit as the derived code.
2. Use a project-specific name such as `<project>-<SPDX>.txt`; do not share one generic MIT file across projects with different copyright notices.
3. Add the pinned commit, upstream/local path mapping, copyright, changes, and tests to [`../../THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).
4. Preserve file-level notices and mark modified files with the modification date.
5. Update or remove the payload when the last corresponding derived file leaves the tree.

Package-manager dependencies are not inventoried here. Their distribution licenses must be generated from the production dependency graph as a separate release-compliance step.
