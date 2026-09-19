# Infrastructure status

Compose is a local infrastructure template, not a deployed environment. Choose exact
images compatible with their configured data directories before launch. PostgreSQL
image major releases may change volume layout; review the selected image's migration
notes rather than swapping a major version over an existing volume. Use a tested
supported major with `/var/lib/postgresql/data` or update the mount deliberately.
The quality profile still requires all interpolated values during Compose parsing;
fill every variable even when a service profile is inactive. Redis is loopback-only
for development; production requires ACL/TLS and separate stateful networks.
