---
id: "DOC-OPERATIONS-0006"
title: "Preview host deployment"
status: "proposed"
domain: "operations"
owners: ["Yoshikemolo"]
applies_to: ["ximply-design-studio"]
related: ["DOC-OPERATIONS-0005"]
source: ["Owner preview hosting requirements"]
---

# Preview host deployment

The editor is published as static files on the owner's own host, so the owner can try a
checkpoint in a browser. This is a preview address, not the container contract of
[Container runbooks](runbooks.md), and reaching it is not a release approval: the quality
gate and human review stay where they are.

## What is on the host

| Name | What it is |
| --- | --- |
| Address | `https://xds.ximplicity.es`, a name of its own with its own certificate |
| Host | Ubuntu 24.04 with nginx on 80 and 443, shared with unrelated sites |
| Site file | `/etc/nginx/sites-available/xds.ximplicity.es`, linked into `sites-enabled` |
| Content | `/var/www/xds.ximplicity.es/releases/<commit>`, one directory per published commit |
| What is served | `/var/www/xds.ximplicity.es/current`, a symbolic link to one of them |
| Certificate | Let's Encrypt through certbot, renewed by its own scheduled task |

The site file only answers for its own name, so the sites that share the host are
untouched by a release. Files whose name carries a hash are kept for thirty days,
`index.html` is read again on every visit, an address under `/assets/` that is not there
is a missing file, and every other address is answered with the application shell, which
routes it in the browser.

## Publishing a version

`scripts/deploy-production.ps1` publishes the checkout it is run from:

```
pwsh scripts/deploy-production.ps1
```

It refuses a checkout with changes that are not committed, because a published release
has to be traceable to a commit; `-AllowDirty` overrides that and should stay rare. It
runs the tests and the production build, reads how the site and the sites beside it
answer, uploads the build into a directory named after the commit, moves the link, and
reloads nginx only after nginx accepts its own configuration. It then asks the site for
its page and for the code the page loads, reads the neighbours again and warns if any of
them answers differently. The five most recent releases are kept.

Useful switches: `-SkipTests` when the suite has just been run, `-KeepReleases`,
`-Domain`, `-Server`, `-User` and `-IdentityFile` for another host or key.

## Returning to the release before it

```
pwsh scripts/deploy-production.ps1 -Rollback
```

This moves the link back to the release published before the current one and reloads
nginx. Nothing is deleted, so the two can be swapped as often as needed.

## What this does not do

It does not build a container, does not touch the sites that share the host, does not
change any DNS record and does not publish a version number. A published preview is
evidence that the build runs in a browser at that address, nothing more.
