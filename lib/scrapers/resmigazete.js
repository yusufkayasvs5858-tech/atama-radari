const { fetchWithRetry, decodeBuffer, sanitizeErrorMessage, cleanHtmlText, parseTurkishDate, loadHtml } = require('../utils');
const { extractQualificationCodes } = require('../qualifications');

/**
 * Resmî Gazete Zorunlu Personel Filtresi (Whitelist)
 * Bir ilanın Resmî Gazete'den alınabilmesi için bu kelimelerden EN AZ BİRİ geçmelidir.
 */
const RG_WHITELIST = [
  'personel alımı',
  'personel alimi',
  'memur alımı',
  'memur alimi',
  'işçi alımı',
  'isci alimi',
  'sözleşmeli personel',
  'sozlesmeli personel',
  'kpss',
  'başvuru şartları',
  'basvuru sartlari',
  'sınav ilanı',
  'sinav ilani',
  'atama'
];

/**
 * Resmî Gazete Çöp İlan Kara Listesi (Blacklist)
 * Bu kelimelerden herhangi biri geçiyorsa anında elenir.
 */
const RG_BLACKLIST = [
  'ihalelere katılmaktan yasaklama',
  'ihaleden yasaklama',
  'yasaklama kararı',
  'vakfın adı',
  'vakfin adi',
  'vakfın tescil',
  'vakfin tescil',
  'mahkeme ilanı',
  'mahkeme ilani',
  'tebligat',
  'icra',
  'konkordato',
  'artırma',
  'artirma',
  'eksiltme',
  'engelli',
  'eski hükümlü',
  'eski hukumlu'
];

function isLegitResmiGazeteHiring(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();

  // 1. Kara liste kontrolü: Herhangi biri varsa doğrudan reddet
  for (const black of RG_BLACKLIST) {
    if (lower.includes(black)) {
      return false;
    }
  }

  // 2. Zorunlu whitelist kontrolü: En az biri mutlaka geçmeli
  return RG_WHITELIST.some(white => lower.includes(white));
}

/**
 * Resmî Gazete İlanlarını (Çeşitli İlanlar -4.htm ve Ana Sayfa İlanları) Tarar
 * windows-1254 Türkçe karakter kodlamasını eksiksiz çözer.
 */
