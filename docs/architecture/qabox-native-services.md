# QABox native application services

Operator direction, 2026-09-21: install applications on the host by default. Do not introduce containers or an alternative inference path without explicit discussion. Sandcastle is the deliberate exception: its agent sandbox requires Docker. Existing NetBird infrastructure is outside this migration.

## AnythingLLM

- Application: `/home/reoclaw/anythingllm/native`, existing version 1.16.1 and its built frontend/dependencies, extracted from the previously installed pinned image. It executes directly on the host; there is no Docker runtime dependency.
- Runtime: the application's existing Node 18.20.8 binary is local to `native/bin/node`. System Node 24 and the other applications are unchanged. Upgrade this runtime and rebuild native modules together in a separate reviewed maintenance change.
- Data and existing credentials: `/home/reoclaw/anythingllm/storage`. The native server's `storage` and `.env` link to this directory.
- User services: `anythingllm.service`, `anythingllm-collector.service`; native listeners `127.0.0.1:19322` and `127.0.0.1:19323`.
- `anythingllm-tailnet.socket` and `.service` preserve the existing UI address `http://100.123.63.73:19322` using systemd-socket-proxyd, consistent with the existing Hermes/OmniRoute arrangement.
- The packaged server and collector did not expose bind-address settings. Their listen calls are restricted to loopback in the host copy. Preserve/review that restriction when updating upstream code.
- Chat provider: LiteLLM, base `http://127.0.0.1:4001/v1`. The dashboard connector relay is removed. Original Generic OpenAI/OmniRoute settings remain available for restore.

## Buzz

- Application: `/home/reoclaw/buzz-relay/native`. Existing Buzz executable and web assets were preserved from the installed pinned image and execute as a host process.
- User services: `buzz-relay.service`, `buzz-redis.service`, `buzz-minio.service`, plus `buzz-tailnet.socket` and `.service` for the existing `http://100.123.63.73:19321` address.
- Relay main listener: `127.0.0.1:19321`; owner public key and relay private identity are preserved.
- PostgreSQL 17: host package from the official PGDG repository, system service/cluster `17/main`, port 5432. Logical dump/restore preserves the database; all 66 public table row counts were compared before cutover.
- Redis: native 7.4.11 built from official tag commit `aaf0ce63b3239f4b51f86ca1da8711b055721993`, port `127.0.0.1:19326`, existing password and data preserved. Ubuntu's 7.0 package cannot read the existing RDB format and is not used by Buzz.
- MinIO: existing binary, data, and credentials; API `127.0.0.1:19324`, console `127.0.0.1:19325`.
- Git repositories, Redis, and object data: `native/data/`. Environment files and Redis configuration are permission 0600. Do not print them.
- Upstream Buzz binds health/metrics to wildcard interfaces on ports 19327/19328. QA's existing firewall blocks public access; the main application and storage services bind loopback. This differs from the old Docker network isolation and must be considered if changing firewall policy.

## Recovery and updates

Consistent pre-migration data backups are at `migration-backup-20260921` under each application's directory, permission 0700. Keep these until the operator accepts the migration. Do not run an old container against native services' live data or use `docker compose up` to manage these applications. Native services are managed with `systemctl --user`; PostgreSQL uses its system service.

An explicit ClawNex registration migration is documented in [anythingllm-routing.md](anythingllm-routing.md). It preserves the original chat provider recovery fields while removing the retired inference relay credential. Neither migration changes Sandcastle or NetBird.
