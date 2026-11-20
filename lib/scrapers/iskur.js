const { fetchWithRetry, sanitizeErrorMessage, cleanHtmlText, parseTurkishDate, loadHtml } = require('../utils');
const { extractQualificationCodes } = require('../qualifications');

/**
 * Türkiye İş Kurumu (İŞKUR) Açık Kamu İlanlarını Tarar
 */
async function scrapeIskur() {
  const sourceKey = 'iskur';
  const sourceName = 'T.C. İŞKUR (Kamu Alımları)';
  const targetUrl = 'https://www.iskur.gov.tr/';
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

    // İŞKUR ana sayfasında veya duyurularında yer alan kamu / işgücü duyurularını tara
    $('a[href*="kamu"], a[href*="duyuru"], .news-box, .banner-item').each((_, el) => {
      const text = cleanHtmlText($(el).text());
      const href = $(el).attr('href') || targetUrl;

      if (!text || text.length < 20) return;

      const isPublicHiring = /kamu\s*personel|toplum\s*yararına|tyh|işgücü\s*uyum|iup|sürekli\s*işçi|engelli|eski\s*hükümlü/i.test(text);
      if (!isPublicHiring) return;

      const fullUrl = href.startsWith('http') ? href : `https://www.iskur.gov.tr/${href.replace(/^\//, '')}`;
      const deadline = parseTurkishDate(text);
      const codes = extractQualificationCodes(text);

      items.push({
        sourceKey,
        sourceName,
        institution: 'T.C. İŞKUR',
        title: text.slice(0, 150),
        url: fullUrl,
        city: 'Türkiye Geneli',
        quota: null,
        deadline: deadline ? deadline.formatted : null,
        educationLevel: 'Ortaöğretim / İlköğretim',
        kpssType: 'KPSS Şartsız / Kura',
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
        ? `${items.length} adet İŞKUR kamu duyurusu bulundu` 
        : `Erişilebilir (HTTP ${res.status}) — ASP.NET form arayüzü nedeniyle genel duyurular izleniyor`,
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

module.exports = { scrapeIskur };
