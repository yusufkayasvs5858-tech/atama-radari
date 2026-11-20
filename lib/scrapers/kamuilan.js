const { fetchWithRetry, sanitizeErrorMessage, cleanHtmlText, parseTurkishDate, loadHtml } = require('../utils');
const { extractQualificationCodes } = require('../qualifications');

/**
 * Cumhurbaşkanlığı Strateji ve Bütçe Başkanlığı Kamu İlan Portalını (kamuilan.sbb.gov.tr) Tarar
 */
async function scrapeKamuIlan() {
  const sourceKey = 'kamuIlan';
  const sourceName = 'Cumhurbaşkanlığı Kamu İlan';
  const targetUrl = 'https://kamuilan.sbb.gov.tr/';
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

    // İlan kartları veya tablo satırlarını ara
    $('table tr, .ilan-item, .card, .post-item, a[href*="ilan"]').each((_, el) => {
      const text = cleanHtmlText($(el).text());
      const href = $(el).is('a') ? $(el).attr('href') : $(el).find('a').attr('href');
      
      if (!text || text.length < 25) return;

      const isHiring = /personel|alım|işçi|sözleşmeli|memur|destek|güvenlik|temizlik|şoför/i.test(text);
      if (!isHiring) return;

      const fullUrl = href ? (href.startsWith('http') ? href : `https://kamuilan.sbb.gov.tr/${href.replace(/^\//, '')}`) : targetUrl;
      const deadline = parseTurkishDate(text);
      const codes = extractQualificationCodes(text);

      // Kontenjan sayısı tespiti (Örn: "50 Personel", "12 Sözleşmeli")
      let quota = null;
      const quotaMatch = text.match(/(\d{1,4})\s*(?:adet|kişi|personel|kontenjan)/i);
      if (quotaMatch) {
        quota = parseInt(quotaMatch[1], 10);
      }

      // Şehir tespiti
      let city = 'Belirtilmemiş';
      const cityMatch = text.match(/\b(Ankara|İstanbul|İzmir|Bursa|Antalya|Adana|Konya|Gaziantep|Şanlıurfa|Kocaeli|Mersin|Diyarbakır|Hatay|Manisa|Kayseri|Samsun|Balıkesir|Kahramanmaraş|Van|Aydın|Tekirdağ|Sakarya|Eskişehir|Trabzon|Ordu|Erzurum|Malatya|Mardin)\b/i);
      if (cityMatch) {
        city = cityMatch[1];
      }

      items.push({
        sourceKey,
        sourceName,
        institution: 'Kamu Kurumu',
        title: text.slice(0, 150),
        url: fullUrl,
        city,
        quota,
        deadline: deadline ? deadline.formatted : null,
        educationLevel: /ortaöğretim|lise/i.test(text) ? 'Ortaöğretim' : (/ön\s*lisans/i.test(text) ? 'Ön lisans' : (/lisans/i.test(text) ? 'Lisans' : null)),
        kpssType: /p94/i.test(text) ? 'P94' : (/p93/i.test(text) ? 'P93' : (/p3/i.test(text) ? 'P3' : null)),
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
      note: `${items.length} adet Kamu İlan kaydı bulundu`,
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

module.exports = { scrapeKamuIlan };
