const { fetchWithRetry, sanitizeErrorMessage, cleanHtmlText, parseTurkishDate, loadHtml } = require('../utils');
const { extractQualificationCodes } = require('../qualifications');

/**
 * Sağlık Bakanlığı için yasaklı/alakasız başlık kelimeleri (Blacklist)
 */
const SAGLIK_BLACKLIST = [
  'kura arşivi',
  'kura arsivi',
  'devlet hizmeti yükümlülüğü',
  'devlet hizmeti yukumlulugu',
  'mazeret kuraları',
  'mazeret kuralari',
  'yer değiştirme suretiyle',
  'yer degistirme suretiyle',
  'atanma kuraları',
  'atanma kuralari',
  'tus',
  'dus',
  'ydus',
  'uzmanlık dalı',
  'uzmanlik dali',
  'tabip',
  'uzman tabip',
  'diş tabibi',
  'dis tabibi',
  'eczacı',
  'eczaci',
  'başasistanlık',
  'basasistanlik',
  'yan dal'
];

/**
 * T.C. Sağlık Bakanlığı Yönetim Hizmetleri Genel Müdürlüğü (YHGM) Duyurularını Tarar
 * Yalnızca güncel (2026 yılı) "Sürekli İşçi Alımı" ve "Sözleşmeli Personel Alımı" duyurularını toplar.
 */
async function scrapeSaglik() {
  const sourceKey = 'saglikBakanligi';
  const sourceName = 'T.C. Sağlık Bakanlığı (YHGM)';
  const targetUrl = 'https://yhgm.saglik.gov.tr/TR-0/duyurular.html';
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

    $('.news-item, .panel-body li, table tr, a[href*="duyuru"]').each((_, el) => {
      const text = cleanHtmlText($(el).text());
      const href = $(el).is('a') ? $(el).attr('href') : $(el).find('a').attr('href');

      if (!text || text.length < 15) return;
      const lower = text.toLowerCase();

      // 1. KONTROL: Eski yıllar (2021, 2022, 2023, 2024, 2025) KESİNLİKLE elenir
      if (/202[0-5]/.test(text)) {
        return;
      }

      // 2. KONTROL: Kuralar, TUS, DUS, Tabip kısıtları KESİNLİKLE elenir
      for (const forbidden of SAGLIK_BLACKLIST) {
        if (lower.includes(forbidden)) {
          return;
        }
      }

      // 3. KONTROL: SADECE "Sürekli İşçi" veya "Sözleşmeli Personel" alım duyuruları kabul edilir
      const isHiring = /sürekli\s*işçi\s*alımı|surekli\s*isci\s*alimi|sözleşmeli\s*personel\s*alımı|sozlesmeli\s*personel\s*alimi|kpss[-\s]*\d{4}\/\d+|personel\s*alımı|işçi\s*alımı/i.test(text);
      if (!isHiring) {
        return;
      }

      const fullUrl = href ? (href.startsWith('http') ? href : `https://yhgm.saglik.gov.tr/${href.replace(/^\//, '')}`) : targetUrl;
      const deadline = parseTurkishDate(text);
      const codes = extractQualificationCodes(text);

      let quota = null;
      const quotaMatch = text.match(/(\d{1,5})\s*(?:sözleşmeli|sürekli|personel|işçi)/i);
      if (quotaMatch) {
        quota = parseInt(quotaMatch[1], 10);
      }

      items.push({
        sourceKey,
        sourceName,
        institution: 'T.C. Sağlık Bakanlığı',
        title: text.slice(0, 150),
        url: fullUrl,
        city: '81 İl Geneli',
        quota,
        deadline: deadline ? deadline.formatted : null,
        educationLevel: /ortaöğretim|lise/i.test(text) ? 'Ortaöğretim' : (/ön\s*lisans/i.test(text) ? 'Ön lisans' : (/lisans/i.test(text) ? 'Lisans' : null)),
        kpssType: /p94/i.test(text) ? 'P94' : (/işçi/i.test(text) ? 'KPSS Şartsız / Kura' : null),
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
      note: `${items.length} adet güncel Sağlık Bakanlığı personel alım duyurusu tarandı`,
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

module.exports = { scrapeSaglik };