async function scrapeResmiGazete() {
  const sourceKey = 'resmiGazete';
  const sourceName = 'T.C. Resmî Gazete';
  const items = [];

  try {
    // 1. ADIM: Resmî Gazete Ana Sayfasını Çek
    const homeUrl = 'https://www.resmigazete.gov.tr/';
    const homeRes = await fetchWithRetry(homeUrl, { timeoutMs: 15000, retries: 2 });
    
    if (!homeRes.ok) {
      return {
        key: sourceKey,
        name: sourceName,
        state: 'TEMP_ERROR',
        ok: false,
        count: 0,
        note: `Resmî Gazete ana sayfasına ulaşılamadı (HTTP ${homeRes.status})`,
        items: []
      };
    }

    const homeBuffer = await homeRes.arrayBuffer();
    const homeHtml = decodeBuffer(homeBuffer);
    let $ = loadHtml(homeHtml);

    // Çeşitli İlanlar bağlantısını bul (genellikle -4.htm veya cesitli-ilanlar linkidir)
    let cesitliIlanlarUrl = null;
    $('a').each((_, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().toLowerCase();
      if (href.includes('-4.htm') || text.includes('çeşitli ilân') || text.includes('çeşitli ilan')) {
        cesitliIlanlarUrl = href.startsWith('http') ? href : `https://www.resmigazete.gov.tr/${href.replace(/^\//, '')}`;
      }
    });

    // Eğer dinamik link bulunamazsa bugünün veya dünün tarihli olası adresini dene
    if (!cesitliIlanlarUrl) {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      cesitliIlanlarUrl = `https://www.resmigazete.gov.tr/eskiler/${yyyy}/${mm}/${yyyy}${mm}${dd}-4.htm`;
    }

    // 2. ADIM: Çeşitli İlanlar Sayfasını Çek ve Ayrıştır
    try {
      const ilanlarRes = await fetchWithRetry(cesitliIlanlarUrl, { timeoutMs: 15000, retries: 1 });
      if (ilanlarRes.ok) {
        const ilanlarBuf = await ilanlarRes.arrayBuffer();
        const ilanlarHtml = decodeBuffer(ilanlarBuf);
        const $ilan = loadHtml(ilanlarHtml);

        // Resmî Gazete link veya tablo satırlarını dolaş
        $ilan('a, p, li').each((_, el) => {
          const rawText = cleanHtmlText($ilan(el).text());
          const href = $ilan(el).attr('href') || cesitliIlanlarUrl;
          const fullUrl = href.startsWith('http') ? href : `https://www.resmigazete.gov.tr/${href.replace(/^\//, '')}`;

          // Katı Whitelist ve Blacklist Personel Alım Filtresi
          if (isLegitResmiGazeteHiring(rawText) && rawText.length > 15 && rawText.length < 250) {
            // Kurum adını ve unvanı ayrıştır
            let institution = 'Resmî Gazete İlanı';
            let title = rawText;

            if (rawText.includes('–') || rawText.includes('-')) {
              const parts = rawText.split(/[–-]/);
              institution = parts[0].trim();
              title = parts.slice(1).join(' ').trim();
            } else if (rawText.toLowerCase().includes('bakanlığ')) {
              const bIdx = rawText.toLowerCase().indexOf('bakanlığ');
              institution = rawText.slice(0, bIdx + 9).trim();
              title = rawText.slice(bIdx + 9).trim();
            } else if (rawText.toLowerCase().includes('üniversite')) {
              const uIdx = rawText.toLowerCase().indexOf('üniversite');
              institution = rawText.slice(0, uIdx + 11).trim();
              title = rawText.slice(uIdx + 11).trim();
            }

            const deadlineMatch = parseTurkishDate(rawText);
            const codes = extractQualificationCodes(rawText);

            items.push({
              sourceKey,
              sourceName,
              institution: institution || 'Kamu Kurumu',
              title: title || rawText,
              url: fullUrl,
              city: 'Tüm İller / Belirtilmemiş',
              quota: null,
              deadline: deadlineMatch ? deadlineMatch.formatted : null,
              educationLevel: rawText.toLowerCase().includes('ortaöğretim') ? 'Ortaöğretim' : null,
              kpssType: rawText.toLowerCase().includes('p94') ? 'P94' : (rawText.toLowerCase().includes('p93') ? 'P93' : (rawText.toLowerCase().includes('p3') ? 'P3' : null)),
              minKpssScore: null,
              qualificationCodes: codes,
              details: rawText
            });
          }
        });
      }
    } catch (e) {
      console.warn('[UYARI] Resmî Gazete Çeşitli İlanlar sayfası ayrıştırılamadı:', e.message);
    }

    // Ana sayfada duyuru/ilanlar varsa onları da topla
    $('a').each((_, el) => {
      const text = cleanHtmlText($(el).text());
      const href = $(el).attr('href') || '';
      if (isLegitResmiGazeteHiring(text) && text.length > 20 && text.length < 250) {
        const fullUrl = href.startsWith('http') ? href : `https://www.resmigazete.gov.tr/${href.replace(/^\//, '')}`;
        items.push({
          sourceKey,
          sourceName,
          institution: 'Kamu Kurumu',
          title: text,
          url: fullUrl,
          city: 'Türkiye Geneli',
          quota: null,
          deadline: null,
          educationLevel: null,
          kpssType: null,
          minKpssScore: null,
          qualificationCodes: extractQualificationCodes(text),
          details: text
        });
      }
    });

    return {
      key: sourceKey,
      name: sourceName,
      state: 'SUCCESS',
      ok: true,
      count: items.length,
      note: `${items.length} adet Resmî Gazete ilanı tarandı`,
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

module.exports = {
  scrapeResmiGazete,
  RG_WHITELIST,
  RG_BLACKLIST,
  isLegitResmiGazeteHiring
};
