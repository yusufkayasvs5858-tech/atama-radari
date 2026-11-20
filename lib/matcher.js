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
 * Alakasız İlan Kara Listesi (Blacklist)
 * Bu kelimeleri içeren ilanlar adayın profili dışındadır ve doğrudan KIRMIZI işaretlenip Telegram'a bildirilmez.
 */
const BLACKLIST_KEYWORDS = [
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

/**
 * Bir ilanı adayın profiline göre YESIL, SARI veya KIRMIZI olarak sınıflandırır
 */
function classifyPosting(posting, profile = DEFAULT_PROFILE) {
  const reasons = [];
  let status = 'SARI'; // Varsayılan durum
  let score = 50;

  const title = (posting.title || '').toLowerCase();
  const rawText = `${posting.title || ''} ${posting.institution || ''} ${posting.department || ''} ${posting.details || ''} ${posting.educationLevel || ''}`.toLowerCase();

  // 0. KONTROL: Alakasız İlan Kara Listesi (Blacklist)
  for (const keyword of BLACKLIST_KEYWORDS) {
    if (rawText.includes(keyword)) {
      return {
        status: 'KIRMIZI',
        matchScore: 0,
        matchReason: `Kara liste kısıtı (${keyword} şartı)`,
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

  // 2. KONTROL: Öğrenim Düzeyi Uyuşmazlığı
  const isLisansOnly = (rawText.includes('lisans mezunu') || rawText.includes('sadece lisans') || posting.educationLevel === 'Lisans') &&
    !rawText.includes('ortaöğretim') && !rawText.includes('lise') && !rawText.includes('ön lisans');

  const isOnlisansOnly = (rawText.includes('ön lisans mezunu') || rawText.includes('önlisans mezunu') || posting.educationLevel === 'Ön lisans') &&
    !rawText.includes('ortaöğretim') && !rawText.includes('lise');

  if (isLisansOnly || isOnlisansOnly) {
    return {
      status: 'KIRMIZI',
      matchScore: 10,
      matchReason: isLisansOnly ? 'Yalnızca Lisans mezunlarına açık' : 'Yalnızca Ön Lisans mezunlarına açık',
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
  loadUserProfile,
  classifyPosting
};
