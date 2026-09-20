// Run with the deployment's environment and database, after moving AnythingLLM
// onto the same host. No credentials are printed. This is an explicit migration,
// never a startup side effect.
import { migrateAnythingConnectorToLocalProxy } from '../src/lib/services/anythingllm-routing';
const id = process.argv[2];
if (!id || process.argv[3] !== '--apply') {
  console.error('Usage: tsx scripts/migrate-anythingllm-direct.ts <connector-uuid> --apply');
  process.exitCode = 1;
} else {
  migrateAnythingConnectorToLocalProxy(id).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error instanceof Error ? error.message : 'Migration failed'); process.exitCode = 1; });
}
