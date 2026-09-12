const HARD_PAYMENT_PATTERNS = [
  { key: 'down_payment', re: /دفعة\s*(?:أولى|اولى)?\s*[:\-]?\s*\d|down\s*payment/i },
  { key: 'waiver', re: /تنازل(?:\s+عن)?(?:\s+السيارة)?/i },
  { key: 'remaining_installments', re: /باقي\s+(?:الأقساط|الاقساط)|متبقي\s+(?:الأقساط|الاقساط)/i },
  { key: 'monthly_payment', re: /قسط\s*(?:شهري)?\s*[:\-]?\s*\d|القسط\s+الشهري/i },
  { key: 'excluded_import_costs', re: /(?:لا\s*يشمل|لايشمل|من\s+دون|بدون)[^\n.]{0,120}(?:الجمارك|الضريبة|القيمة\s+المضافة)|(?:exclud(?:es|ing)|without)[^\n.]{0,80}(?:customs|vat|tax)/i },
];

const SOFT_PAYMENT_PATTERNS = [
  { key: 'financing', re: /تمويل|تمويلي/i },
  { key: 'installments', re: /أقساط|اقساط/i },
];

const NON_VEHICLE_TITLE_PATTERNS = [
  {
    kind: 'parts',
    re: /قطع\s*غيار|تشليح|(?:قير|جير)\s+للبيع|مكين[هة]\s+للبيع|^(?:مراي(?:ة|ات)|مرايا|فلتر|جنوط|كفرات?|صدام|شمعة|شمعات|اسطب|اصطب|كشاف|رديتر|كمبروسر|سلف|مساعد(?:ات)?|باب|كبوت|رفرف|زجاج)(?=\s|$|[-_:])/i,
  },
  { kind: 'rental', re: /للإيجار|للايجار|تأجير|ايجار\s+(?:يومي|شهري|سيارة)/i },
  { kind: 'wanted', re: /^(?:مطلوب|ابحث\s+عن|أبحث\s+عن)/i },
  { kind: 'service', re: /برمجة|ورشة|صيانة\s+سيارات|فحص\s+كمبيوتر|خدمة\s+صيانة/i },
  { kind: 'motorcycle', re: /دباب|دراجة\s+نارية/i },
  { kind: 'commercial_vehicle', re: /^(?:شاحنة|شاحنه|قلاب|سطحة|سطحه|تريلا)(?=\s|$|[-_:])/i },
];

const AIRBAG_WORD = '(?:ايرباق|إيرباق|ايرباج|إيرباج|ارباق|أرباق|الارباقات|الابرباج|airbag)';

const RISK_RULES = [
  {
    key: 'chassis',
    bad: /قص\s*(?:و)?لحام|ضربة\s+شاص|شاص(?:ي)?\s+(?:مضروب|متضرر|فيه|معدل)|شاسيه\s+(?:مضروب|متضرر)/i,
    good: /شاص(?:ي)?\s+شرط|الشاص(?:ي)?\s+(?:سليم|وكالة)|شاسيه\s+(?:سليم|شرط)/i,
    penalty: 35,
    reserve: 12000,
  },
  {
    key: 'overheat',
    bad: /سبق\s+(?:ارتفعت|رفعت)\s+الحرارة|مشكلة\s+حرارة|ترفع\s+حرارة|سخون|overheat/i,
    good: /ما\s+(?:قد\s+)?(?:رفعت|ارتفعت)\s+حرارة|بدون\s+حرارة|الحرارة\s+طبيعية/i,
    penalty: 30,
    reserve: 10000,
  },
  {
    key: 'engine_rebuilt',
    bad: /توضيب|مكين[هة]\s+مجددة|engine\s+rebuilt/i,
    penalty: 28,
    reserve: 9000,
  },
  {
    key: 'engine_changed',
    bad: /مكين[هة]\s+(?:مغيرة|مغيره|مبدلة|مبدله)|(?:مغير|مغيّر|مبدل|مبدّل)\s+مكين[هة]|engine\s+replaced/i,
    penalty: 20,
    reserve: 7000,
  },
  {
    key: 'gearbox_changed',
    bad: /(?:قير|جير)\s+(?:مغير|مغيره|مبدل|مبدله)|(?:مغير|مغيّر|مبدل|مبدّل)\s+(?:قير|جير)|gearbox\s+replaced/i,
    penalty: 18,
    reserve: 6000,
  },
  {
    key: 'airbag_damage',
    bad: new RegExp(`${AIRBAG_WORD}\\s*(?:اليمين|اليسار|المعاون|السائق|الستاره|الستارة)?\\s*(?:مفتوح|مفتوحة|طالع|طالعة|مضروب|مضروبة|deployed|fault)`, 'i'),
    penalty: 25,
    reserve: 7000,
  },
  {
    key: 'full_repaint',
    bad: /رش\s+كامل|مرشوش(?:ة)?\s+كامل/i,
    penalty: 12,
    reserve: 2500,
  },
  {
    key: 'scattered_repaint',
    bad: /رشوش\s+متفرق[هة]|رش\s+متفرق|مرشوش(?:ة)?\s+متفرق/i,
    penalty: 8,
    reserve: 1500,
  },
  {
    key: 'side_repaint',
    bad: /رش\s+(?:على\s+)?الجانب|رش\s+جنب|مرشوش(?:ة)?\s+جنب/i,
    penalty: 5,
    reserve: 1000,
  },
  {
    key: 'american_import',
    bad: /وارد\s+(?:امريكي|أمريكي)|مواصفات\s+(?:امريكية|أمريكية)/i,
    penalty: 6,
    reserve: 1000,
  },
  {
    key: 'non_gcc_import',
    bad: /وارد\s+(?:كوريا|كوري|المانيا|ألمانيا|كندا|اليابان|الصين)/i,
    penalty: 4,
    reserve: 1000,
  },
  {
    key: 'body_conversion',
    bad: /محول\s+20\d{2}|تحويل\s+(?:شكل|موديل)|محوّل\s+20\d{2}/i,
    penalty: 5,
    reserve: 1500,
  },
];

