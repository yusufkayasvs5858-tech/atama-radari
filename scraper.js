const path = require('path');
const fs = require('fs');
const { readJsonSafe, atomicWriteJson, getTurkeyTimestamp, isDateExpired } = require('./lib/utils');
const { loadUserProfile, classifyPosting } = require('./lib/matcher');
const { dispatchNotifications, sendHeartbeatNotification } = require('./lib/notifier');
const { runAllScrapers } = require('./lib/scrapers');

async function main() {
  console.log('='.repeat(70));
  console.log('🚀 ATAMA RADARI: KAMU PERSONELİ VE KPSS P94 OTOMATİK TARAMA BAŞLADI');
  console.log(`⏰ Türkiye Saati (UTC+3): ${getTurkeyTimestamp()}`);
  console.log('='.repeat(70));

  // Dosya Yolları (Kök dizin ve data/ dizini uyumluluğu)
  const rootDir = __dirname;
  const dataDir = path.join(rootDir, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const ilanlarRootPath = path.join(rootDir, 'ilanlar.json');
  const ilanlarDataPath = path.join(dataDir, 'ilanlar.json');
  const notifiedRootPath = path.join(rootDir, 'notified.json');
  const notifiedDataPath = path.join(dataDir, 'notified.json');
  const reportRootPath = path.join(rootDir, 'scan-report.json');
  const reportDataPath = path.join(dataDir, 'scan-report.json');

  // 1. Aday Profilini Yükle
  const profile = loadUserProfile();
  console.log(`[PROFİL] Aktif Profil: ${profile.name} | Öğrenim: ${profile.educationLevel} | KPSS: ${profile.kpss.type} (${profile.kpss.score})`);

  // Bilinen eski sahte/örnek seed ilan kimlikleri (Tamamen temizlenir)
  const MOCK_SEED_IDS = new Set([
    'e39bc4599fdd343a386e6d30',
    '1cea8a3f1374342803b73839',
    'fb8eb81b669a503101e5a08a',
    '9e67d12eb0def4a81382b252',
    '978619bc8a7b010e41eae708',
    '3dadc7a77c44645d20686d75',
    'a849b710f08b3a788854e4f6'
  ]);

  // 2. Mevcut Veritabanını ve Bildirim Geçmişini Oku
  const existingPostingsList = readJsonSafe(ilanlarRootPath, readJsonSafe(ilanlarDataPath, []));
  const existingPostingsMap = new Map();
  if (Array.isArray(existingPostingsList)) {
    for (const p of existingPostingsList) {
      if (p.id && !MOCK_SEED_IDS.has(p.id)) {
        existingPostingsMap.set(p.id, p);
      }
    }
  }

  const notifiedDb = readJsonSafe(notifiedRootPath, readJsonSafe(notifiedDataPath, {}));

  // 3. Tüm Resmi Kaynakları Tara
  const { items: newScrapedItems, sourcesReport, timestamp } = await runAllScrapers();

  // 4. İlanları Değerlendir ve Eşle
  const currentBatchMap = new Map();

  // Yeni kazınanları sınıflandır (Sahte seed'ler elenir)
  for (const item of newScrapedItems) {
    if (MOCK_SEED_IDS.has(item.id)) continue;
    const classification = classifyPosting(item, profile);
    const merged = {
      ...item,
      ...classification,
      firstSeenAt: existingPostingsMap.has(item.id) ? (existingPostingsMap.get(item.id).firstSeenAt || timestamp) : timestamp,
      lastUpdatedAt: timestamp
    };
    currentBatchMap.set(item.id, merged);
  }

  // Önceki taramalarda bulunan gerçek ilanları koru ve yeniden değerlendir (Kara liste veya süre dolumu için)
  for (const [id, oldItem] of existingPostingsMap.entries()) {
    if (!currentBatchMap.has(id)) {
      const updatedClass = classifyPosting(oldItem, profile);
      const rechecked = {
        ...oldItem,
        ...updatedClass
      };
      currentBatchMap.set(id, rechecked);
    }
  }

  const allPostings = Array.from(currentBatchMap.values());

  // İlanları önem derecesine göre sırala (Önce YESIL, sonra SARI, en son KIRMIZI)
  const statusWeight = { 'YESIL': 3, 'SARI': 2, 'KIRMIZI': 1 };
  allPostings.sort((a, b) => {
    const diff = (statusWeight[b.status] || 0) - (statusWeight[a.status] || 0);
    if (diff !== 0) return diff;
    return (b.matchScore || 0) - (a.matchScore || 0);
  });

  // İstatistikleri hesapla
  const stats = {
    total: allPostings.length,
    green: allPostings.filter((p) => p.status === 'YESIL').length,
    yellow: allPostings.filter((p) => p.status === 'SARI').length,
    red: allPostings.filter((p) => p.status === 'KIRMIZI').length,
    expired: allPostings.filter((p) => p.isExpired).length
  };

  console.log(`\n📊 [ÖZET ANALİZ] Toplam: ${stats.total} | 🟢 Yeşil: ${stats.green} | 🟡 Sarı: ${stats.yellow} | 🔴 Kırmızı: ${stats.red} (Süresi Dolan: ${stats.expired})`);

  // 5. Bildirimleri Gönder (Sadece Yeni Yeşil ve Sarı İlanlar)
  console.log('\n🔔 [BİLDİRİM MOTORU] Bildirim durumu kontrol ediliyor...');
  const notifyReport = await dispatchNotifications(allPostings, notifiedDb, notifiedRootPath);
  // notified.json dosyasını data/ altına da eşitle
  atomicWriteJson(notifiedDataPath, notifiedDb);

  console.log(`[BİLDİRİM RAPORU] İletilen: ${notifyReport.sentCount} | Zaten Bildirilmiş: ${notifyReport.skippedCount} | Başarısız: ${notifyReport.failCount}`);

  // Yeni ilan çıkmasa dahi otomasyonun çalıştığını teyit eden durum (heartbeat) bildirimi
  if (notifyReport.sentCount === 0) {
    console.log('[DURUM BİLDİRİMİ] Yeni ilan yok, periyodik çalışma teyit bildirimi gönderiliyor...');
    await sendHeartbeatNotification({}, stats);
  }

  // 6. Veritabanını Atomik Olarak Kaydet
  atomicWriteJson(ilanlarRootPath, allPostings);
  atomicWriteJson(ilanlarDataPath, allPostings);

  // 7. Tarama Raporunu Oluştur ve Kaydet
  const scanReport = {
    lastScanAt: timestamp,
    profileUsed: {
      name: profile.name,
      educationLevel: profile.educationLevel,
      kpssType: profile.kpss.type,
      kpssScore: profile.kpss.score
    },
    statistics: stats,
    notificationSummary: notifyReport,
    sources: sourcesReport
  };

  atomicWriteJson(reportRootPath, scanReport);
  atomicWriteJson(reportDataPath, scanReport);

  console.log('\n💾 Tüm veriler atomik olarak kaydedildi (ilanlar.json, notified.json, scan-report.json).');
  console.log('='.repeat(70));
  console.log('✅ ATAMA RADARI TARAMA DÖNGÜSÜ BAŞARIYLA TAMAMLANDI');
  console.log('='.repeat(70));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ KRİTİK HATA:', err);
    process.exit(1);
  });
}

module.exports = { main };
