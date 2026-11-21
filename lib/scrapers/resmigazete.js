const { fetchWithRetry, decodeBuffer, sanitizeErrorMessage, cleanHtmlText, parseTurkishDate } = require('../utils');
const { extractQualificationCodes } = require('../qualifications');

/**
 * Resmî Gazete Zorunlu Personel Filtresi (Whitelist)
 * Bir ilanın Resmî Gazete'den alınabilmesi için bu kelimelerden EN AZ BİRİ mutlaka geçmelidir.
 * 'atama' tek başına ÇIKARILMIŞTIR (Bürokrat atama kararlarını engellemek için).
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
  'kontenjan',
  'sürekli işçi',
  'surekli isci',
  'öğretim elemanı',
  'ogretim elemani',
  'öğretim üyesi',
  'ogretim uyesi',
  'akademik personel',
  'bilişim personeli',
  'bilisim personeli',
  'alım ilanı',
  'alim ilani',
  'personel istihdam',
  'istihdam edilmek üzere',
  'istihdam edilmek uzere',
  'ilk defa atanmak üzere'
];

/**
 * Resmî Gazete Çöp / Bürokrat Kararı Kara Listesi (Blacklist)
 * Bu kelimelerden veya kalıplardan herhangi biri geçiyorsa anında elenir.
 */
const RG_BLACKLIST = [
  // Cumhurbaşkanlığı Bürokratik Atama / Görevden Alma Kararları
  'cumhurbaşkanlığından:',
  'cumhurbaskanligindan:',
  'cumhurbaşkanlığı kararı',
  'cumhurbaskanligi karari',
  'cumhurbaşkanı kararı',
  'cumhurbaskani karari',
  'atamalar hakkında karar',
  'atamalar hakkinda karar',
  'atama kararları',
  'atama kararlari',
  'görevden alınmıştır',
  'gorevden alinmistir',
  'görevden alma',
  'gorevden alma',
  'atanmıştır',
  'atanmistir',
  'yönetim kurulu üyeliğine',
  'yonetim kurulu uyeligine',
  'genel müdürlüğüne',
  'genel mudurlugune',
  'bölge müdürlüğüne',
  'bolge mudurlugune',
  'bakan yardımcılığına',
  'bakan yardimciligina',
  'daire başkanlığına',
  'daire baskanligina',
  'üyeliğine atanmıştır',
  'uyeligine atanmistir',
  'yürütme ve idare',
  'yurutme ve idare',

  // İhale, Ceza, Mahkeme, Vakıf vb. Çöp İlanlar
  'ihalelere katılmaktan yasaklama',
  'ihaleden yasaklama',
  'yasaklama kararı',
  'yasaklama karari',
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
  'kamulaştırma',
  'kamulastirma',
  'fesih kararı',
  'kayyım',
  'tasfiye',
  'engelli',
  'eski hükümlü',
  'eski hukumlu'
];

/**
 * Cumhurbaşkanlığı ve bürokrat kararlarını yakalayan katı regex kalıpları
 */
const RG_BLACKLIST_REGEX = [
  /karar\s*:\s*202\d/i,                            // Karar: 2026/389 vb.
  /atanm[ıi][şs]t[ıi]r/i,                          // ... atanmıştır
  /g[öo]revden\s+al[ıi]nm[ıi][şs]t[ıi]r/i,         // ... görevden alınmıştır
  /cumhurba[şs]kanl[ıi][ğg][ıi]ndan\s*:/i,          // Cumhurbaşkanlığından:
  /say[ıi]l[ıi]\s+cumhurba[şs]kan/i                // ... sayılı Cumhurbaşkanı Kararı
];

/**
 * Metnin gerçek bir personel alım ilanı olup olmadığını katı kurallarla denetler
 */
function isLegitResmiGazeteHiring(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();

  // 1. Blacklist kontrolü (kelime bazlı)
  for (const black of RG_BLACKLIST) {
    if (lower.includes(black)) {
      return false;
    }
  }

  // 2. Blacklist kontrolü (regex bazlı: Karar: 2026/..., atanmıştır, görevden alınmıştır vb.)
  for (const regex of RG_BLACKLIST_REGEX) {
    if (regex.test(text)) {
      return false;
    }
  }

  // 3. Whitelist kontrolü: Mutlaka gerçek alım terimlerinden EN AZ BİRİ geçmeli
  return RG_WHITELIST.some(white => lower.includes(white));
}

