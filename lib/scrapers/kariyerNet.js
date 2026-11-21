const { fetchWithRetry, sanitizeErrorMessage, cleanHtmlText, loadHtml } = require('../utils');
const { extractQualificationCodes } = require('../qualifications');

/**
 * Kariyer.net Memur İlanları Bölümünü Tarar (pst=2168)
 * Katı Filtreleme: Stajyer, engelli ve lisans uzmanlıkları elenir.
 */
async function scrapeKariyerNet() {
  const sourceKey = 'kariyerNet';
  const sourceName = 'Kariyer.net (Kamu & Memur)';
  const targetUrl = 'https://www.kariyer.net/is-ilanlari/memur?pst=2168';
  const items = [];

  try {
    const res = await fetchWithRetry(targetUrl, { timeoutMs: 15000, retries: 2 });
    if (!res.ok) {
      return {
        key: sourceKey,
        name: sourceName,
        state: 'TEMP_ERROR',
        ok: false,
        count: 0,
        note: `Erişim Hatası (HTTP ${res.status})`,
        items: []
      };
    }

    const html = await res.text();

    // Kariyer.net HTML içindeki /is-ilani/ linklerini topla
    const linkRegex = /<a[^>]*href=["']([^"']*\/is-ilani\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    const seenLinks = new Set();

    while ((match = linkRegex.exec(html)) !== null) {
      const rawHref = match[1];
      const rawText = cleanHtmlText(match[2].replace(/<[^>]*>/g, ' '));

      if (seenLinks.has(rawHref) || !rawText || rawText.length < 10) continue;
      seenLinks.add(rawHref);

      const lower = rawText.toLowerCase();

      // KATI FİLTRELER:
      // 1. Engelli ve stajyer ilanları elenir
      if (lower.includes('engelli') || lower.includes('staj') || lower.includes('intern') || lower.includes('part time')) {
        continue;
      }

      // 2. Özel lisans uzmanlıkları elenir
      if (/doktor|avukat|mühendis|muhendis|mimar|öğretmen|yazılım|developer/i.test(lower)) {
        continue;
      }

      // 3. Yalnızca memur, büro, destek, güvenlik, şoför, operasyon, kamu ilanları kabul edilir
      const isTarget = /memur|kamu|büro|buro|hizmet|destek|güvenlik|guvenlik|şoför|sofor|operasyon|personel/i.test(lower);
      if (!isTarget) {
        continue;
      }

      const fullUrl = rawHref.startsWith('http') ? rawHref : `https://www.kariyer.net${rawHref.startsWith('/') ? '' : '/'}${rawHref}`;

      items.push({
        sourceKey,
        sourceName,
        institution: 'Kariyer.net İlanı',
        title: rawText.slice(0, 150),
        url: fullUrl,
        city: 'Türkiye Geneli',
        quota: null,
        deadline: null,
        educationLevel: /ortaöğretim|lise/i.test(lower) ? 'Ortaöğretim' : null,
        kpssType: /kpss/i.test(lower) ? 'P94' : 'Özel/Kamu Sektörü',
        minKpssScore: null,
        qualificationCodes: extractQualificationCodes(rawText),
        details: rawText
      });
    }

    return {
      key: sourceKey,
      name: sourceName,
      state: 'SUCCESS',
      ok: true,
      count: items.length,
      note: `${items.length} adet uygun memur/büro ilanı tarandı`,
      items
    };
  } catch (err) {
    return {
      key: sourceKey,
      name: sourceName,
      state: 'TEMP_ERROR',
      ok: false,
      count: 0,
      note: `Hata: ${sanitizeErrorMessage(err)}`,
      items: []
    };
  }
}

module.exports = { scrapeKariyerNet };
