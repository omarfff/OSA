import { randomUUID } from 'node:crypto';

const DIFFICULTIES = new Set(['foundation', 'r1', 'board']);

const STATIONS = Object.freeze([
  {
    id: 'depression-suicide-risk',
    title: 'Depression with suicide-risk assessment',
    actor: 'patient',
    publicStem: 'You are seeing a patient in the psychiatric emergency setting who has become increasingly withdrawn and distressed. Take a focused psychiatric history and assess immediate risk.',
    opening: 'مش عارف أبدأ منين... أنا تعبان بقالي فترة ومش قادر أكمل كده.',
    hidden: {
      profile: '28-year-old adult with 6 weeks of pervasive low mood, anhedonia, insomnia, guilt, poor concentration and reduced appetite. Has active suicidal ideation, has considered an overdose, has access to medication at home, no attempt today, one previous interrupted attempt two years ago, limited current protective factors, no manic history, no psychotic symptoms, no intoxication.',
      style: 'Low volume, slowed responses, ashamed, initially vague about suicidality but answers directly if asked calmly and specifically.'
    },
    rubric: [
      ['engagement', 'Introduces self, explains purpose, establishes rapport and privacy', 2],
      ['depression', 'Elicits core depressive symptoms, duration and functional impact', 3],
      ['suicidality', 'Asks directly about suicidal thoughts, plan, intent, access to means and preparatory behavior', 5],
      ['history-risk', 'Asks about previous attempts/self-harm and major dynamic/static risk factors', 3],
      ['protective', 'Explores supports, reasons for living and protective factors', 2],
      ['mimics', 'Screens for mania, psychosis, substance use and relevant medical contributors', 3],
      ['closure', 'Summarizes, communicates immediate safety concern and appropriate escalation', 2]
    ],
    domains: ['risk', 'mood', 'mse', 'emergency']
  },
  {
    id: 'acute-mania',
    title: 'Acute mania interview',
    actor: 'patient',
    publicStem: 'A patient has been brought by family because of marked behavioral change and very little sleep. Conduct a focused psychiatric interview and identify the key clinical priorities.',
    opening: 'أنا ممتاز جدًا يا دكتور، أحسن من أي وقت! بصراحة أهلي هم اللي محتاجين علاج مش أنا.',
    hidden: {
      profile: '31-year-old adult with 8 days of markedly reduced need for sleep, pressured speech, grandiosity, excessive spending, multiple unrealistic business plans, irritability when challenged and impaired judgment. No clear substance trigger. Poor insight. Has become verbally aggressive but no weapon use or current suicidal intent.',
      style: 'Pressured, expansive, distractible, overfamiliar, interrupts, becomes mildly irritable if repeatedly contradicted.'
    },
    rubric: [
      ['engagement', 'Maintains structure and rapport despite pressure/distractibility', 2],
      ['mania', 'Elicits decreased need for sleep, mood change, energy/activity, grandiosity, speech/thought change and risky behavior', 5],
      ['impairment', 'Clarifies duration, functional impairment and need for admission-level care', 2],
      ['risk', 'Assesses aggression, impulsivity, vulnerability, financial/sexual risk and self-harm', 4],
      ['differential', 'Screens for substances, medications, medical causes, psychosis and prior mood episodes', 4],
      ['insight', 'Assesses insight, judgment and willingness to accept care', 2],
      ['closure', 'Summarizes and proposes safe immediate escalation', 1]
    ],
    domains: ['mood', 'risk', 'mse', 'emergency', 'psychopharmacology']
  },
  {
    id: 'first-episode-psychosis',
    title: 'First-episode psychosis',
    actor: 'patient',
    publicStem: 'A young adult has become suspicious, socially withdrawn and difficult to engage. Take a focused history and perform a conversational mental-state assessment.',
    opening: 'قبل ما نتكلم... مين قالك عني؟ وإنت بتسجل الكلام ده فين؟',
    hidden: {
      profile: '23-year-old adult with three months of social withdrawal and functional decline, persecutory delusions, auditory hallucinations commenting, thought insertion, poor self-care and occasional cannabis use. No clear manic syndrome. No current command hallucinations to harm self/others, but has confronted a neighbor because of persecutory beliefs.',
      style: 'Guarded, suspicious, scans room, answers short questions, becomes more cooperative if the interviewer validates distress without endorsing the belief.'
    },
    rubric: [
      ['engagement', 'Uses non-confrontational engagement and does not validate delusional content as fact', 3],
      ['psychosis', 'Elicits delusions, hallucinations and passivity/thought-interference phenomena', 5],
      ['negative-function', 'Explores negative symptoms, self-care and functional decline', 2],
      ['risk', 'Assesses command phenomena, fear-driven aggression, self-neglect, suicide and vulnerability', 4],
      ['organic-substance', 'Screens substances, medications and medical/neurological causes', 3],
      ['mood', 'Assesses mood episodes and affective-psychosis relationship', 2],
      ['collateral', 'Recognizes need for collateral information and physical/medical work-up', 1]
    ],
    domains: ['psychosis', 'risk', 'mse', 'formulation']
  },
  {
    id: 'alcohol-withdrawal',
    title: 'Alcohol withdrawal / medical emergency recognition',
    actor: 'patient',
    publicStem: 'A patient with heavy alcohol use is anxious, tremulous and unable to settle after stopping alcohol. Assess the situation and identify urgent priorities.',
    opening: 'إيدي بتترعش وقلبي بيجري... أنا بس محتاج حاجة تهديني وأنام.',
    hidden: {
      profile: '45-year-old adult with long-standing heavy daily alcohol use, last drink about 12 hours ago, tremor, sweating, nausea, anxiety and insomnia. Previous withdrawal seizure four years ago. No current delirium, but risk of progression is clinically important. Poor oral intake.',
      style: 'Anxious, uncomfortable, mildly tremulous, asks repeatedly for something to calm down.'
    },
    rubric: [
      ['timeline', 'Establishes alcohol quantity/pattern, last drink and withdrawal timeline', 4],
      ['severity', 'Assesses autonomic symptoms, hallucinations, orientation/attention and seizure history', 4],
      ['risk', 'Recognizes risk of severe withdrawal, seizures and delirium and need for medical monitoring', 4],
      ['comorbidity', 'Screens other substances, injuries, medical illness, nutrition and psychiatric risk', 3],
      ['management', 'Prioritizes urgent medical assessment, withdrawal protocol, thiamine/nutrition and senior escalation', 4],
      ['communication', 'Explains urgency without judgment', 1]
    ],
    domains: ['addiction', 'emergency', 'risk', 'mse']
  },
  {
    id: 'delirium-vs-psychosis',
    title: 'Delirium versus primary psychosis',
    actor: 'patient',
    publicStem: 'An older inpatient has become frightened and is reporting unusual visual experiences. Assess the mental state and determine whether this could represent an acute organic syndrome.',
    opening: 'في ناس واقفة عند الشباك... مش شايفهم؟ هم كانوا هنا من شوية.',
    hidden: {
      profile: '68-year-old inpatient with acute onset over one day, fluctuating attention, disorientation, visual hallucinations and disturbed sleep-wake cycle in the context of infection and recent medication changes. No prior psychiatric history.',
      style: 'Distractible, intermittently drowsy, loses track of questions, gives inconsistent orientation answers.'
    },
    rubric: [
      ['onset-course', 'Clarifies acute onset, fluctuation and baseline cognition', 3],
      ['attention', 'Actively assesses attention, orientation and level of consciousness', 4],
      ['perception', 'Characterizes perceptual disturbance without assuming primary psychosis', 2],
      ['medical', 'Elicits infection, medication, metabolic, pain, urinary/constipation and other medical precipitants', 4],
      ['risk', 'Assesses falls, pulling lines, agitation, vulnerability and capacity/safety', 3],
      ['management', 'Prioritizes medical cause, investigations, environmental measures and urgent senior/medical review', 4]
    ],
    domains: ['geriatric', 'mse', 'emergency', 'risk']
  },
  {
    id: 'capacity-refusal',
    title: 'Decision-making capacity and treatment refusal',
    actor: 'patient',
    publicStem: 'A patient is refusing an important medical treatment. Assess decision-making capacity for this specific decision and communicate your conclusion carefully.',
    opening: 'أنا قلت مش هاخد العلاج ده. ده قراري ومحدش له عندي حاجة.',
    hidden: {
      profile: '52-year-old adult with a chronic psychotic disorder who currently believes the proposed medical treatment contains a tracking device. Can repeat basic facts but cannot use/weigh the genuine benefits and risks because the delusional belief dominates the decision. Capacity is decision- and time-specific.',
      style: 'Calm but firm. Can engage respectfully. Becomes suspicious if the interviewer argues directly about the delusion.'
    },
    rubric: [
      ['specific-decision', 'Defines the exact decision and checks that adequate information was provided', 2],
      ['understand', 'Assesses ability to understand relevant information', 3],
      ['retain', 'Assesses ability to retain information long enough to decide', 2],
      ['use-weigh', 'Assesses ability to use/weigh benefits, risks and alternatives', 4],
      ['communicate', 'Assesses ability to communicate a stable choice', 2],
      ['cause-support', 'Explores mental-state factors affecting capacity and attempts supported decision-making', 3],
      ['law-ethics', 'States that capacity is decision/time specific and distinguishes capacity from mere disagreement', 4]
    ],
    domains: ['law', 'mse', 'psychosis', 'risk']
  },
  {
    id: 'ocd-assessment',
    title: 'Obsessive-compulsive disorder assessment',
    actor: 'patient',
    publicStem: 'A patient reports spending a large part of the day on repetitive routines that are causing distress and lateness. Take a focused psychiatric history.',
    opening: 'عارف إن اللي بعمله زيادة... بس لو ما عملتوش بحس إن حاجة وحشة جدًا هتحصل.',
    hidden: {
      profile: '26-year-old adult with contamination obsessions and washing/checking compulsions occupying three hours daily, marked distress and preserved insight. Avoids public transport. No psychosis or manic syndrome. Mild depressive symptoms secondary to impairment, no current suicidality.',
      style: 'Embarrassed but insightful, gives clearer details after normalization and nonjudgmental questions.'
    },
    rubric: [
      ['obsessions', 'Clarifies intrusive, unwanted thoughts/images/urges and associated distress', 4],
      ['compulsions', 'Clarifies repetitive behaviors/mental acts, rules and feared consequences', 4],
      ['time-impairment', 'Quantifies time burden, avoidance and functional impairment', 3],
      ['insight', 'Assesses insight and resistance without misclassifying obsession as delusion', 2],
      ['comorbidity-risk', 'Screens depression, suicide risk, tics, substance use and relevant differentials', 3],
      ['management', 'Identifies evidence-based psychological and medication treatment principles appropriately', 4]
    ],
    domains: ['anxiety_trauma', 'mse', 'risk', 'psychotherapy']
  },
  {
    id: 'parent-child-adhd',
    title: 'Collateral interview: possible ADHD',
    actor: 'parent',
    publicStem: 'You are speaking with a parent about a school-age child who is struggling academically and behaviorally. Take a focused developmental and psychiatric collateral history.',
    opening: 'المدرسة كل شوية تشتكي إنه مش بيقعد مكانه ومش بيركز، وأنا مش عارفة ده دلع ولا في مشكلة.',
    hidden: {
      profile: 'Parent of a 9-year-old with longstanding inattention, hyperactivity and impulsivity present at home and school since early primary years, with academic and peer impairment. No clear episodic mood syndrome. Sleep is somewhat irregular. No developmental regression. Teacher reports corroborate symptoms.',
      style: 'Concerned, somewhat guilty, appreciates concrete and non-blaming questions.'
    },
    rubric: [
      ['symptoms', 'Elicits inattention and hyperactivity/impulsivity examples', 4],
      ['settings-onset', 'Establishes onset, persistence and symptoms across more than one setting', 4],
      ['impairment', 'Clarifies academic, family and peer impairment', 3],
      ['development', 'Takes developmental, language, learning, sleep and medical history', 3],
      ['differential', 'Screens anxiety, mood, trauma, autism traits, learning problems and environmental contributors', 3],
      ['collateral', 'Seeks teacher/school information and explains multi-informant assessment', 3]
    ],
    domains: ['child', 'mse', 'formulation', 'psychotherapy']
  }
]);

