const { fetchWithRetry, sanitizeErrorMessage, cleanHtmlText, parseTurkishDate, loadHtml } = require('../utils');
const { extractQualificationCodes } = require('../qualifications');

/**
 * ÖSYM Duyurular Sayfasını (KPSS Kılavuzları ve Tercih Duyuruları) Tarar
 */
async function scrapeOsym() {
  const sourceKey = 'osym';
  const sourceName = 'ÖSYM Başkanlığı';
  const targetUrl = 'https://www.osym.gov.tr/TR,25304/duyurular.html';
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

    // Duyuru listesi elemanlarını dolaş
    $('ul.duyuru-list li, .duyuru-item, a[href*="duyuru"]').each((_, el) => {
      const text = cleanHtmlText($(el).text());
      const href = $(el).is('a') ? $(el).attr('href') : $(el).find('a').attr('href');

      if (!text || text.length < 15) return;

      // Özellikle KPSS, Yerleştirme, Tercih Kılavuzu gibi atama duyurularını seç
      const isKpss = /kpss|tercih|yerleştirme|ataması|alım|kadro/i.test(text);
      if (!isKpss) return;

      const fullUrl = href ? (href.startsWith('http') ? href : `https://www.osym.gov.tr/${href.replace(/^\//, '')}`) : targetUrl;
      const deadline = parseTurkishDate(text);
      const codes = extractQualificationCodes(text);

      items.push({
        sourceKey,
        sourceName,
        institution: 'Ölçme, Seçme ve Yerleştirme Merkezi (ÖSYM)',
        title: text.slice(0, 150),
        url: fullUrl,
        city: 'Türkiye Geneli',
        quota: null,
        deadline: deadline ? deadline.formatted : null,
        educationLevel: /ortaöğretim|p94/i.test(text) ? 'Ortaöğretim' : null,
        kpssType: /p94/i.test(text) ? 'P94' : (/p93/i.test(text) ? 'P93' : (/p3/i.test(text) ? 'P3' : 'KPSS')),
        minKpssScore: null,
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
      note: `${items.length} adet ÖSYM atama/KPSS duyurusu bulundu`,
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

module.exports = { scrapeOsym };
