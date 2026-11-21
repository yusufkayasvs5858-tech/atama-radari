const { isDateExpired, parseTurkishDate } = require('./utils');
const { QUALIFICATIONS_DB } = require('./qualifications');

/**
 * Varsayılan KPSS P94 Ortaöğretim Aday Profili
 */
const DEFAULT_PROFILE = {
  name: 'Ortaöğretim KPSS P94 Adayı',
  educationLevel: 'Ortaöğretim', // Ortaöğretim / Lise
  kpss: {
    type: 'P94',
    score: 75.0
  },
  licenses: ['B'],
  certificates: ['MEB Onaylı Bilgisayar İşletmeni'],
  qualifications: ['2001', '6506', '6225', '7225', '7300'],
  gender: 'Erkek',
  preferredCities: [] // Boş bırakılırsa tüm iller uygun kabul edilir
};

/**
 * Ortam değişkeninden veya varsayılandan aday profilini yükler
 */
function loadUserProfile() {
  if (process.env.USER_PROFILE_JSON) {
    try {
      const parsed = JSON.parse(process.env.USER_PROFILE_JSON);
      return {
        ...DEFAULT_PROFILE,
        ...parsed,
        kpss: { ...DEFAULT_PROFILE.kpss, ...(parsed.kpss || {}) }
      };
    } catch (err) {
      console.warn('[UYARI] USER_PROFILE_JSON parse edilemedi, varsayılan profil kullanılıyor:', err.message);
    }
  }
  return DEFAULT_PROFILE;
}

/**
 * Alakasız İlan ve Bürokratik Karar Kara Listesi (Blacklist)
 * Bu kelimeleri içeren ilanlar adayın profili dışındadır veya bürokrat atama kararıdır;
 * doğrudan KIRMIZI işaretlenir ve asla Telegram/ntfy'a bildirilmez.
 */
const BLACKLIST_KEYWORDS = [
  // Bürokratik Atama / Görevden Alma Kararları
  'cumhurbaşkanlığından:',
  'cumhurbaskanligindan:',
  'cumhurbaşkanlığı kararı',
  'cumhurbaskanligi karari',
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

  // İhale, Mahkeme ve Ceza Kararları
  'ihalelere katılmaktan yasaklama',
  'ihaleden yasaklama',
  'yasaklama kararı',
  'vakfın adı',
  'vakfın tescil',
  'mahkeme ilanı',
  'tebligat',
  'icra',
  'konkordato',

  // Adayın Profili Dışındaki Özel Kontenjanlar
  'engelli',
  'eski hükümlü',
  'eski hukumlu',
  'hükümlü',
  'hukumlu',
  'terörle mücadele',
  'terorle mucadele',
  'şehit yakını',
  'sehit yakini',
  'gazi',
  'proje başvuruları',
  'proje basvurulari',
  'kura duyurusu'
];

const BLACKLIST_PATTERNS = [
  /karar\s*:\s*202\d/i,
  /atanm[ıi][şs]t[ıi]r/i,
  /g[öo]revden\s+al[ıi]nm[ıi][şs]t[ıi]r/i,
  /cumhurba[şs]kanl[ıi][ğg][ıi]ndan\s*:/i
];

/**
 * Bir ilanı adayın profiline göre YESIL, SARI veya KIRMIZI olarak sınıflandırır
 */
