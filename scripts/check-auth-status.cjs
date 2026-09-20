#!/usr/bin/env node
// Read response on stdin; never echo its potentially sensitive contents.
const fs = require('node:fs');
try {
  if (process.argv[2] !== '200') throw new Error('HTTP status is not 200');
  const data = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (!data || ['rbacEnabled', 'needsSetup', 'authenticated'].some(key => typeof data[key] !== 'boolean')) {
    throw new Error('Invalid auth status schema');
  }
  console.log('Authentication endpoint ready');
} catch (error) {
  console.error(`Authentication readiness check failed: ${error.message}`);
  process.exitCode = 1;
}
