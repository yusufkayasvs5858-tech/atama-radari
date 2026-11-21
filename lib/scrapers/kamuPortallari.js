const { fetchWithRetry, sanitizeErrorMessage, cleanHtmlText, parseTurkishDate, loadHtml } = require('../utils');
const { extractQualificationCodes } = require('../qualifications');

/**
 * Paylaşılan Bağımsız Kamu Personeli Alım Portallarını Tarar:
 * 1. kamupersonelialimi.com
 * 2. kamupersonelialim.com
 * Katı Filtreleme: Yalnızca Ortaöğretim / Lise, KPSS P94 veya genel kamu personeli/işçi kadroları alınır.
 */
async function scrapeKamuPortallari() {
  const sourceKey = 'kamuHaberPortallari';
  const sourceName = 'Kamu Personel Alım Portalları';
  const items = [];
  const seenUrls = new Set();

  const portals = [
    {
      url: 'https://kamupersonelialimi.com/',
      name: 'kamupersonelialimi.com'
    },
    {
      url: 'https://kamupersonelialim.com/',
      name: 'kamupersonelialim.com'
    }
  ];

  for (const portal of portals) {
    try {
      const res = await fetchWithRetry(portal.url, { timeoutMs: 15000, retries: 2 });
      if (!res.ok) continue;

      const html = await res.text();
      const $ = loadHtml(html);

      $('a').each((_, el) => {
        const href = (el && typeof el.attr === 'function') ? el.attr('href') : ($(el).attr ? $(el).attr('href') : '');
        const rawText = cleanHtmlText((el && typeof el.text === 'function') ? el.text() : $(el).text());

        if (!href || !rawText || rawText.length < 20 || rawText.length > 250) return;
        const lower = rawText.toLowerCase();

        // 1. KATI ELEME: Alakasız ve istenmeyen kelimeler
        if (
          lower.includes('engelli') ||
          lower.includes('eski hükümlü') ||
          lower.includes('eski hukumlu') ||
          lower.includes('refakat izni') ||
          lower.includes('staj') ||
          lower.includes('kura arşivi') ||
          lower.includes('tus') ||
          lower.includes('dus') ||
          lower.includes('ydus') ||
          lower.includes('doktor') ||
          lower.includes('tabip') ||
          lower.includes('öğretim üyesi') ||
          lower.includes('avukat') ||
          lower.includes('mühendis alımı')
        ) {
          return;
        }

        // 2. KATI KABUL: Gerçek personel / memur / işçi / zabıta / şoför alım duyuruları
        const isRecruitment = (
          lower.includes('alımı') ||
          lower.includes('alimi') ||
          lower.includes('alıyor') ||
          lower.includes('aliyor') ||
          lower.includes('alacak') ||
          lower.includes('memur alım') ||
          lower.includes('personel alım') ||
          lower.includes('işçi alım') ||
          lower.includes('zabıt kâtibi') ||
          lower.includes('zabıta') ||
          lower.includes('infaz koruma') ||
          lower.includes('şoför') ||
          lower.includes('güvenlik') ||
          lower.includes('hizmetli') ||
          lower.includes('kpss')
        );

        if (!isRecruitment) return;

        // URL'yi tamamla
        let fullUrl = href;
        if (!fullUrl.startsWith('http')) {
          fullUrl = `${portal.url.replace(/\/+$/, '')}/${href.replace(/^\//, '')}`;
        }

        if (seenUrls.has(fullUrl)) return;
        seenUrls.add(fullUrl);

        // Kontenjan tespiti
        let quota = null;
        const qMatch = rawText.match(/(\d{1,4})\s*(?:personel|memur|işçi|kişi|zabıt)/i);
        if (qMatch) {
          quota = parseInt(qMatch[1], 10);
        }

        const deadlineMatch = parseTurkishDate(rawText);
        const codes = extractQualificationCodes(rawText);

        // Öğrenim seviyesi tespiti
        let eduLevel = null;
        if (/lise|ortaöğretim/i.test(rawText)) {
          eduLevel = 'Ortaöğretim';
        } else if (/ön\s*lisans|myo/i.test(rawText)) {
          eduLevel = 'Ön lisans';
        } else if (/lisans/i.test(rawText)) {
          eduLevel = 'Lisans';
        }

        items.push({
          sourceKey,
          sourceName: `Kamu Portalı (${portal.name})`,
          institution: 'Kamu İlanı',
          title: rawText,
          url: fullUrl,
          city: 'Türkiye Geneli',
          quota,
          deadline: deadlineMatch ? deadlineMatch.formatted : null,
          educationLevel: eduLevel,
          kpssType: /p94/i.test(rawText) ? 'P94' : (/kpss['’]?siz/i.test(rawText) ? 'KPSS Şartsız' : null),
          minKpssScore: null,
          qualificationCodes: codes,
          details: rawText
        });
      });
    } catch (e) {
      console.warn(`[UYARI] ${portal.name} taranamadı:`, e.message);
    }
  }

  return {
    key: sourceKey,
    name: sourceName,
    state: 'SUCCESS',
    ok: true,
    count: items.length,
    note: `${items.length} adet bağımsız portal ilanı tarandı`,
    items
  };
}

module.exports = { scrapeKamuPortallari };
