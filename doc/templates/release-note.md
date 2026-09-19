# Release-note authoring template

Copy a versioned source note under doc/changelog, allocate an unused REL-NNNN ID,
and preserve the metadata profile. Change the filename and version together. Set
an ISO date, summary and honest capability_status. Set breaking_changes to true
only when the Breaking changes section contains migration instructions.

Required body structure:

```markdown
# VERSION — Summary

## Breaking changes

None.

## New features

None.

## Improvements

None.

## Fixes

None.

## Security

None.

## Engineering

- Describe the actual engineering change and its limits.
```

For a breaking entry: `- Describe the incompatibility. Migration: concrete steps.`
Use one bullet per entry. Regenerate with `python3 harness/changelog.py --write`.
Read the [authoritative contract](../product/footer-and-changelog.md).
