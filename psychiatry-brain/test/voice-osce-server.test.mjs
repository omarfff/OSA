import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdaptivePsychiatryServer } from '../src/adaptive-server.mjs';

async function post(base, path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

test('Voice OSCE API runs start -> voice turn -> finish without persistence', async () => {
  const fakeAsk = async ({ task }) => {
    if (/FORMATIVE PSYCHIATRY OSCE ASSESSMENT/.test(task)) {
      assert.match(task, /VOICE COMMUNICATION OBSERVATIONS/);
      assert.match(task, /do not infer diagnosis or personality from voice/i);
      return { text: 'Formative feedback: communication and risk assessment reviewed.' };
    }
    assert.match(task, /VOICE-ACTOR DELIVERY TARGET/);
    return { text: 'بنام ساعتين بس ومش محتاج أكتر من كده.' };
  };

  const server = createAdaptivePsychiatryServer({ bind: '127.0.0.1', port: 0, ask: fakeAsk });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const started = await post(base, '/osce/start', { stationId: 'acute-mania', difficulty: 'r1' });
    assert.equal(started.status, 200);
    assert.equal(started.body.voice.enabled, true);
    assert.equal(started.body.voice.actorDelivery.rate, 'very_rapid');
    assert.equal(started.body.voice.capabilities.rawAudioPersisted, false);

    const turn = await post(base, '/osce/voice/turn', {
      sessionId: started.body.sessionId,
      transcript: 'How many hours have you been sleeping?',
      wordsPerMinute: 205,
      pauseRatio: 0.08,
      interruptionCount: 4,
      responseLatencyMs: 120
    });
    assert.equal(turn.status, 200);
    assert.match(turn.body.reply, /ساعتين/);
    assert.equal(turn.body.rawAudioPersisted, false);
    assert.equal(turn.body.transcriptPersisted, false);
    assert.match(turn.body.learnerVoiceObservation, /speech pace is fast/i);

    const finished = await post(base, '/osce/voice/finish', {
      sessionId: started.body.sessionId,
      summary: 'Acute manic syndrome; assess risk, organic/substance causes, and need for admission.'
    });
    assert.equal(finished.status, 200);
    assert.equal(finished.body.formative, true);
    assert.equal(finished.body.rawAudioPersisted, false);
    assert.equal(finished.body.transcriptPersisted, false);
    assert.equal(finished.body.voiceCommunication.turns, 1);
    assert.ok(finished.body.voiceCommunication.coaching.targets.length >= 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
