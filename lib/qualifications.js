/**
 * KPSS Nitelik Kodları Veritabanı ve Metin Ayrıştırıcısı
 */

const QUALIFICATIONS_DB = {
  // --- Öğrenim Düzeyi Kodları ---
  '2001': {
    code: '2001',
    description: 'Ortaöğretim kurumlarının herhangi bir alanından mezun olmak (Düz Lise / Tüm Alanlar).',
    educationLevel: 'Ortaöğretim',
    requiresLicense: null,
    requiresCertificate: null,
    specialCondition: null
  },
  '2063': {
    code: '2063',
    description: 'Ortaöğretim Kurumlarının Adalet Alanı ve Dalları mezunu olmak.',
    educationLevel: 'Ortaöğretim',
    requiresLicense: null,
    requiresCertificate: null,
    specialCondition: 'Adalet alanı mezuniyeti'
  },
  '2087': {
    code: '2087',
    description: 'Ortaöğretim Kurumlarının Bilişim Teknolojileri Alanı ve Dalları mezunu olmak.',
    educationLevel: 'Ortaöğretim',
    requiresLicense: null,
    requiresCertificate: null,
    specialCondition: 'Bilişim Teknolojileri alanı mezuniyeti'
  },
  '2009': {
    code: '2009',
    description: 'Ortaöğretim Kurumlarının Biyomedikal Cihaz Teknolojileri Alanı mezunu olmak.',
    educationLevel: 'Ortaöğretim',
    requiresLicense: null,
    requiresCertificate: null,
    specialCondition: 'Biyomedikal mezuniyeti'
  },
  '3001': {
    code: '3001',
    description: 'Herhangi bir önlisans programından mezun olmak.',
    educationLevel: 'Ön lisans',
    requiresLicense: null,
    requiresCertificate: null,
    specialCondition: null
  },
  '4001': {
    code: '4001',
    description: 'Herhangi bir lisans programından mezun olmak.',
    educationLevel: 'Lisans',
    requiresLicense: null,
    requiresCertificate: null,
    specialCondition: null
  },

  // --- Sertifika ve Yeterlilik Kodları ---
  '6225': {
    code: '6225',
    description: "M.E.B.'den Onaylı Bilgisayar İşletmeni Sertifikası Sahibi Olmak veya örgün eğitimde bilgisayar dersi görmüş olmak.",
    educationLevel: null,
    requiresLicense: null,
    requiresCertificate: 'MEB Onaylı Bilgisayar İşletmeni Sertifikası',
    specialCondition: null
  },
  '6297': {
    code: '6297',
    description: 'En az B sınıfı sürücü belgesine ve SRC belgesine sahip olmak.',
    educationLevel: null,
    requiresLicense: 'B',
    requiresCertificate: 'SRC Belgesi',
    specialCondition: 'Şoförlük şartı'
  },

  // --- Sürücü Belgesi (Ehliyet) Kodları ---
  '6506': {
    code: '6506',
    description: 'B sınıfı sürücü belgesine sahip olmak.',
    educationLevel: null,
    requiresLicense: 'B',
    requiresCertificate: null,
    specialCondition: null
  },
  '6510': {
    code: '6510',
    description: 'C sınıfı sürücü belgesine sahip olmak.',
    educationLevel: null,
    requiresLicense: 'C',
    requiresCertificate: null,
    specialCondition: null
  },
  '6514': {
    code: '6514',
    description: 'D sınıfı sürücü belgesine sahip olmak.',
    educationLevel: null,
    requiresLicense: 'D',
    requiresCertificate: null,
    specialCondition: null
  },
  '6518': {
    code: '6518',
    description: 'E sınıfı sürücü belgesine sahip olmak.',
    educationLevel: null,
    requiresLicense: 'E',
    requiresCertificate: null,
    specialCondition: null
  },

  // --- Özel Durum, Vardiya ve Güvenlik Kodları ---
  '7225': {
    code: '7225',
    description: 'Güvenlik Tahkikatının Olumlu Sonuçlanması (Arşiv Araştırması).',
    educationLevel: null,
    requiresLicense: null,
    requiresCertificate: null,
    specialCondition: 'Güvenlik Soruşturması ve Arşiv Araştırması'
  },
  '7300': {
    code: '7300',
    description: 'Bu kadroda vardiya sistemi uygulanmaktadır.',
    educationLevel: null,
    requiresLicense: null,
    requiresCertificate: null,
    specialCondition: 'Vardiyalı Çalışma'
  },
  '7111': {
    code: '7111',
    description: 'Silahlı veya silahsız özel güvenlik görevlisi kimlik kartına sahip olmak.',
    educationLevel: null,
    requiresLicense: null,
    requiresCertificate: 'Özel Güvenlik Görevlisi Kimlik Kartı',
    specialCondition: 'Özel Güvenlik'
  },
  '7257': {
    code: '7257',
    description: 'Seyahate ve arazide çalışmaya elverişli olmak.',
    educationLevel: null,
    requiresLicense: null,
    requiresCertificate: null,
    specialCondition: 'Arazi Şartlarında Çalışabilme'
  },

  // --- Cinsiyet Kodları ---
  '1101': {
    code: '1101',
    description: 'Cinsiyeti erkek olmak.',
    educationLevel: null,
    requiresLicense: null,
    requiresCertificate: null,
    gender: 'Erkek',
    specialCondition: 'Erkek aday şartı'
  },
  '1103': {
    code: '1103',
    description: 'Cinsiyeti kadın olmak.',
    educationLevel: null,
    requiresLicense: null,
    requiresCertificate: null,
    gender: 'Kadın',
    specialCondition: 'Kadın aday şartı'
  }
};

/**
 * Verilen serbest metin içinden 4 basamaklı nitelik kodlarını ayıklar
 */
function extractQualificationCodes(text) {
  if (!text || typeof text !== 'string') return [];
  const found = new Set();

  // Bağlamsal arama: Nitelik kodları, özel şartlar vb. ifadelerin yanındaki sayılar
  const contextRegex = /(?:nitelik\s*kod\w*|aranan\s*nitelik\w*|özel\s*şart\w*|kod\w*)[^\d]{0,40}((?:\b\d{4}\b[\s,;/-]*)+)/gi;
  let match;
  while ((match = contextRegex.exec(text)) !== null) {
    const nums = match[1].match(/\b\d{4}\b/g) || [];
    for (const num of nums) {
      const yearNum = parseInt(num, 10);
      // Takvim yılları (1990 - 2035) ile çakışmaları filtrele (örneğin 2026 yılı nitelik kodu sanılmasın)
      // Ancak 2001 özel durumdur, doğrudan nitelik kodudur!
      if (num === '2001' || yearNum < 1990 || yearNum > 2035) {
        found.add(num);
      }
    }
  }

  // Veritabanımızda tanımlı kritik kodları metin içinde doğrudan tara
  for (const knownCode of Object.keys(QUALIFICATIONS_DB)) {
    const standalone = new RegExp(`(?:^|[^\\d])${knownCode}(?:[^\\d]|$)`);
    if (standalone.test(text)) {
      found.add(knownCode);
    }
  }

  return Array.from(found);
}

module.exports = {
  QUALIFICATIONS_DB,
  extractQualificationCodes
};
