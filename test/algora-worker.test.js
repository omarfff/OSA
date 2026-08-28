import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Algora worker discovers through GitHub API and never scrapes Algora', () => {
  const source = fs.readFileSync('tools/algora_worker.py', 'utf8');
  assert.match(source, /https:\/\/api\.github\.com/);
  assert.doesNotMatch(source, /urlopen\([^\n]*algora\.io/);
  assert.match(source, /algora_scraping["']:\s*False/);
  assert.match(source, /pull_request_submitted["']:\s*False/);
  assert.match(source, /payout_received["']:\s*False/);
});

test('Algora worker systemd unit is bounded and unprivileged', () => {
  const unit = fs.readFileSync('ops/systemd/osa-algora-worker.service', 'utf8');
  const timer = fs.readFileSync('ops/systemd/osa-algora-worker.timer', 'utf8');
  assert.match(unit, /User=osa-bounty/);
  assert.match(unit, /NoNewPrivileges=yes/);
  assert.match(unit, /ProtectSystem=strict/);
  assert.match(unit, /MemoryDenyWriteExecute=yes/);
  assert.match(unit, /CapabilityBoundingSet=/);
  assert.match(unit, /MemoryMax=512M/);
  assert.match(timer, /OnUnitActiveSec=30min/);
  assert.match(timer, /RandomizedDelaySec=3min/);
});

test('Algora installer keeps credentials server-side and verifies a real report', () => {
  const installer = fs.readFileSync('ops/install-algora-worker.sh', 'utf8');
  assert.match(installer, /chmod 0640 \/etc\/osa-algora\/worker\.env/);
  assert.doesNotMatch(installer, /install -d[^\n]+\/etc\/osa(?:\s|$)/);
  assert.match(installer, /systemctl enable --now osa-algora-worker\.timer/);
  assert.match(installer, /test -s \/var\/lib\/osa-algora-worker\/latest\.json/);
  assert.doesNotMatch(installer, /GITHUB_TOKEN=/);
});

test('GitHub App authentication exposes only short-lived tokens to the worker', () => {
  const refresh = fs.readFileSync('ops/osa-github-app-token-refresh.sh', 'utf8');
  const unit = fs.readFileSync('ops/systemd/osa-github-app-token.service', 'utf8');
  const dropIn = fs.readFileSync(
    'ops/systemd/osa-algora-worker.service.d/github-app.conf',
    'utf8',
  );

  assert.match(refresh, /openssl dgst -sha256 -sign/);
  assert.match(refresh, /access_tokens/);
  assert.match(refresh, /OSA_ALGORA_GITHUB_TOKEN/);
  assert.doesNotMatch(refresh, /BEGIN (RSA )?PRIVATE KEY/);
  assert.match(unit, /User=root/);
  assert.match(unit, /NoNewPrivileges=yes/);
  assert.match(unit, /ProtectSystem=strict/);
  assert.match(unit, /RuntimeDirectoryPreserve=yes/);
  assert.match(unit, /CapabilityBoundingSet=/);
  assert.match(dropIn, /Requires=osa-github-app-token\.service/);
  assert.match(dropIn, /EnvironmentFile=-\/run\/osa-github-app\/token\.env/);
});
