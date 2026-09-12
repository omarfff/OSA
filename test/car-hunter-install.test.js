import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const installer = await fs.readFile(new URL('../ops/car-hunter/install.sh', import.meta.url), 'utf8');

test('Car Hunter installer preserves tools/../src relative module layout', () => {
  assert.match(installer, /\$LIB_DIR\/tools\/car-hunter-autopilot\.mjs/);
  assert.match(installer, /ExecStart=\/usr\/bin\/node \$LIB_DIR\/tools\/car-hunter-autopilot\.mjs/);
  assert.doesNotMatch(installer, /ExecStart=\/usr\/bin\/node \$LIB_DIR\/car-hunter-autopilot\.mjs/);
});

test('Car Hunter installer validates module graph before systemd activation', () => {
  assert.match(installer, /node --check/);
  assert.match(installer, /import\('file:\/\/\$LIB_DIR\/src\/car-hunter\/autopilot\.js'\)/);
  assert.ok(installer.indexOf('node --check') < installer.indexOf('systemctl daemon-reload'));
});
