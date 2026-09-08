import test from 'node:test';
import assert from 'node:assert/strict';
import { OsceSessionStore, buildActorTask, buildExaminerTask, listStations, stationById } from '../src/osce.mjs';

test('ships multiple psychiatry OSCE stations without exposing hidden profiles', () => {
  const stations = listStations();
  assert.ok(stations.length >= 8);
  assert.ok(stations.some((x) => x.id === 'depression-suicide-risk'));
  assert.ok(stations.some((x) => x.id === 'acute-mania'));
  for (const station of stations) {
    assert.ok(station.stem);
    assert.ok(station.opening);
    assert.equal('hidden' in station, false);
    assert.equal('rubric' in station, false);
  }
});

test('OSCE session remains memory-only and hides station internals from start payload', () => {
  const store = new OsceSessionStore();
  const start = store.start({ stationId: 'first-episode-psychosis', difficulty: 'r1' });
  assert.match(start.sessionId, /^[0-9a-f-]{36}$/i);
  assert.equal(start.station.id, 'first-episode-psychosis');
  assert.equal('hidden' in start.station, false);
  assert.equal('rubric' in start.station, false);
  const internal = store.get(start.sessionId);
  assert.equal(internal.transcript.length, 1);
  assert.equal(internal.turns, 0);
});

test('actor prompt stays in role and contains fictional privacy boundary', () => {
  const store = new OsceSessionStore();
  const start = store.start({ stationId: 'acute-mania', difficulty: 'board' });
  const session = store.appendLearner(start.sessionId, 'How have you been sleeping recently?');
  const task = buildActorTask(session);
  assert.match(task, /SIMULATED PSYCHIATRY OSCE ROLEPLAY/);
  assert.match(task, /playing ONLY the patient/);
  assert.match(task, /Never reveal the diagnosis/i);
  assert.match(task, /fictional educational station/i);
  assert.match(task, /How have you been sleeping recently\?/);
});

test('examiner feedback prompt requires demonstrated evidence and safety omissions', () => {
  const store = new OsceSessionStore();
  const start = store.start({ stationId: 'depression-suicide-risk' });
  store.appendLearner(start.sessionId, 'Have you had thoughts of ending your life?');
  store.appendActor(start.sessionId, 'أيوه، فكرت في كده.');
  const task = buildExaminerTask(store.get(start.sessionId), 'Major depressive episode; immediate safety assessment needed.');
  assert.match(task, /Mark only what is demonstrated/i);
  assert.match(task, /safety-critical omissions first/i);
  assert.match(task, /Rubric table/i);
});

test('finished OSCE sessions are deleted from memory', () => {
  const store = new OsceSessionStore();
  const start = store.start({ stationId: 'ocd-assessment' });
  store.finish(start.sessionId);
  assert.throws(() => store.get(start.sessionId), /osce_session_not_found/);
});

test('invalid station and difficulty fail closed', () => {
  const store = new OsceSessionStore();
  assert.throws(() => store.start({ stationId: 'not-a-station' }), /station_invalid/);
  assert.throws(() => store.start({ stationId: 'acute-mania', difficulty: 'expert-god-mode' }), /difficulty_invalid/);
});

test('station registry includes capacity and delirium safety stations', () => {
  assert.ok(stationById('capacity-refusal'));
  assert.ok(stationById('delirium-vs-psychosis'));
});
