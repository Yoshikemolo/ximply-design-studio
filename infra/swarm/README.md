# Swarm deployment contract

The stack is deliberately not exposed to the Internet before an ingress/TLS and
production target are supplied. Provision Keycloak, PostgreSQL, Redis and object
storage using the selected persistent services; local Compose provides development
counterparts. Set every image to an immutable digest, provision named external Docker
secrets and configure a verified ingress to web/api/hub. Service implementations must
support the documented *_FILE secrets contract before deployment. No build occurs
inside Swarm. A blank image or missing secret must fail deployment.

GPU workers require a target-specific node/driver/resource allocation overlay after
hardware discovery. Replicated workers do not share arbitrary local file volumes;
shared environments use the object-store adapter. Database/IAM/analysis placement,
backups and failover are separate deployment decisions, not silently managed by this
application stack. Run migrations as a reviewed one-shot task. No healthcheck is
invented for nonexistent endpoints: add real healthchecks with the service images.