/**
 * Resmî Gazete İlanlarını Tarar
 * YALNIZCA "Çeşitli İlanlar" (-4.htm) bölümünü hedefler.
 * "Yürütme ve İdare Bölümü -> Atama Kararları" Cumhurbaşkanlığı kararları tamamen hariç tutulur.
 */
async function scrapeResmiGazete() {
  const sourceKey = 'resmiGazete';
  const sourceName = 'T.C. Resmî Gazete';
  const items = [];

  try {
    // 1. ADIM: Resmî Gazete Ana Sayfasını Çek ve SADECE "Çeşitli İlanlar" Linkini Tespit Et
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

    // Çeşitli İlanlar linkini regex ile güvenli şekilde bul (örn: ilanlar/eskiilanlar/2026/11/20261121-4.htm)
    let cesitliIlanlarUrl = null;
    const linkRegex = /href=["']([^"']*(?:-4\.htm|cesitli-ilanlar)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let linkMatch;

    while ((linkMatch = linkRegex.exec(homeHtml)) !== null) {
      const href = linkMatch[1];
      const linkText = cleanHtmlText(linkMatch[2].replace(/<[^>]*>/g, ' ')).toLowerCase();
      // Yürütme ve idare veya atama kararları linki OLMADIĞINDAN emin ol
      if (!linkText.includes('atama karar') && (href.includes('-4.htm') || linkText.includes('çeşitli ilân') || linkText.includes('çeşitli ilan'))) {
        cesitliIlanlarUrl = href.startsWith('http') ? href : `https://www.resmigazete.gov.tr/${href.replace(/^\//, '')}`;
        break;
      }
    }

    // Ana sayfada dinamik link bulunamazsa bugünün veya dünün tarihli Çeşitli İlanlar adresini dene
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');

    if (!cesitliIlanlarUrl) {
      cesitliIlanlarUrl = `https://www.resmigazete.gov.tr/ilanlar/eskiilanlar/${yyyy}/${mm}/${yyyy}${mm}${dd}-4.htm`;
    }

    // Belirlenen Çeşitli İlanlar sayfasının temel URL kökü (göreli PDF linklerini tamamlamak için)
    const baseIlanlarDir = cesitliIlanlarUrl.substring(0, cesitliIlanlarUrl.lastIndexOf('/') + 1);

    // 2. ADIM: SADECE "Çeşitli İlanlar" Sayfasını Çek ve Ayrıştır
    try {
      const ilanlarRes = await fetchWithRetry(cesitliIlanlarUrl, { timeoutMs: 15000, retries: 1 });
      if (ilanlarRes.ok) {
        const ilanlarBuf = await ilanlarRes.arrayBuffer();
        const ilanlarHtml = decodeBuffer(ilanlarBuf);

        // Word HTML formatındaki linkleri regex ile hassas şekilde ayrıştır
        const anchorRegex = /<a\s+[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let aMatch;

        while ((aMatch = anchorRegex.exec(ilanlarHtml)) !== null) {
          const rawHref = aMatch[1].trim();
          const rawText = cleanHtmlText(aMatch[2].replace(/<[^>]*>/g, ' '));

          if (!rawText || rawText.length < 15 || rawText.length > 300) continue;

          // Katı Whitelist ve Blacklist Filtresi:
          // Cumhurbaşkanlığı atamaları, ihale yasaklamaları ve alakasız kararlar burada %100 elenir.
          if (!isLegitResmiGazeteHiring(rawText)) {
            continue;
          }

          // Göreli linki mutlak URL'ye çevir
          let fullUrl = rawHref;
          if (!fullUrl.startsWith('http')) {
            fullUrl = `${baseIlanlarDir}${rawHref.replace(/^\//, '')}`;
          }

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
      } else {
        // Bugün Çeşitli İlanlar yayımlanmamış olabilir (Pazar/tatil günleri)
      }
    } catch (e) {
      console.warn('[UYARI] Resmî Gazete Çeşitli İlanlar sayfası ayrıştırılamadı:', e.message);
    }

    // DİKKAT: Ana sayfadan ('Yürütme ve İdare' altındaki Cumhurbaşkanlığı atamaları vb.)
    // asla ilan toplanmaz! Ana sayfa tarama bloğu bilinçli olarak kaldırılmıştır.

    return {
      key: sourceKey,
      name: sourceName,
      state: 'SUCCESS',
      ok: true,
      count: items.length,
      note: `${items.length} adet Resmî Gazete personel ilanı tarandı`,
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
  RG_BLACKLIST_REGEX,
  isLegitResmiGazeteHiring
};
