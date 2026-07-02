import fs from "node:fs";
import { c2Rules } from "../src/lib/shield/rules";
import { sanitizeLogField } from "../src/lib/security/log-sanitize";

let failed = 0;

function read(path: string): string {
  return fs.readFileSync(path, "utf8");
}

function check(name: string, ok: boolean): void {
  if (ok) {
    console.log(`PASS: ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL: ${name}`);
  }
}

const requirements = read("litellm/requirements.txt");
check("LiteLLM pin is at the verified patched 1.84.x line", /litellm\[proxy\]==1\.84\.10/.test(requirements));
check("old vulnerable LiteLLM pin is absent", !/litellm\[proxy\]==1\.83\.0/.test(requirements));

const didRoute = read("src/app/api/voice/did/route.ts");
check("D-ID route uses fixed-origin URL construction", /new URL\(pathname, DID_API\)/.test(didRoute));
check("D-ID route validates resource identifiers before path insertion", /DID_ID_RE/.test(didRoute) && /didPath\(/.test(didRoute));
check("D-ID route no longer interpolates agent or stream ids directly into upstream paths", !/`\/agents\/\$\{/.test(didRoute));

const hermesRoute = read("src/app/api/config/hermes-instances/route.ts");
check("Hermes instance paths are resolved through an allowlisted home-directory helper", /resolveHermesHomePath/.test(hermesRoute));
check("Hermes instance route rejects paths outside the operator home", /must be inside this user's home directory/.test(hermesRoute));
check("Hermes instance route checks symlink targets with realpath", /resolveRealHermesHomePath/.test(hermesRoute) && /fs\.realpathSync/.test(hermesRoute));
check("Hermes instance route rejects duplicate saved home paths", /Hermes instance already exists for this home path/.test(hermesRoute) && /SELECT \* FROM hermes_instances WHERE home_path = \?/.test(hermesRoute));

const litellmRoute = read("src/app/api/system/litellm/route.ts");
check("LiteLLM control route uses spawn argv for fallback launch", /spawn\(command,\s*\[/.test(litellmRoute));
check("LiteLLM control route does not shell out through nohup", !/nohup\s+\$\{/.test(litellmRoute));
check("LiteLLM control route does not shell-interpolate lsof kill", !/kill \$\(lsof/.test(litellmRoute));

const logSanitize = read("src/lib/security/log-sanitize.ts");
check("Log sanitizer redacts common bearer token material", /REDACTED/.test(logSanitize) && /Bearer/.test(logSanitize));
check("Log sanitizer captures the auth scheme before redaction", /\(Bearer\|Basic\)/.test(logSanitize));
check("Log sanitizer behavior redacts bearer tokens without literal replacement artifacts",
  sanitizeLogField("Authorization: Bearer abcdefghijklmnopqrstuvwxyz").includes("Bearer [REDACTED]") &&
  !sanitizeLogField("Authorization: Bearer abcdefghijklmnopqrstuvwxyz").includes("$1"));
check("Log sanitizer behavior redacts common sk-* provider keys",
  !sanitizeLogField("sk-or-v1-abcdefghijklmnopqrstuvwxyz123456").includes("sk-or-v1-"));
check("Log sanitizer behavior strips CRLF log forging characters",
  !/[\r\n]/.test(sanitizeLogField("first\r\nsecond")));

check("D-ID route sanitizes upstream error detail before logging/return", /sanitizeLogField/.test(didRoute));
const outboundGate = read("src/lib/shield/outbound-gate.ts");
check("Outbound shield gate sanitizes thrown scanner errors before logging", /sanitizeLogField\(err/.test(outboundGate) || /sanitizeLogField\(err\.message\)/.test(outboundGate));
const chatRoute = read("src/app/api/chat/route.ts");
check("Chat route sanitizes logged upstream/shield errors", /sanitizeLogField\(err\.message\)/.test(chatRoute) && /sanitizeLogField\(error\.message\)/.test(chatRoute));
const sessionWatcher = read("src/lib/services/session-watcher.ts");
check("Session watcher sanitizes logged file and scan errors", /sanitizeLogField\(err\.message\)/.test(sessionWatcher) && !/console\.error\('\[SessionWatcher\][^']*:', err\)/.test(sessionWatcher));

const apiKeyService = read("src/lib/services/api-key-service.ts");
check("API key service documents generated high-entropy bearer tokens", /160-bit random bearer tokens/.test(apiKeyService));
check("API key service preserves stable SHA lookup compatibility", /function hashKey/.test(apiKeyService) && /createHash\('sha256'\)/.test(apiKeyService));

const routingWire = read("src/lib/services/openclaw-routing-wire.ts");
check("OpenClaw routing sidecar documents non-secret integrity fingerprints", /Non-secret integrity fingerprint/.test(routingWire));
check("OpenClaw routing sidecar preserves stable SHA compatibility", /function sha256/.test(routingWire) && /createHash\('sha256'\)/.test(routingWire));

const c2ById = new Map(c2Rules.map((rule) => [rule.id, rule.pattern]));
check("C2 ngrok rule matches normal subdomain URLs", c2ById.get("C2-NGROK")?.test("https://abc.ngrok-free.app/callback") === true);
check("C2 pipedream rule matches normal subdomain URLs", c2ById.get("C2-PIPEDREAM")?.test("https://x.pipedream.net/hook") === true);
check("C2 requestbin rule matches normal subdomain URLs", c2ById.get("C2-REQUESTBIN")?.test("https://abc.requestbin.com/r/test") === true);

const workspaceReader = read("src/lib/services/workspace-reader.ts");
check("Workspace reader opens files before fstat/read", /readRegularFileNoFollow/.test(workspaceReader) && /fs\.fstatSync/.test(workspaceReader));
check("Workspace reader blocks symlink following at open time when supported", /O_NOFOLLOW/.test(workspaceReader));

const infraLogs = read("src/app/api/infrastructure/logs/route.ts");
check("Infrastructure log reader uses fstat on an open descriptor", /fs\.openSync\(filePath/.test(infraLogs) && /fs\.fstatSync\(fd\)/.test(infraLogs));
check("Infrastructure log reader blocks symlink following at open time when supported", /O_NOFOLLOW/.test(infraLogs));

const openclawCostAdapter = read("src/lib/adapters/openclaw-cost-adapter.ts");
check("OpenClaw cost adapter blocks symlink following at open time when supported", /O_NOFOLLOW/.test(openclawCostAdapter));
check("Session watcher blocks symlink following at open time when supported", /O_NOFOLLOW/.test(sessionWatcher));

const tempVerifier = read("scripts/verify-openclaw-cost-adapter.ts");
check("OpenClaw cost verifier uses mkdtempSync for temp roots", /mkdtempSync/.test(tempVerifier));

const rehydrateVerifier = read("scripts/verify-post-deploy-rehydrate.ts");
check("Post-deploy rehydrate verifier parses YAML for exact base URL", /YAML\.parse/.test(rehydrateVerifier) && /api_base === "https:\/\/openrouter\.ai\/api\/v1"/.test(rehydrateVerifier));
check("Post-deploy rehydrate verifier uses mkdtempSync for config temp roots", /mkdtempSync/.test(rehydrateVerifier) && !/path\.join\("\/tmp", `verify-rehydrate-/.test(rehydrateVerifier));

const installProd = read("deploy/install-prod.sh");
check("Production deploy upgrades existing LiteLLM installs to the security pin", /ensure_litellm_version/.test(installProd) && /REQUIRED_LITELLM_VERSION="1\.84\.10"/.test(installProd));

const configService = read("src/lib/services/config-service.ts");
const infrastructureRoute = read("src/app/api/infrastructure/route.ts");
check("Config service exports a provider read-time SSRF guard for legacy rows", /export async function assertSafeProviderHttpFetchTarget/.test(configService));
check("Chat route applies provider read-time SSRF guard before direct provider fetch", /assertSafeProviderHttpFetchTarget/.test(chatRoute) && /redirect:\s*"error"/.test(chatRoute));
check("Infrastructure route applies provider read-time SSRF guard before provider health checks", /assertSafeProviderHttpFetchTarget/.test(infrastructureRoute) && /providerGuard:\s*true/.test(infrastructureRoute));

process.exit(failed === 0 ? 0 : 1);
