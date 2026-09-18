function normalizeArabicDigits(value = '') {
  const map = {
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  };
  return String(value).replace(/[٠-٩]/g, (d) => map[d]);
}

function numberValue(value) {
  const normalized = normalizeArabicDigits(value).replace(/[,،\s]/g, '');
  const match = normalized.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function scaledNumber(value, scaleWord = '') {
  const n = numberValue(value);
  if (!Number.isFinite(n)) return null;
  if (/مليار/i.test(scaleWord)) return Math.round(n * 1_000_000_000);
  if (/مليون/i.test(scaleWord)) return Math.round(n * 1_000_000);
  if (/(?:ألف|الف)/i.test(scaleWord)) return Math.round(n * 1_000);
  return Math.round(n);
}

function firstMatch(text, regex) {
  const match = String(text).match(regex);
  return match ? match.slice(1) : null;
}

export function extractRegaMetrics(text = '') {
  const value = normalizeArabicDigits(text);
  const deals = firstMatch(value, /([\d.,]+)\s*(ألف|الف|مليون|مليار)?\s*\n+\s*عدد الصفقات/i);
  const totalValue = firstMatch(value, /([\d.,]+)\s*(ألف|الف|مليون|مليار)?\s*\n+\s*إجمالي قيم الصفقات/i);
  const highestDeal = firstMatch(value, /([\d.,]+)\s*(ألف|الف|مليون|مليار)?\s*\n+\s*الصفقة الأعلى قيمة/i);
  const activeDistrict = firstMatch(value, /([^\n]{2,80})\s*\n+\s*الحي الأكثر نشاط/i);
  const activeType = firstMatch(value, /([^\n]{2,80})\s*\n+\s*نوع العقار الأكثر نشاط/i);

  return {
    dealCount: deals ? scaledNumber(deals[0], deals[1]) : null,
    totalDealValueSar: totalValue ? scaledNumber(totalValue[0], totalValue[1]) : null,
    highestDealSar: highestDeal ? scaledNumber(highestDeal[0], highestDeal[1]) : null,
    mostActiveDistrict: activeDistrict ? activeDistrict[0].trim() : null,
    mostActivePropertyType: activeType ? activeType[0].trim() : null,
    hasSalePricePerSqmIndicator: /متوسط سعر المتر لصفقات بيع العقارات/i.test(value),
    hasRentalIndex: /الرقم القياسي لأسعار الإيجارات/i.test(value),
    hasRentToIncomeIndicator: /نسبة الايجار الى الدخل/i.test(value),
  };
}

function cleanCardText(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function extractDistrict(title = '') {
  const match = String(title).match(/حي\s+([^,،]+)/i);
  return match ? match[1].trim() : null;
}

function propertyTypeFromTitle(title = '') {
  const value = String(title);
  if (/عمارة/i.test(value)) return 'building';
  if (/شقة/i.test(value)) return 'apartment';
  if (/فيلا/i.test(value)) return 'villa';
  if (/أرض|ارض/i.test(value)) return 'land';
  if (/استوديو/i.test(value)) return 'studio';
  if (/دور/i.test(value)) return 'floor';
  return 'other';
}

function listingDataQuality({ listingType, propertyType, priceSar, areaSqm }) {
  if (!Number.isFinite(priceSar) || !Number.isFinite(areaSqm)) return 'LOW';
  if (areaSqm < 20 || areaSqm > 10000) return 'LOW';
  if (['apartment', 'studio'].includes(propertyType) && areaSqm > 600) return 'LOW';
  if (listingType === 'rent' && priceSar < 8000) return 'LOW';
  if (listingType === 'sale' && priceSar < 250000) return 'LOW';
  return 'GOOD';
}

export function extractAqarListings(text = '', options = {}) {
  const value = normalizeArabicDigits(text);
  const listings = [];
  const seen = new Set();
  const pattern = /((?:عمارة|شقة|فيلا|أرض|ارض|دور|استوديو)[^\n]{0,260}?(?:للبيع|للإيجار)[^\n]{0,260}?)\s+([\d,]{3,})\s*§(?:\/سنوي)?[\s\-–•]*([\d,]{2,})\s*م?²?/giu;
  let match;

  while ((match = pattern.exec(value))) {
    const title = cleanCardText(match[1]);
    const priceSar = numberValue(match[2]);
    const areaSqm = numberValue(match[3]);
    if (!priceSar || !areaSqm || areaSqm < 15 || areaSqm > 100000) continue;
    const key = title + ':' + priceSar + ':' + areaSqm;
    if (seen.has(key)) continue;
    seen.add(key);

    const listingType = /للإيجار/i.test(title) ? 'rent' : 'sale';
    const propertyType = propertyTypeFromTitle(title);
    const district = extractDistrict(title);
    const dataQuality = listingDataQuality({ listingType, propertyType, priceSar, areaSqm });
    listings.push({
      title,
      listingType,
      propertyType,
      district,
      dataQuality,
      priceSar,
      areaSqm,
      pricePerSqmSar: Math.round(priceSar / areaSqm),
      city: /جدة/i.test(title) ? 'Jeddah' : options.city || null,
    });
    if (listings.length >= Number(options.limit || 30)) break;
  }

  return listings;
}

export function extractSuhailCapabilities(text = '') {
  const value = String(text);
  return {
    map: /الخريطة العقارية/i.test(value),
    transactions: /الصفقات/i.test(value),
    priceComparison: /مقارنة الأسعار/i.test(value),
    urbanAnalysis: /المعلومات العمرانية|التحليل/i.test(value),
    parcelDetails: /قطعة الأرض|المخططات/i.test(value),
  };
}

export function summarizeSourceCapture(capture) {
  if (!capture) return null;
  if (capture.platform === 'aqar') {
    const listings = extractAqarListings(capture.pageText, { city: capture.city });
    return {
      ...capture,
      parsed: {
        listingCount: listings.length,
        listings: listings.slice(0, 20),
      },
    };
  }

  if (capture.platform === 'rega') {
    return {
      ...capture,
      parsed: extractRegaMetrics(capture.pageText),
    };
  }

  if (capture.platform === 'suhail') {
    return {
      ...capture,
      parsed: extractSuhailCapabilities(capture.pageText),
    };
  }

  if (capture.platform === 'srem') {
    return {
      ...capture,
      parsed: {
        authRequired: capture.state === 'AUTH_REQUIRED',
        nafath: /نفاذ|النفاذ الوطني/i.test(capture.pageText || ''),
      },
    };
  }

  return capture;
}
