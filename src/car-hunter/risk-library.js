export const ENGINE_RISK_LIBRARY = Object.freeze({
  N20: { make: 'BMW', baseRisk: 58, reserveSar: 7000, notes: ['timing-chain/guide history matters', 'cooling and oil leaks require inspection'] },
  N55: { make: 'BMW', baseRisk: 36, reserveSar: 5500, notes: ['cooling system, oil-filter-housing and valve-cover leaks', 'turbo/wastegate and xDrive condition matter at high mileage'] },
  B48: { make: 'BMW', baseRisk: 28, reserveSar: 4500, notes: ['cooling plastics and oil-filter housing', 'verify service history'] },
  B58: { make: 'BMW', baseRisk: 22, reserveSar: 5000, notes: ['cooling peripherals and leaks', 'strong engine but high-mileage ancillaries still matter'] },
  M274: { make: 'Mercedes-Benz', baseRisk: 38, reserveSar: 5000, notes: ['cold-start cam/timing noises', 'cooling, PCV, turbo and mounts'] },
  M264: { make: 'Mercedes-Benz', baseRisk: 30, reserveSar: 5500, notes: ['cooling/electrical peripherals', 'verify service history and cold start'] },
  M276: { make: 'Mercedes-Benz', baseRisk: 34, reserveSar: 6000, notes: ['oil/cooling leaks and age-related ancillaries', 'verify gearbox and mounts'] },
  UNKNOWN: { make: null, baseRisk: 45, reserveSar: 6000, notes: ['engine code not verified'] },
});

export const MODEL_LIQUIDITY = Object.freeze({
  'MERCEDES-BENZ:C200': 88,
  'MERCEDES-BENZ:E200': 82,
  'MERCEDES-BENZ:E300': 84,
  'MERCEDES-BENZ:GLC': 82,
  'MERCEDES-BENZ:GLE': 76,
  'BMW:320I': 78,
  'BMW:330I': 82,
  'BMW:420I': 72,
  'BMW:430I': 74,
  'BMW:520I': 80,
  'BMW:530I': 85,
  'BMW:540I': 76,
  'BMW:X3': 80,
  'BMW:X5': 79,
});

export function engineProfile(engineCode) {
  const code = String(engineCode || 'UNKNOWN').toUpperCase().trim();
  return ENGINE_RISK_LIBRARY[code] || ENGINE_RISK_LIBRARY.UNKNOWN;
}

export function modelLiquidity(make, model) {
  const key = `${String(make || '').toUpperCase()}:${String(model || '').toUpperCase().replace(/\s+/g, '')}`;
  return MODEL_LIQUIDITY[key] ?? 65;
}
