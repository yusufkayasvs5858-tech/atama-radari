/**
 * ATAMA RADARI - Otonom Kamu Personeli Ilan Tarayici ve Uygunluk Robotu
 * Calisma Saatleri: Her gun 08:00, 13:00 ve 19:00 (Turkiye Saati / UTC+3)
 * Veri Kaynaklari: Resmi Gazete (PDF ekleri dahil), OSYM, Kariyer Kapisi, ISKUR
 * Guvenlik: CAPTCHA asma veya yetkisiz erisim yoktur; yalnizca herkese acik resmi duyurular taranir.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');
const pdfParse = require('pdf-parse');

// ============================================================================
// 1. KULLANICI PROFILI VE BILDIRIM AYARLARI (Uygulamadan Otomatik Aktarildi)
// ============================================================================
const USER_PROFILE = {
  "kpssType": "KPSS P94",
  "kpssScore": 78.08757,
  "examPeriod": "2026 KPSS Ortaöğretim",
  "educationLevel": "Ortaöğretim",
  "graduation": "Anadolu Lisesi",
  "graduationCode": "2001",
  "driverLicense": "B sınıfı",
  "driverCode": "6506",
  "isActiveFormalStudent": true,
  "university": "Sivas Cumhuriyet Üniversitesi",
  "department": "Yönetim Bilişim Sistemleri",
  "geoPreference": "Türkiye'nin bütün illeri",
  "certificates": []
};

const NTFY_TOPIC = process.env.NTFY_TOPIC || "atama-radari-p94-7808";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const DB_PATH = path.join(__dirname, 'ilanlar.json');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; AtamaRadariBot/1.0; KisiselKamuIlanTakip)',
  'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9'
};

// ============================================================================
// 2. YARDIMCI FONKSIYONLAR VE VERITABANI YONETIMI
// ============================================================================
function normalizeTr(str) {
  return (str || '').toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').trim();
}

function makeStableId(source, title, url) {
  return 'rg_' + crypto.createHash('sha256').update(`${source}|${title}|${url}`).digest('hex').slice(0, 16);
}

function loadDatabase() {
  if (fs.existsSync(DB_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    } catch (e) {
      console.error('ilanlar.json okuma hatasi, sifirdan olusturuluyor:', e.message);
    }
  }
  return {
    schemaVersion: '1.0',
    app: 'ATAMA RADARI',
    telemetry: {
      lastRunAt: null,
      sourcesStatus: {}
    },
    announcements: []
  };
}

function saveDatabase(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      headers: { ...HEADERS, ...(options.headers || {}) },
      signal: controller.signal
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================================
// 3. KISISEL MEVZUAT VE UYGUNLUK ANALIZ MOTORU (YESIL / SARI / KIRMIZI)
// ============================================================================
function evaluateEligibility(posting) {
  const checks = [];
  const rawLower = normalizeTr(posting.rawText || '');
  const titleLower = normalizeTr(posting.title || '');
  const combined = `${titleLower} ${rawLower}`;
  const certsLower = (USER_PROFILE.certificates || []).map(c => normalizeTr(c));

  // 1) KPSS Puan Turu
  const pType = (posting.kpssType || '').toUpperCase();
  if (pType && pType !== 'KPSS ŞARTSIZ' && pType !== USER_PROFILE.kpssType.toUpperCase()) {
    checks.push({ rule: 'KPSS Puan Türü', status: 'FAIL', detail: `İlan ${pType} istiyor; profil ${USER_PROFILE.kpssType}.` });
  } else if (pType === USER_PROFILE.kpssType.toUpperCase()) {
    checks.push({ rule: 'KPSS Puan Türü', status: 'PASS', detail: `${USER_PROFILE.kpssType} uyumlu.` });
  } else {
    checks.push({ rule: 'KPSS Puan Türü', status: 'WARN', detail: 'Puan türü metinden doğrulanmalı.' });
  }

  // 2) Minimum Taban Puan
  if (posting.minScore !== null && posting.minScore !== undefined) {
    const minVal = Number(posting.minScore);
    if (!isNaN(minVal)) {
      if (USER_PROFILE.kpssScore >= minVal) {
        checks.push({ rule: 'Taban Puan', status: 'PASS', detail: `Puanınız (${USER_PROFILE.kpssScore}) >= ${minVal}.` });
      } else {
        checks.push({ rule: 'Taban Puan', status: 'FAIL', detail: `Puanınız (${USER_PROFILE.kpssScore}) < ${minVal}.` });
      }
    }
  }

  // 3) Ogrenim Duzeyi
  if ((combined.includes('önlisans mezunu') || combined.includes('lisans mezunu')) &&
      !combined.includes('ortaöğretim') && !combined.includes('lise')) {
    checks.push({ rule: 'Öğrenim Düzeyi', status: 'FAIL', detail: 'Yalnızca Önlisans/Lisans mezuniyeti aranıyor.' });
  } else {
    checks.push({ rule: 'Öğrenim Düzeyi', status: 'PASS', detail: 'Ortaöğretim / lise düzeyine açık.' });
  }

  // 4) Nitelik Kodlari (2001, 6506, 6225 vb.)
  const codes = Array.from(new Set((combined.match(/\b(2001|2\d{3}|6\d{3}|7\d{3})\b/g) || [])));
  codes.forEach(code => {
    if (code === String(USER_PROFILE.graduationCode)) {
      checks.push({ rule: `Nitelik Kodu (${code})`, status: 'PASS', detail: '2001 Genel Lise Mezuniyeti doğrulandı.' });
    } else if (code === String(USER_PROFILE.driverCode)) {
      checks.push({ rule: `Nitelik Kodu (${code})`, status: 'PASS', detail: '6506 B Sınıfı Ehliyet doğrulandı.' });
    } else if (code === '6225') {
      const has6225 = certsLower.some(c => c.includes('6225') || c.includes('bilgisayar işletmen'));
      checks.push({
        rule: 'Nitelik Kodu (6225)',
        status: has6225 ? 'PASS' : 'FAIL',
        detail: has6225 ? '6225 Bilgisayar İşletmeni sertifikası mevcut.' : '6225 MEB Bilgisayar İşletmeni sertifikası profilde yok.'
      });
    } else if (code === '6510' || code === '6514') {
      checks.push({ rule: `Nitelik Kodu (${code})`, status: 'FAIL', detail: 'C/D sınıfı ehliyet isteniyor.' });
    }
  });

  // 5) KRITIK: Aktif Orgun Universite Ogrencisi Engeli
  const studentBanPatterns = [
    'örgün öğrenci olmamak',
    'örgün öğretim öğrencisi olmamak',
    'örgün öğrenim görmüyor olmak',
    'örgün eğitime devam etmiyor olmak',
    'aktif örgün öğrenci olmamak',
    'örgün yükseköğretim programlarında kayıtlı olmamak',
    'örgün öğretimde öğrenci olmamak'
  ];
  if (studentBanPatterns.some(pat => combined.includes(pat))) {
    if (USER_PROFILE.isActiveFormalStudent) {
      checks.push({
        rule: 'Örgün Öğrenci Şartı (KRİTİK)',
        status: 'FAIL',
        detail: `İlanda örgün öğrenci olmamak şartı var (${USER_PROFILE.university} aktif örgün kaydınız engel).`,
      });
    } else {
      checks.push({ rule: 'Örgün Öğrenci Şartı', status: 'PASS', detail: 'Örgün öğrenci kaydı bulunmuyor.' });
    }
  }

  // 6) Ek Sertifika Kontrolleri
  ['src2', 'src4', 'psikoteknik', 'özel güvenlik', 'hijyen'].forEach(certKw => {
    if (combined.includes(certKw)) {
      const ok = certsLower.some(c => c.includes(certKw));
      checks.push({
        rule: `Belge (${certKw.toUpperCase()})`,
        status: ok ? 'PASS' : 'FAIL',
        detail: ok ? `${certKw} belgesi mevcut.` : `İstenen ${certKw} belgesi profilde kayıtlı değil.`
      });
    }
  });

  // 7) Yas / Deneyim / Saglik / PDF Belirsizlik Kontrolu
  if (combined.includes('deneyim') || combined.includes('tecrübe') || combined.includes('yaşını doldurmamış') || combined.includes('sağlık kurulu')) {
    checks.push({ rule: 'Özel Şart İncelemesi', status: 'WARN', detail: 'Yaş, deneyim veya sağlık raporu şartı geçiyor; resmî PDF teyit edilmeli.' });
  }
  if (rawLower.length < 40) {
    checks.push({ rule: 'Metin Kapsamı', status: 'WARN', detail: 'İlan detay metni kısa; gizli özel şartlar için resmî bağlantıyı kontrol edin.' });
  }

  const failReasons = checks.filter(c => c.status === 'FAIL').map(c => c.detail);
  let status = 'YESIL';
  if (failReasons.length > 0) status = 'KIRMIZI';
  else if (checks.some(c => c.status === 'WARN')) status = 'SARI';

  return { status, checks, failReasons };
}

// ============================================================================
// 4. RESMI KAYNAK TARAYICILAR (RESMI GAZETE + PDF, OSYM, KARIYER KAPISI, ISKUR)
// ============================================================================
async function extractPdfTextSafe(pdfUrl) {
  try {
    const res = await fetchWithTimeout(pdfUrl, {}, 18000);
    if (!res.ok) return '';
    const arrayBuf = await res.arrayBuffer();
    const parsed = await pdfParse(Buffer.from(arrayBuf));
    return (parsed.text || '').replace(/\s+/g, ' ').trim().slice(0, 12000);
  } catch (err) {
    console.warn(`PDF okunamadi (${pdfUrl}):`, err.message);
    return '';
  }
}

async function scrapeResmiGazete() {
  const results = [];
  const baseUrl = 'https://www.resmigazete.gov.tr/';
  const res = await fetchWithTimeout(baseUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const personnelKeywords = ['personel alım', 'sözleşmeli personel', 'memur alım', 'destek personeli', 'işçi alım', 'kpss'];
  const candidateLinks = [];

  $('a').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    const href = $(el).attr('href');
    if (!href || text.length < 10) return;
    const lower = normalizeTr(text);
    if (personnelKeywords.some(kw => lower.includes(kw))) {
      const fullUrl = href.startsWith('http') ? href : new URL(href, baseUrl).toString();
      candidateLinks.push({ title: text, url: fullUrl });
    }
  });

  // Tekil linkleri isle (en fazla 15 duyuru)
  const uniqueLinks = Array.from(new Map(candidateLinks.map(i => [i.url, i])).values()).slice(0, 15);
  for (const item of uniqueLinks) {
    let rawText = item.title;
    if (item.url.toLowerCase().endsWith('.pdf')) {
      const pdfTxt = await extractPdfTextSafe(item.url);
      if (pdfTxt) rawText += ' ' + pdfTxt;
    } else {
      try {
        const subRes = await fetchWithTimeout(item.url);
        if (subRes.ok) {
          const subHtml = await subRes.text();
          const $$ = cheerio.load(subHtml);
          rawText += ' ' + $$('body').text().replace(/\s+/g, ' ').trim().slice(0, 8000);
        }
      } catch (_) {}
    }

    const minMatch = normalizeTr(rawText).match(/en az\s+(\d{2}(?:[.,]\d+)?)\s*puan/);
    const kpssType = normalizeTr(rawText).includes('p93') && !normalizeTr(rawText).includes('p94')
      ? 'KPSS P93'
      : normalizeTr(rawText).includes('p3') && !normalizeTr(rawText).includes('p94')
        ? 'KPSS P3'
        : 'KPSS P94';

    results.push({
      id: makeStableId('resmigazete', item.title, item.url),
      source: 'Resmî Gazete',
      sourceUrl: item.url,
      institution: item.title.split('Başkanlığından')[0].split('Bakanlığından')[0].trim().slice(0, 90) || 'Resmî Gazete Kamu İlanı',
      title: item.title.slice(0, 120),
      category: normalizeTr(rawText).includes('sürekli işçi') ? 'isci' : '4b',
      city: 'Türkiye Geneli',
      quota: 1,
      educationLevel: 'ortaogretim',
      kpssType,
      kpssYear: '2026',
      minScore: minMatch ? Number(minMatch[1].replace(',', '.')) : null,
      qualificationCodes: (rawText.match(/\b(2001|6506|6225|7225)\b/g) || []).join(', '),
      deadlineDate: null,
      rawText: rawText.slice(0, 4000)
    });
  }
  return results;
}

async function scrapeOsym() {
  const results = [];
  const baseUrl = 'https://www.osym.gov.tr/';
  const res = await fetchWithTimeout(baseUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  $('a').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    const href = $(el).attr('href');
    if (!href || text.length < 12) return;
    const lower = normalizeTr(text);
    if (lower.includes('kpss') && (lower.includes('tercih') || lower.includes('yerleştirme') || lower.includes('kılavuz') || lower.includes('ortaöğretim'))) {
      const fullUrl = href.startsWith('http') ? href : new URL(href, baseUrl).toString();
      results.push({
        id: makeStableId('osym', text, fullUrl),
        source: 'ÖSYM',
        sourceUrl: fullUrl,
        institution: 'ÖSYM Merkezi Yerleştirme',
        title: text.slice(0, 130),
        category: 'merkezi',
        city: 'Türkiye Geneli',
        quota: 1,
        educationLevel: 'ortaogretim',
        kpssType: 'KPSS P94',
        kpssYear: '2026',
        minScore: null,
        qualificationCodes: '2001',
        deadlineDate: null,
        rawText: text
      });
    }
  });
  return Array.from(new Map(results.map(i => [i.id, i])).values()).slice(0, 10);
}

async function checkPublicPortalStatus(url, label) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return `Doğrulandı (HTTP ${res.status})`;
}

// ============================================================================
// 5. MOBIL PUSH BILDIRIM (NTFY.SH + OPSIYONEL TELEGRAM)
// ============================================================================
async function sendPushAlert(posting, status) {
  const titleAscii = `ATAMA RADARI [${status}]: ${posting.institution}`
    .replace(/[ğĞ]/g, 'g').replace(/[üÜ]/g, 'u').replace(/[şŞ]/g, 's')
    .replace(/[ıİ]/g, 'i').replace(/[öÖ]/g, 'o').replace(/[çÇ]/g, 'c')
    .slice(0, 120);

  const bodyText = [
    `Durum: ${status}`,
    `Kurum: ${posting.institution}`,
    `Kadro: ${posting.title}`,
    `KPSS: ${posting.kpssType} (${posting.kpssYear})`,
    `Resmi Link: ${posting.sourceUrl}`
  ].join('\n');

  if (NTFY_TOPIC) {
    try {
      await fetchWithTimeout(`https://ntfy.sh/${encodeURIComponent(NTFY_TOPIC)}`, {
        method: 'POST',
        headers: {
          'Title': titleAscii,
          'Priority': status === 'YESIL' ? 'high' : 'default',
          'Tags': status === 'YESIL' ? 'white_check_mark,loudspeaker' : 'warning',
          'Click': posting.sourceUrl || 'https://www.osym.gov.tr/'
        },
        body: bodyText
      });
    } catch (e) {
      console.error('ntfy bildirim hatasi:', e.message);
    }
  }

  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    try {
      await fetchWithTimeout(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: `🎯 ATAMA RADARI (${status})\n\n${bodyText}`
        })
      });
    } catch (e) {
      console.error('Telegram bildirim hatasi:', e.message);
    }
  }
}

// ============================================================================
// 6. ANA TARAMA VE ARSIVLEME DONGUSU
// ============================================================================
async function main() {
  console.log('ATAMA RADARI taramasi basliyor...', new Date().toISOString());
  const db = loadDatabase();
  const nowIso = new Date().toISOString();
  const todayStr = nowIso.slice(0, 10);

  const sourcesStatus = {
    osym: { name: 'ÖSYM', status: 'Kontrol ediliyor', checkedAt: nowIso },
    resmigazete: { name: 'Resmî Gazete', status: 'Kontrol ediliyor', checkedAt: nowIso },
    kariyerkapisi: { name: 'Kariyer Kapısı', status: 'Kontrol ediliyor', checkedAt: nowIso },
    iskur: { name: 'İŞKUR Kamu', status: 'Kontrol ediliyor', checkedAt: nowIso }
  };

  let fetchedItems = [];

  try {
    const rgItems = await scrapeResmiGazete();
    fetchedItems = fetchedItems.concat(rgItems);
    sourcesStatus.resmigazete.status = `Doğrulandı (${rgItems.length} aday)`;
  } catch (err) {
    sourcesStatus.resmigazete.status = `Erişim Hatası: ${err.message}`;
  }

  try {
    const osymItems = await scrapeOsym();
    fetchedItems = fetchedItems.concat(osymItems);
    sourcesStatus.osym.status = `Doğrulandı (${osymItems.length} duyuru)`;
  } catch (err) {
    sourcesStatus.osym.status = `Erişim Hatası: ${err.message}`;
  }

  try {
    sourcesStatus.kariyerkapisi.status = await checkPublicPortalStatus('https://kariyerkapisi.gov.tr/isealim', 'Kariyer Kapısı');
  } catch (err) {
    sourcesStatus.kariyerkapisi.status = `Erişim Hatası: ${err.message}`;
  }

  try {
    sourcesStatus.iskur.status = await checkPublicPortalStatus('https://www.iskur.gov.tr/', 'İŞKUR');
  } catch (err) {
    sourcesStatus.iskur.status = `Erişim Hatası: ${err.message}`;
  }

  // Tekillestirme (Deduplication) ve Uygunluk Analizi
  const existingMap = new Map(db.announcements.map(a => [a.id, a]));
  let newEligibleCount = 0;

  for (const item of fetchedItems) {
    const evaluation = evaluateEligibility(item);
    const prev = existingMap.get(item.id);
    if (!prev) {
      const record = {
        ...item,
        publishDate: todayStr,
        evaluation,
        lastCheckedAt: nowIso,
        archived: false
      };
      existingMap.set(item.id, record);
      if (evaluation.status === 'YESIL' || evaluation.status === 'SARI') {
        newEligibleCount++;
        await sendPushAlert(record, evaluation.status);
      }
    } else {
      existingMap.set(item.id, {
        ...prev,
        ...item,
        evaluation,
        lastCheckedAt: nowIso
      });
    }
  }

  // Suresi gecen ilanlari otomatik arsivle
  const finalAnnouncements = Array.from(existingMap.values()).map(ann => {
    const expired = ann.deadlineDate && ann.deadlineDate < todayStr;
    return {
      ...ann,
      archived: Boolean(expired)
    };
  });

  db.telemetry = {
    lastRunAt: nowIso,
    totalScanned: finalAnnouncements.length,
    newEligibleFound: newEligibleCount,
    sourcesStatus
  };
  db.announcements = finalAnnouncements;

  saveDatabase(db);
  console.log(`Tarama tamamlandi. Toplam: ${finalAnnouncements.length}, Yeni Uygun: ${newEligibleCount}`);
}

main().catch(err => {
  console.error('Kritik tarayici hatasi:', err);
  process.exit(1);
});
