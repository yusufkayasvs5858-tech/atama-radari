const { fetchWithRetry, sanitizeErrorMessage, cleanHtmlText, parseTurkishDate, loadHtml } = require('../utils');
const { extractQualificationCodes } = require('../qualifications');

/**
 * T.C. Gençlik ve Spor Bakanlığı (GSB) Duyurularını Tarar
 */
async function scrapeGsb() {
  const sourceKey = 'gsb';
  const sourceName = 'T.C. Gençlik ve Spor Bakanlığı';
  const targetUrl = 'https://www.gsb.gov.tr/duyurular.html';
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

    $('.news-list-item, .duyuru-item, table tr, a[href*="duyuru"]').each((_, el) => {
      const text = cleanHtmlText($(el).text());
      const href = $(el).is('a') ? $(el).attr('href') : $(el).find('a').attr('href');

      if (!text || text.length < 20) return;

      const isRelevant = /alım|personel|sözleşmeli|destek|temizlik|koruma|güvenlik|yurt\s*yönetim|yedek/i.test(text);
      if (!isRelevant) return;

      const fullUrl = href ? (href.startsWith('http') ? href : `https://www.gsb.gov.tr/${href.replace(/^\//, '')}`) : targetUrl;
      const deadline = parseTurkishDate(text);
      const codes = extractQualificationCodes(text);

      let quota = null;
      const quotaMatch = text.match(/(\d{1,5})\s*(?:sözleşmeli|personel|kişi|kadro)/i);
      if (quotaMatch) {
        quota = parseInt(quotaMatch[1], 10);
      }

      items.push({
        sourceKey,
        sourceName,
        institution: 'T.C. Gençlik ve Spor Bakanlığı',
        title: text.slice(0, 150),
        url: fullUrl,
        city: '81 İl Geneli',
        quota,
        deadline: deadline ? deadline.formatted : null,
        educationLevel: /ortaöğretim|lise/i.test(text) ? 'Ortaöğretim' : null,
        kpssType: /p94/i.test(text) ? 'P94' : 'KPSS P94/P93/P3',
        minKpssScore: 60,
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
      note: `${items.length} adet GSB duyurusu tarandı`,
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

module.exports = { scrapeGsb };
