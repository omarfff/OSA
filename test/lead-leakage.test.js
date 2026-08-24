import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHtml, isPrivateIp } from '../tools/lead-leakage-audit.mjs';

test('scores a weak lead page higher', () => {
  const weak = analyzeHtml('<html><title>Property Co</title><p>Welcome</p></html>', { latencyMs: 3000, status: 200 });
  const strong = analyzeHtml(`<html><title>Property Co</title><a href="tel:+966500000000">Call</a><a href="https://wa.me/966500000000">WhatsApp</a><form></form><a href="https://cal.com/demo">Book</a><p>Contact us</p><script src="https://client.crisp.chat"></script></html>`, { latencyMs: 300, status: 200 });
  assert.ok(weak.opportunityScore > strong.opportunityScore);
  assert.ok(weak.findings.some(x => x.code === 'NO_LEAD_FORM'));
  assert.equal(strong.signals.whatsapp, true);
});

test('caps opportunity score', () => {
  const result = analyzeHtml('<html></html>', { latencyMs: 5000, status: 503 });
  assert.ok(result.opportunityScore <= 100);
});

test('blocks private and documentation IP ranges', () => {
  for (const ip of ['127.0.0.1','10.1.2.3','172.20.1.1','192.168.1.2','169.254.1.1','192.0.2.1','198.51.100.1','203.0.113.1','::1','fc00::1','fe80::1','2001:db8::1']) assert.equal(isPrivateIp(ip), true, ip);
  assert.equal(isPrivateIp('1.1.1.1'), false);
});