function publicStation(station) {
  return {
    id: station.id,
    title: station.title,
    actor: station.actor,
    stem: station.publicStem,
    opening: station.opening,
    totalPoints: station.rubric.reduce((n, x) => n + x[2], 0),
    domains: [...station.domains]
  };
}

export function listStations() {
  return STATIONS.map(publicStation);
}

export function stationById(id) {
  return STATIONS.find((x) => x.id === id) || null;
}

function trimMessage(value, max = 2000) {
  const text = String(value || '').trim();
  if (!text) throw new Error('message_required');
  if (text.length > max) throw new Error('message_too_long');
  return text;
}

function cleanDifficulty(value) {
  const difficulty = String(value || 'r1').toLowerCase();
  if (!DIFFICULTIES.has(difficulty)) throw new Error('difficulty_invalid');
  return difficulty;
}

function renderTranscript(transcript) {
  return transcript.map((turn) => `${turn.role === 'learner' ? 'DOCTOR' : 'ACTOR'}: ${turn.text}`).join('\n');
}

export class OsceSessionStore {
  constructor({ ttlMs = 45 * 60 * 1000, maxTurns = 40 } = {}) {
    this.ttlMs = ttlMs;
    this.maxTurns = maxTurns;
    this.sessions = new Map();
  }

  cleanup(now = Date.now()) {
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(id);
    }
  }

  start({ stationId = 'random', difficulty = 'r1' } = {}) {
    this.cleanup();
    const station = stationId === 'random'
      ? STATIONS[Math.floor(Math.random() * STATIONS.length)]
      : stationById(stationId);
    if (!station) throw new Error('station_invalid');
    const session = {
      id: randomUUID(),
      station,
      difficulty: cleanDifficulty(difficulty),
      transcript: [{ role: 'actor', text: station.opening }],
      createdAt: Date.now(),
      expiresAt: Date.now() + this.ttlMs,
      turns: 0
    };
    this.sessions.set(session.id, session);
    return {
      sessionId: session.id,
      expiresAt: new Date(session.expiresAt).toISOString(),
      difficulty: session.difficulty,
      station: publicStation(station)
    };
  }

  get(sessionId) {
    this.cleanup();
    const session = this.sessions.get(String(sessionId || ''));
    if (!session) throw new Error('osce_session_not_found');
    return session;
  }

  appendLearner(sessionId, message) {
    const session = this.get(sessionId);
    if (session.turns >= this.maxTurns) throw new Error('osce_turn_limit');
    const text = trimMessage(message);
    session.transcript.push({ role: 'learner', text });
    session.turns += 1;
    session.expiresAt = Date.now() + this.ttlMs;
    return session;
  }

  appendActor(sessionId, message) {
    const session = this.get(sessionId);
    const text = trimMessage(message);
    session.transcript.push({ role: 'actor', text });
    session.expiresAt = Date.now() + this.ttlMs;
    return session;
  }

  finish(sessionId) {
    const session = this.get(sessionId);
    this.sessions.delete(session.id);
    return session;
  }
}

