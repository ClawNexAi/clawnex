#!/usr/bin/env node
// Use the exact artifact's dependency, never ancestor module resolution.
const path = require('node:path');
let db;
try {
  if (!process.argv[2]) throw new Error('Usage: check-native-runtime.cjs <artifact-directory>');
  const Database = require(path.resolve(process.argv[2], 'node_modules/better-sqlite3'));
  db = new Database(':memory:');
  if (db.prepare('SELECT 1 AS ok').get().ok !== 1) throw new Error('SQLite query failed');
  console.log(`SQLite ready: Node ${process.version}, ABI ${process.versions.modules}`);
} catch (error) {
  console.error(`SQLite runtime check failed (Node ${process.version}, ABI ${process.versions.modules}): ${error.message}`);
  console.error('Reinstall dependencies and rebuild the standalone artifact with the service Node runtime before restarting.');
  process.exitCode = 1;
} finally {
  if (db) db.close();
}
