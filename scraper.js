const cheerio = require('cheerio');
const pdf = require('pdf-parse');
const fs = require('fs');

const USER_PROFILE = {
  puanTuru: 'KPSS P94',
  puan: 78.08757,
  sinavYili: '2026',
  sinavTarihi: new Date('2026-10-25T00:00:00+03:00'),
  egitimDuzeyi: 'Ortaöğretim',
  liseKodu: '2001',
  ehliyetKodu: '6506',
  orgunOgrenci: true,
  sertifikalar: [],
  ntfyKanal: 'atama-radari-p94-7808'
};

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'tr-TR,tr;q=0.9'
};

function parseTurkishDate(text) {
  const numericMatch = text.match(/(\d{1,2})[./-](\d{1,2})[./-](20\d{2})/);
  if (numericMatch) {
    const [, day, month, year] = numericMatch;
    return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00+03:00`);
  }
  const months = {
    ocak: '01', subat: '02', şubat: '02', mart: '03', nisan: '04',
    mayis: '05', mayıs: '05', haziran: '06', temmuz: '07', agustos: '08',
    ağustos: '08', eylul: '09', eylül: '09', ekim: '10', kasim: '11',
    kasım: '11', aralik: '12', aralık: '12'
  };
  const textMatch = text.toLowerCase().match(/(\d{1,2})\s+(ocak|subat|şubat|mart|nisan|mayis|mayıs|haziran|temmuz|agustos|ağustos|eylul|eylül|ekim|kasim|kasım|aralik|aralık)\s+(20\d{2})/);
  if (textMatch) {
    const [, day, mName, year] = textMatch;
    return new Date(`${year}-${months[mName]}-${day.padStart(2, '0')}T00:00:00+03:00`);
  }
  return null;
}

function evaluateCompatibility(title, bodyText = '') {
  const fullText = `${title} ${bodyText}`;
  const lower = fullText.toLowerCase();
  const reasons = [];
  const warnings = [];

  // 1. Tarih ve Dönem Kontrolü (25 Ekim 2026 öncesi ilanları ele)
  const detectedDate = parseTurkishDate(fullText);
  if (detectedDate && detectedDate < USER_PROFILE.sinavTarihi) {
    reasons.push(`İlan tarihi (${detectedDate.toLocaleDateString('tr-TR')}) 2026 KPSS Ortaöğretim sınavından (25.10.2026) önce.`);
  }
  if (lower.includes('2024 kpss') || lower.includes('2024-kpss') || lower.includes('kpss-2026/1')) {
    reasons.push('Eski KPSS puan dönemi ilanı (2026 KPSS Ortaöğretim kapsamı dışında).');
  }

  // 2. Öğrenim Düzeyi Kesin Filtresi (Ön Lisans / Lisans elemesi)
  const hasOrtaogretim = lower.includes('ortaöğretim') || lower.includes('ortaogretim') || lower.includes('lise mezunu') || lower.includes('2001');
  const hasOnlisans = lower.includes('ön lisans') || lower.includes('önlisans') || lower.includes('onlisans') || lower.includes('p93');
  const hasLisans = (lower.includes('lisans') && !hasOnlisans) || lower.includes('p3');

  if ((hasOnlisans || hasLisans) && !hasOrtaogretim) {
    reasons.push('Öğrenim düzeyi uyumsuz: Yalnızca Ön Lisans / Lisans mezunlarına açık.');
  }

  // 3. Örgün Üniversite Öğrenciliği Engel Kontrolü
  if (USER_PROFILE.orgunOgrenci && (lower.includes('örgün öğrenci olmamak') || lower.includes('örgün öğretimde kaydı bulunmamak') || lower.includes('öğrenciliği bulunmamak'))) {
    reasons.push('İlanda örgün üniversite öğrencisi olmama şartı var (Aktif YBS öğrencisisiniz).');
  }

  // 4. Ek Sertifika Kontrolü
  if (lower.includes('6225') || lower.includes('meb onaylı bilgisayar')) {
    reasons.push('6225 / MEB onaylı bilgisayar sertifikası isteniyor (Profilde kayıtlı değil).');
  }
  if (lower.includes('src') || lower.includes('psikoteknik')) {
    reasons.push('SRC veya Psikoteknik belgesi isteniyor (Profilde kayıtlı değil).');
  }

  // 5. Puan Kontrolü
  const scoreMatch = lower.match(/(?:en az|taban|asgari)\s*(\d{2}[.,]\d+)/);
  if (scoreMatch) {
    const minScore = parseFloat(scoreMatch[1].replace(',', '.'));
    if (!isNaN(minScore) && USER_PROFILE.puan < minScore) {
      reasons.push(`KPSS P94 puanınız (${USER_PROFILE.puan}) taban şartının (${minScore}) altında.`);
    }
  }

  if (reasons.length > 0) {
    return { status: 'KIRMIZI', reasons, warnings };
  }

  if (!hasOrtaogretim) {
    warnings.push('Duyuru metninde öğrenim düzeyi açıkça belirtilmemiş; kılavuz/ek kontrol edilmeli.');
  }
  if (!bodyText || bodyText.length < 80) {
    warnings.push('Resmî duyuru detayı/ek PDF manuel doğrulanmalı.');
  }

  return {
    status: warnings.length > 0 ? 'SARI' : 'YESIL',
    reasons: [],
    warnings
  };
}

async function fetchDetailText(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return '';
    const html = await res.text();
    const $ = cheerio.load(html);
    $('script, style, nav, footer, header').remove();
    return $('body').text().replace(/\s+/g, ' ').trim().slice(0, 3000);
  } catch {
    return '';
  }
}

async function sendNotification(title, message, url) {
  if (!USER_PROFILE.ntfyKanal) return;
  try {
    await fetch(`https://ntfy.sh/${USER_PROFILE.ntfyKanal}`, {
      method: 'POST',
      headers: {
        'Title': title,
        'Priority': 'high',
        'Click': url || 'https://yusufkayasvs5858-tech.github.io/atama-radari/'
      },
      body: message
    });
  } catch (err) {
    console.error('Bildirim hatasi:', err.message);
  }
}