function classifyPosting(posting, profile = DEFAULT_PROFILE) {
  const reasons = [];
  let status = 'SARI'; // Varsayılan durum
  let score = 50;

  const title = (posting.title || '').toLowerCase();
  const rawText = `${posting.title || ''} ${posting.institution || ''} ${posting.department || ''} ${posting.details || ''} ${posting.educationLevel || ''}`.toLowerCase();

  // 0. KONTROL: Alakasız İlan ve Bürokratik Karar Kara Listesi (Blacklist)
  for (const keyword of BLACKLIST_KEYWORDS) {
    if (rawText.includes(keyword)) {
      return {
        status: 'KIRMIZI',
        matchScore: 0,
        matchReason: `Kara liste kısıtı (${keyword})`,
        isExpired: false
      };
    }
  }

  for (const pattern of BLACKLIST_PATTERNS) {
    if (pattern.test(rawText)) {
      return {
        status: 'KIRMIZI',
        matchScore: 0,
        matchReason: 'Bürokratik karar / alakasız format kısıtı',
        isExpired: false
      };
    }
  }

  // 1. KONTROL: Son Başvuru Tarihi Geçmiş mi?
  if (posting.deadline) {
    if (isDateExpired(posting.deadline)) {
      return {
        status: 'KIRMIZI',
        matchScore: 0,
        matchReason: `Son başvuru tarihi doldu (${posting.deadline})`,
        isExpired: true
      };
    }
  }

  // 2. KONTROL: Yalnızca Lisans / Ön Lisans veya Lisans Meslekleri Uyuşmazlığı
  const lisansOnlyProfessions = [
    'avukat',
    'hakim',
    'savcı',
    'savci',
    'doktor',
    'tabip',
    'eczacı',
    'eczaci',
    'diş hekimi',
    'dis hekimi',
    'veteriner hekim',
    'mühendis',
    'muhendis',
    'mimar',
    'kaymakam',
    'uzman yardımcısı',
    'uzman yardimcisi',
    'müfettiş yardımcısı',
    'mufettis yardimcisi',
    'denetmen yardımcısı',
    'denetmen yardimcisi',
    'denetçi',
    'denetci',
    'öğretim üyesi',
    'ogretim uyesi',
    'profesör',
    'doçent',
    'docent',
    'doktor öğretim',
    'araştırma görevlisi',
    'arastirma gorevlisi',
    'öğretmen'
  ];

  const hasLisansProfession = lisansOnlyProfessions.some(prof => {
    // Kelimenin bağımsız geçtiğini doğrula
    const regex = new RegExp(`\\b${prof}\\b`, 'i');
    return regex.test(title);
  });

  const isLisansOnly = (
    hasLisansProfession ||
    rawText.includes('lisans mezunu') ||
    rawText.includes('sadece lisans') ||
    rawText.includes('fakülte mezunu') ||
    rawText.includes('en az 4 yıllık') ||
    posting.educationLevel === 'Lisans'
  ) && !rawText.includes('ortaöğretim') && !rawText.includes('lise') && !rawText.includes('ön lisans');

  const isOnlisansOnly = (
    rawText.includes('ön lisans mezunu') ||
    rawText.includes('önlisans mezunu') ||
    rawText.includes('myo mezunu') ||
    rawText.includes('en az 2 yıllık') ||
    posting.educationLevel === 'Ön lisans'
  ) && !rawText.includes('ortaöğretim') && !rawText.includes('lise');

  if (isLisansOnly || isOnlisansOnly) {
    return {
      status: 'KIRMIZI',
      matchScore: 10,
      matchReason: isLisansOnly ? 'Yalnızca Lisans / Fakülte mezunlarına açık kadro' : 'Yalnızca Ön Lisans (MYO) mezunlarına açık kadro',
      isExpired: false
    };
  }

  // 3. KONTROL: KPSS Puan Türü ve Taban Puan
  if (posting.kpssType) {
    const pType = posting.kpssType.toUpperCase();
    if (pType.includes('P3') && !pType.includes('P94') && !pType.includes('P93')) {
      return {
        status: 'KIRMIZI',
        matchScore: 15,
        matchReason: 'Sadece KPSS P3 (Lisans) puan türü isteniyor',
        isExpired: false
      };
    }
    if (pType.includes('P93') && !pType.includes('P94')) {
      return {
        status: 'KIRMIZI',
        matchScore: 20,
        matchReason: 'Sadece KPSS P93 (Ön Lisans) puan türü isteniyor',
        isExpired: false
      };
    }
  }

  if (posting.minKpssScore && typeof posting.minKpssScore === 'number') {
    if (posting.minKpssScore > profile.kpss.score) {
      return {
        status: 'KIRMIZI',
        matchScore: 25,
        matchReason: `Taban puan barajı (${posting.minKpssScore}) adayın puanından (${profile.kpss.score}) yüksek`,
        isExpired: false
      };
    }
  }

  // 4. KONTROL: Ehliyet Gereksinimi
  const requiresHeavyLicense = /\b(c|d|e)\s*sınıfı\s*ehliyet\b/i.test(rawText) ||
    (posting.qualificationCodes && (posting.qualificationCodes.includes('6510') || posting.qualificationCodes.includes('6514') || posting.qualificationCodes.includes('6518')));

  if (requiresHeavyLicense && !profile.licenses.includes('C') && !profile.licenses.includes('D') && !profile.licenses.includes('E')) {
    return {
      status: 'KIRMIZI',
      matchScore: 30,
      matchReason: 'Ağır vasıta sürücü belgesi (C/D/E) şartı var',
      isExpired: false
    };
  }

  // 5. KONTROL: Cinsiyet Şartı
  if (posting.qualificationCodes && posting.qualificationCodes.includes('1103') && profile.gender === 'Erkek') {
    return {
      status: 'KIRMIZI',
      matchScore: 10,
      matchReason: 'Yalnızca Kadın adaylar için ilan',
      isExpired: false
    };
  }

  // 6. POZİTİF EŞLEŞME (YEŞİL İLAN KRİTERLERİ)
  let isGreen = false;

  // Doğrudan 2001 (Ortaöğretim Düz Lise) kodu veya B sınıfı ehliyet (6506) içerenler
  if (posting.qualificationCodes && (posting.qualificationCodes.includes('2001') || posting.qualificationCodes.includes('6506'))) {
    isGreen = true;
    score = 95;
    reasons.push('2001 (Ortaöğretim) veya 6506 (B Sınıfı Ehliyet) şartı tam uyumlu');
  }

  // Ortaöğretim P94 veya Lise düzeyi açıkça belirtilen kadrolar
  const isHighSchoolRole = (
    rawText.includes('ortaöğretim') ||
    rawText.includes('lise mezunu') ||
    rawText.includes('p94') ||
    title.includes('temizlik') ||
    title.includes('güvenlik') ||
    title.includes('destek personeli') ||
    title.includes('şoför') ||
    title.includes('hizmetli') ||
    title.includes('infaz ve koruma') ||
    title.includes('zabıt kâtibi') ||
    title.includes('mübaşir')
  );

  if (isHighSchoolRole) {
    isGreen = true;
    score = Math.max(score, 90);
    reasons.push('Ortaöğretim (P94) düzeyine ve adayın niteliklerine uygun kadro');
  }

  // Sürekli İşçi ve Kura Alımları (Detaylı inceleme gerektirdiği için SARI yapılır)
  if (rawText.includes('sürekli işçi') || rawText.includes('noter kurası') || rawText.includes('kura ile')) {
    if (!isGreen) {
      status = 'SARI';
      score = 60;
      reasons.push('Sürekli işçi / kura alımı; başvuru şartları incelenmeli');
      return {
        status,
        matchScore: score,
        matchReason: reasons.join(' • '),
        isExpired: false
      };
    }
  }

  if (isGreen) {
    status = 'YESIL';
  } else {
    status = 'SARI';
    score = 65;
    reasons.push('Genel kamu alımı; kadro detayları ve nitelik kodları incelenmeli');
  }

  return {
    status,
    matchScore: score,
    matchReason: reasons.join(' • '),
    isExpired: false
  };
}

module.exports = {
  DEFAULT_PROFILE,
  BLACKLIST_KEYWORDS,
  BLACKLIST_PATTERNS,
  loadUserProfile,
  classifyPosting
};