export function buildActorTask(session) {
  const station = session.station;
  const transcript = renderTranscript(session.transcript);
  return `SIMULATED PSYCHIATRY OSCE ROLEPLAY. This is a fictional educational station.\n\nYou are playing ONLY the ${station.actor}. Never act as examiner, teacher, or assistant. Never reveal the diagnosis, hidden profile, rubric, expected answers, or that you are following a script. Stay internally consistent with the hidden profile. Do not volunteer every fact at once: disclose information naturally when the doctor asks an appropriate question. If the doctor asks a vague question, answer as a real patient/parent would. If asked directly about suicide, violence, substances, psychotic experiences or other sensitive symptoms, answer clearly according to the hidden profile. Do not create new major symptoms, medical history, medications, tests, or risk facts beyond the profile.\n\nLanguage: default to natural Egyptian Arabic unless the doctor speaks English, in which case reply in clear conversational English. Keep each response concise (usually 1-4 sentences).\nDifficulty: ${session.difficulty}.\nActor style: ${station.hidden.style}\nHidden case profile: ${station.hidden.profile}\n\nConversation so far:\n${transcript}\n\nRespond ONLY with the actor's next spoken reply to the doctor's last question or statement.`;
}

function rubricText(station) {
  return station.rubric.map(([id, label, max]) => `- ${id}: ${label} (0-${max})`).join('\n');
}