async function run() {
  const nowStr = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  const db = {
    lastScan: nowStr,
    sources: {},
    announcements: []
  };

  // 1. ÖSYM Duyuruları (İç sayfa derinlikli tarama)
  try {
    const res = await fetch('https://www.osym.gov.tr/', { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    const html = await res.text();
    const $ = cheerio.load(html);
    const links = [];

    $('a').each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      const href = $(el).attr('href');
      if (href && text.length > 15 && /(kpss|yerleştirme|tercih|personel|kamu)/i.test(text)) {
        const fullUrl = href.startsWith('http') ? href : `https://www.osym.gov.tr${href.startsWith('/') ? '' : '/'}${href}`;
        if (!links.some(x => x.url === fullUrl)) {
          links.push({ title: text, url: fullUrl });
        }
      }
    });

    const topLinks = links.slice(0, 8);
    for (const item of topLinks) {
      const detailText = await fetchDetailText(item.url);
      const evalRes = evaluateCompatibility(item.title, detailText);
      db.announcements.push({
        id: Buffer.from(item.url).toString('base64').slice(0, 16),
        source: 'ÖSYM',
        title: item.title,
        institution: 'ÖSYM Merkezi Yerleştirme / Duyuru',
        url: item.url,
        scannedAt: nowStr,
        ...evalRes
      });
    }
    db.sources.osym = { ok: true, count: topLinks.length, note: `Doğrulandı (${topLinks.length} duyuru)` };
  } catch (e) {
    db.sources.osym = { ok: false, count: 0, note: `Erişim Hatası: ${e.message}` };
  }

  // 2. Resmî Gazete (Artırılmış zaman aşımı)
  try {
    const res = await fetch('https://www.resmigazete.gov.tr/', { headers: HEADERS, signal: AbortSignal.timeout(25000) });
    const html = await res.text();
    const $ = cheerio.load(html);
    let rgCount = 0;

    $('a').each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      const href = $(el).attr('href');
      if (href && /(personel alım|sözleşmeli personel|memur alım|işçi alım)/i.test(text)) {
        rgCount++;
        const fullUrl = href.startsWith('http') ? href : `https://www.resmigazete.gov.tr/${href.replace(/^\//, '')}`;
        const evalRes = evaluateCompatibility(text, text);
        db.announcements.push({
          id: Buffer.from(fullUrl).toString('base64').slice(0, 16),
          source: 'Resmî Gazete',
          title: text,
          institution: 'Resmî Gazete İlanı',
          url: fullUrl,
          scannedAt: nowStr,
          ...evalRes
        });
      }
    });
    db.sources.resmiGazete = { ok: true, count: rgCount, note: `Doğrulandı (${rgCount} ilan)` };
  } catch (e) {
    db.sources.resmiGazete = { ok: false, count: 0, note: `Erişim Hatası: ${e.message}` };
  }

  // 3. Kariyer Kapısı Kontrolü
  try {
    const res = await fetch('https://kariyerkapisi.gov.tr/isealim', { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    db.sources.kariyerKapisi = { ok: res.ok, count: 0, note: `Doğrulandı (HTTP ${res.status})` };
  } catch (e) {
    db.sources.kariyerKapisi = { ok: false, count: 0, note: `Erişim Hatası: ${e.message}` };
  }

  // 4. İŞKUR Kamu İlanları Kontrolü
  try {
    const res = await fetch('https://www.iskur.gov.tr/', { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    db.sources.iskur = { ok: res.ok, count: 0, note: `Doğrulandı (HTTP ${res.status})` };
  } catch (e) {
    db.sources.iskur = { ok: false, count: 0, note: `Erişim Hatası: ${e.message}` };
  }

  const yesilIlanlar = db.announcements.filter(a => a.status === 'YESIL');
  if (yesilIlanlar.length > 0) {
    await sendNotification(
      `ATAMA RADARI: ${yesilIlanlar.length} Tam Uygun İlan!`,
      yesilIlanlar.map(i => `• ${i.title}`).join('\n'),
      yesilIlanlar[0].url
    );
  }

  fs.writeFileSync('ilanlar.json', JSON.stringify(db, null, 2), 'utf-8');
  console.log('Tarama tamamlandi:', db.lastScan);
}

run();
