# Vendored Clawkeeper Scanner

This directory contains the pinned Clawkeeper shell scanner that ClawNex used
before moving host-security checks in-product.

- Upstream: https://github.com/rad-security/clawkeeper
- License: Apache-2.0
- Source commit: fd041dc670e8b8cd0aad00a54fa4251f279fc0d2
- Vendored file: `clawkeeper.sh`
- SHA256: e288603da69f71c6c0c922e6efdae14b652a13e7b850bacfd99aa3af55c32418

ClawNex runs this local copy as a compatibility fallback so host posture scans
do not depend on `clawkeeper.dev`, GitHub raw URLs, or upstream project naming.
The long-term direction is to port the checks into native ClawNex modules under
`src/lib/services/host-security/` while preserving the `/api/security/scan`
response shape and existing database tables.