const UNVERIFIED_TRIM_PATTERNS = [/كت\s*AMG/i, /AMG\s*kit/i, /M\s*Sport\s*kit/i, /M\s*KIT/i, /كت\s*M/i];

export function classifyListingKind({ title = '' } = {}) {
  const t = String(title).trim();
  for (const { kind, re } of NON_VEHICLE_TITLE_PATTERNS) {
    if (re.test(t)) return kind;
  }
  return 'vehicle';
}

export function analyzePriceStructure({ title = '', description = '', priceType = null } = {}) {
  const text = `${title}\n${description}`;
  if (priceType === 'down-payment') return { level: 'hard', reasons: ['explicit_price_type'] };
  const hard = HARD_PAYMENT_PATTERNS.filter((x) => x.re.test(text)).map((x) => x.key);
  if (hard.length) return { level: 'hard', reasons: hard };
  const soft = SOFT_PAYMENT_PATTERNS.filter((x) => x.re.test(text)).map((x) => x.key);
  return { level: soft.length ? 'soft' : 'none', reasons: soft };
}

export function detectVehicleRiskFlags({ title = '', description = '' } = {}) {
  const text = `${title}\n${description}`;
  const out = [];
  for (const rule of RISK_RULES) {
    if (!rule.bad.test(text)) continue;
    if (rule.good?.test(text)) continue;
    out.push({ key: rule.key, penalty: rule.penalty, reserve: rule.reserve });
  }
  return out;
}

export function assessSellerRisk(sellerStats = {}) {
  const active = Number(sellerStats.activeVehicleListings ?? sellerStats.activeListings ?? 0);
  const age = Number(sellerStats.accountAgeDays ?? 0);
  let risk = 0;
  const reasons = [];
  if (active >= 20) { risk += 35; reasons.push('high_volume_seller'); }
  else if (active >= 8) { risk += 20; reasons.push('multi_vehicle_seller'); }
  else if (active >= 3) { risk += 8; reasons.push('several_active_listings'); }
  if (age > 0 && age < 30) { risk += 12; reasons.push('new_account'); }
  if (sellerStats.verifiedDealer === true) { risk = Math.max(0, risk - 8); reasons.push('verified_dealer'); }
  return { score: Math.min(100, risk), reasons };
}

export function analyzeListingQuality(input = {}) {
  const text = `${input.title || ''}\n${input.description || ''}`;
  const trimClaimUnverified = UNVERIFIED_TRIM_PATTERNS.some((re) => re.test(text)) && !input.vinVerifiedTrim;
  return {
    kind: classifyListingKind(input),
    priceStructure: analyzePriceStructure(input),
    riskFlags: detectVehicleRiskFlags(input),
    trimClaimUnverified,
    sellerRisk: assessSellerRisk(input.sellerStats || {}),
  };
}
