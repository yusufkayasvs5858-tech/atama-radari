const { fetchWithRetry, sanitizeErrorMessage, cleanHtmlText, parseTurkishDate, loadHtml } = require('../utils');
const { extractQualificationCodes } = require('../qualifications');

/**
 * Cumhurbaşkanlığı İnsan Kaynakları Ofisi Kariyer Kapısı (kariyerkapisi.gov.tr) Portalını Tarar
 */
async function scrapeKariyerKapisi() {
  const sourceKey = 'kariyerKapisi';
  const sourceName = 'CBİKO Kariyer Kapısı';
  const targetUrl = 'https://kariyerkapisi.gov.tr/isealim';
  const items = [];

  try {
    const res = await fetchWithRetry(targetUrl, { timeoutMs: 15000, retries: 1 });
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

    // Kariyer Kapısı statik/SSR render edilmiş ilan kartlarını ara
    $('.job-card, .listing-item, [class*="card"], a[href*="ilan"]').each((_, el) => {
      const text = cleanHtmlText($(el).text());
      const href = $(el).is('a') ? $(el).attr('href') : $(el).find('a').attr('href');

      if (!text || text.length < 25) return;

      const isJob = /alım|sözleşmeli|memur|işçi|personel|başvuru/i.test(text);
      if (!isJob) return;

      const fullUrl = href ? (href.startsWith('http') ? href : `https://kariyerkapisi.gov.tr${href.startsWith('/') ? '' : '/'}${href}`) : targetUrl;
      const deadline = parseTurkishDate(text);
      const codes = extractQualificationCodes(text);

      items.push({
        sourceKey,
        sourceName,
        institution: 'Kariyer Kapısı İlanı',
        title: text.slice(0, 150),
        url: fullUrl,
        city: 'Türkiye Geneli',
        quota: null,
        deadline: deadline ? deadline.formatted : null,
        educationLevel: /ortaöğretim|lise/i.test(text) ? 'Ortaöğretim' : null,
        kpssType: /p94/i.test(text) ? 'P94' : null,
        minKpssScore: null,
        qualificationCodes: codes,
        details: text
      });
    });

    return {
      key: sourceKey,
      name: sourceName,
      state: items.length > 0 ? 'SUCCESS' : 'REACHABLE_NO_SCRAPE',
      ok: true,
      count: items.length,
      note: items.length > 0 
        ? `${items.length} adet Kariyer Kapısı ilanı tespit edildi` 
        : `Erişilebilir (HTTP ${res.status}) — İstemci SPA arayüzü nedeniyle ana sayfa izleniyor`,
      items
    };
  } catch (err) {
    return {
      key: sourceKey,
      name: sourceName,
      state: 'TEMP_ERROR',
      ok: false,
      count: 0,
      note: `Geçici Hata: ${sanitizeErrorMessage(err)}`,
      items: []
    };
  }
}

module.exports = { scrapeKariyerKapisi };
