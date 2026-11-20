const { fetchWithRetry, sanitizeErrorMessage, cleanHtmlText, parseTurkishDate, loadHtml } = require('../utils');
const { extractQualificationCodes } = require('../qualifications');

/**
 * T.C. Adalet Bakanlığı Personel Genel Müdürlüğü (PGM) Duyurularını Tarar
 */
async function scrapeAdalet() {
  const sourceKey = 'adaletBakanligi';
  const sourceName = 'T.C. Adalet Bakanlığı (PGM)';
  const targetUrl = 'https://pgm.adalet.gov.tr/';
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
    const $ = loadHtml(html);

    $('.news-box, .duyurular-list li, table tr, a[href*="duyuru"]').each((_, el) => {
      const text = cleanHtmlText($(el).text());
      const href = $(el).is('a') ? $(el).attr('href') : $(el).find('a').attr('href');

      if (!text || text.length < 20) return;

      const isRelevant = /alım|sınavı|zabıt\s*kâtibi|zabıt\s*katibi|infaz|ikm|mübaşir|koruma|güvenlik|şoför|personel|sözleşmeli/i.test(text);
      if (!isRelevant) return;

      const fullUrl = href ? (href.startsWith('http') ? href : `https://pgm.adalet.gov.tr/${href.replace(/^\//, '')}`) : targetUrl;
      const deadline = parseTurkishDate(text);
      const codes = extractQualificationCodes(text);

      let quota = null;
      const quotaMatch = text.match(/(\d{1,5})\s*(?:sözleşmeli|personel|kadro|adet)/i);
      if (quotaMatch) {
        quota = parseInt(quotaMatch[1], 10);
      }

      items.push({
        sourceKey,
        sourceName,
        institution: 'T.C. Adalet Bakanlığı (PGM)',
        title: text.slice(0, 150),
        url: fullUrl,
        city: 'Tüm Adliyeler / Türkiye Geneli',
        quota,
        deadline: deadline ? deadline.formatted : null,
        educationLevel: /ortaöğretim|lise/i.test(text) ? 'Ortaöğretim' : null,
        kpssType: /p94/i.test(text) ? 'P94' : 'KPSS P94/P93/P3',
        minKpssScore: 70, // Adalet Bakanlığı genellikle 70 baraj puanı uygular
        qualificationCodes: codes,
        details: text
      });
    });

    return {
      key: sourceKey,
      name: sourceName,
      state: 'SUCCESS',
      ok: true,
      count: items.length,
      note: `${items.length} adet Adalet Bakanlığı duyurusu tarandı`,
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

module.exports = { scrapeAdalet };
