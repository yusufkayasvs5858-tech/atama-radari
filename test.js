const assert = require('assert');
const {
  parseTurkishDate,
  isDateExpired,
  decodeBuffer,
  generatePostingId,
  generateContentHash,
  cleanHtmlText
} = require('./lib/utils');
const { extractQualificationCodes, QUALIFICATIONS_DB } = require('./lib/qualifications');
const { classifyPosting, DEFAULT_PROFILE } = require('./lib/matcher');
const { isLegitResmiGazeteHiring } = require('./lib/scrapers/resmigazete');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ [GEÇTİ] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [BAŞARISIZ] ${name}`);
    console.error(`     Hata: ${err.message}`);
  }
}

console.log('='.repeat(65));
console.log('🧪 ATAMA RADARI BİRİM TESTLERİ VE DOĞRULAMA SUITE');
console.log('='.repeat(65));

// 1. Tarih Ayrıştırma Testleri
console.log('\n📅 1. Türkçe Tarih Ayrıştırma ve Süre Kontrolleri:');
runTest('Sayısal tarih formatı (GG.AA.YYYY)', () => {
  const parsed = parseTurkishDate('Son Başvuru: 28.11.2026 Saat: 17:00');
  assert.strictEqual(parsed.formatted, '28.11.2026');
  assert.strictEqual(parsed.iso, '2026-11-28');
});

runTest('Metinsel ay formatı (28 Kasım 2026)', () => {
  const parsed = parseTurkishDate('Başvurular 15 Aralık 2026 tarihine kadar');
  assert.strictEqual(parsed.formatted, '15.12.2026');
  assert.strictEqual(parsed.iso, '2026-12-15');
});

runTest('Süresi dolmuş tarih tespiti', () => {
  assert.strictEqual(isDateExpired('01.01.2020'), true);
  assert.strictEqual(isDateExpired('31.12.2099'), false);
});

// 2. Karakter Kodlama ve Temizleme Testleri
console.log('\n🔤 2. Karakter Kodlaması ve Güvenlik:');
runTest('UTF-8 karakter çözme', () => {
  const buf = Buffer.from('İşçi ve Şoför Alımı', 'utf-8');
  assert.strictEqual(decodeBuffer(buf, 'utf-8'), 'İşçi ve Şoför Alımı');
});

runTest('HTML metin temizleme', () => {
  const raw = '  Sağlık &nbsp; Bakanlığı &amp; Personel  Alımı \n\n ';
  assert.strictEqual(cleanHtmlText(raw), 'Sağlık Bakanlığı & Personel Alımı');
});

runTest('Benzersiz İlan Kimliği (ID) üretimi', () => {
  const id1 = generatePostingId('https://resmigazete.gov.tr/ilan1', 'Adalet Bakanlığı İlanı');
  const id2 = generatePostingId('https://resmigazete.gov.tr/ilan1', 'Adalet Bakanlığı İlanı');
  const id3 = generatePostingId('https://resmigazete.gov.tr/ilan2', 'Adalet Bakanlığı İlanı');
  assert.strictEqual(id1, id2);
  assert.notStrictEqual(id1, id3);
  assert.strictEqual(id1.length, 24);
});

// 3. Nitelik Kodları Testleri
console.log('\n🏷️ 3. KPSS Nitelik Kodları Ayrıştırma:');
runTest('2001 ve 6506 kodlarının tespiti', () => {
  const sample = 'Aranan Nitelik Kodları: 2001, 6506 özel şartı gerekmektedir.';
  const codes = extractQualificationCodes(sample);
  assert(codes.includes('2001'), '2001 bulunmalı');
  assert(codes.includes('6506'), '6506 bulunmalı');
});

runTest('Takvim yılı (2026) ile nitelik kodunun ayrılması', () => {
  const sample = '2026 yılı KPSS sınavı kapsamında 2001 nitelik kodu ile başvuru';
  const codes = extractQualificationCodes(sample);
  assert(codes.includes('2001'), '2001 bulunmalı');
  assert(!codes.includes('2026'), '2026 yılı nitelik kodu olarak algılanmamalı');
});

runTest('QUALIFICATIONS_DB sözlük bütünlüğü', () => {
  assert(QUALIFICATIONS_DB['2001'], '2001 veritabanında olmalı');
  assert(QUALIFICATIONS_DB['6225'], '6225 veritabanında olmalı');
  assert(QUALIFICATIONS_DB['6506'], '6506 veritabanında olmalı');
});

// 4. Eşleştirme Motoru (Matcher) Testleri
console.log('\n🎯 4. Aday Profili Eşleştirme Motoru:');
runTest('Tam uyumlu Ortaöğretim P94 ilanı -> YEŞİL olmalı', () => {
  const posting = {
    title: 'Adalet Bakanlığı Sözleşmeli İnfaz ve Koruma Memuru Alımı',
    institution: 'T.C. Adalet Bakanlığı',
    educationLevel: 'Ortaöğretim',
    kpssType: 'P94',
    minKpssScore: 70,
    deadline: '31.12.2028',
    qualificationCodes: ['2001']
  };
  const result = classifyPosting(posting, DEFAULT_PROFILE);
  assert.strictEqual(result.status, 'YESIL', 'Durum YEŞİL olmalı');
  assert(result.matchScore >= 80, 'Puan 80 üstü olmalı');
});

runTest('Yalnızca Lisans gerektiren ilan -> KIRMIZI olmalı', () => {
  const posting = {
    title: 'Uzman Yardımcısı Alımı (Sadece Lisans Mezunu)',
    educationLevel: 'Lisans',
    kpssType: 'P3',
    deadline: '31.12.2028'
  };
  const result = classifyPosting(posting, DEFAULT_PROFILE);
  assert.strictEqual(result.status, 'KIRMIZI', 'Lisans ilanı Ortaöğretim adayı için KIRMIZI olmalı');
});

runTest('Süresi geçmiş ilan -> KIRMIZI olmalı', () => {
  const posting = {
    title: 'Geçmiş Tarihli Temizlik Görevlisi Alımı',
    educationLevel: 'Ortaöğretim',
    kpssType: 'P94',
    deadline: '10.10.2021',
    qualificationCodes: ['2001']
  };
  const result = classifyPosting(posting, DEFAULT_PROFILE);
  assert.strictEqual(result.status, 'KIRMIZI', 'Süresi geçmiş ilan KIRMIZI olmalı');
  assert(result.isExpired === true, 'isExpired true olmalı');
});

runTest('Ağır vasıta (C/D/E) ehliyet şartı olan ilan (Adayda sadece B varsa) -> KIRMIZI olmalı', () => {
  const posting = {
    title: 'Otobüs Şoförü Alımı',
    educationLevel: 'Ortaöğretim',
    kpssType: 'P94',
    deadline: '31.12.2028',
    qualificationCodes: ['6514'] // D sınıfı
  };
  const result = classifyPosting(posting, DEFAULT_PROFILE);
  assert.strictEqual(result.status, 'KIRMIZI', 'Eksik ehliyet sınıfında KIRMIZI olmalı');
});

// 5. Kara Liste (Blacklist) Testleri
console.log('\n🚫 5. Alakasız İlan Kara Listesi (Blacklist) Kontrolleri:');
runTest('Engelli kontenjanı ilanı -> KIRMIZI olmalı', () => {
  const posting = {
    title: 'Sürekli İşçi (Engelli) Alım İlanı',
    educationLevel: 'Ortaöğretim',
    kpssType: 'P94',
    deadline: '31.12.2028'
  };
  const result = classifyPosting(posting, DEFAULT_PROFILE);
  assert.strictEqual(result.status, 'KIRMIZI', 'Engelli ilanı KIRMIZI olmalı');
  assert.strictEqual(result.matchScore, 0);
  assert(result.matchReason.toLowerCase().includes('kara liste'));
});

runTest('Eski Hükümlü ilanı -> KIRMIZI olmalı', () => {
  const posting = {
    title: 'Eski Hükümlü / TMY Temizlik Görevlisi Alımı',
    educationLevel: 'Ortaöğretim',
    kpssType: 'P94',
    deadline: '31.12.2028'
  };
  const result = classifyPosting(posting, DEFAULT_PROFILE);
  assert.strictEqual(result.status, 'KIRMIZI', 'Eski hükümlü ilanı KIRMIZI olmalı');
  assert.strictEqual(result.matchScore, 0);
});

runTest('Kura duyurusu ilanı -> KIRMIZI olmalı', () => {
  const posting = {
    title: 'Sağlık Bakanlığı Personel Alımı Noter Kura Duyurusu',
    educationLevel: 'Ortaöğretim',
    kpssType: 'P94',
    deadline: '31.12.2028'
  };
  const result = classifyPosting(posting, DEFAULT_PROFILE);
  assert.strictEqual(result.status, 'KIRMIZI', 'Kura duyurusu ilanı KIRMIZI olmalı');
  assert.strictEqual(result.matchScore, 0);
});

console.log('\n🏛️ 6. Resmî Gazete ve Cumhurbaşkanlığı Bürokratik Karar Filtresi:');
runTest('Cumhurbaşkanlığı Atama Kararı (Karar: 2026/389) reddedilmeli', () => {
  const text = 'Cumhurbaşkanlığı Tarafından Yapılan Atamalar Hakkında Kararlar (Karar: 2026/389, 390, 391)';
  assert.strictEqual(isLegitResmiGazeteHiring(text), false, 'CB atama kararı false dönmeli');
  const classified = classifyPosting({ title: text, details: text }, DEFAULT_PROFILE);
  assert.strictEqual(classified.status, 'KIRMIZI');
});

runTest('Görevden alma ve atanma kararı reddedilmeli', () => {
  const text = 'Kültür ve Turizm Bakanlığı Güzel Sanatlar Genel Müdür Yardımcısı görevden alınmış, yerine Ahmet Yılmaz atanmıştır.';
  assert.strictEqual(isLegitResmiGazeteHiring(text), false, 'Görevden alma / atanmıştır false dönmeli');
  const classified = classifyPosting({ title: text, details: text }, DEFAULT_PROFILE);
  assert.strictEqual(classified.status, 'KIRMIZI');
});

runTest('İhale yasaklama kararı reddedilmeli', () => {
  const text = 'Milli Savunma Bakanlığı Tedarik Hizmetleri İhalelere Katılmaktan Yasaklama Kararı';
  assert.strictEqual(isLegitResmiGazeteHiring(text), false, 'İhale yasaklama false dönmeli');
});

runTest('Gerçek KPSS ve Sözleşmeli Personel Alımı kabul edilmeli', () => {
  const text = 'Tarım ve Orman Bakanlığı 150 Sözleşmeli Personel Alımı ve KPSS Başvuru Şartları İlanı';
  assert.strictEqual(isLegitResmiGazeteHiring(text), true, 'Gerçek personel alımı true dönmeli');
});

console.log('\n' + '='.repeat(65));
console.log(`SONUÇ: ${passedTests} / ${totalTests} test başarıyla tamamlandı.`);
console.log('='.repeat(65));

if (passedTests !== totalTests) {
  process.exit(1);
}