export function buildExaminerTask(session, learnerSummary = '') {
  const transcript = renderTranscript(session.transcript);
  const summary = String(learnerSummary || '').trim().slice(0, 3000);
  return `FORMATIVE PSYCHIATRY OSCE ASSESSMENT. This is an educational simulation, not an official examination.\n\nStation: ${session.station.title}\nDifficulty: ${session.difficulty}\nHidden profile: ${session.station.hidden.profile}\n\nRubric:\n${rubricText(session.station)}\n\nTranscript:\n${transcript}\n\nLearner final summary/plan (if supplied):\n${summary || '(not supplied)'}\n\nMark only what is demonstrated in the transcript or final summary. Do not award credit for assumed questions. Produce:\n1. Total score: X/${session.station.rubric.reduce((n, x) => n + x[2], 0)} and percentage.\n2. Rubric table: domain | score/max | evidence from performance.\n3. Critical omissions, with safety-critical omissions first.\n4. Communication/MSE technique feedback.\n5. A concise model approach in the optimal sequence.\n6. Three targeted retrieval questions for the learner's weakest areas.\nUse Arabic explanation with key psychiatric English terminology.`;
}

export function osceMetadata(session) {
  return {
    sessionId: session.id,
    station: publicStation(session.station),
    difficulty: session.difficulty,
    turns: session.turns,
    expiresAt: new Date(session.expiresAt).toISOString(),
    persisted: false
  };
}
