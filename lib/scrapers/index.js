const { generatePostingId, generateContentHash, getTurkeyTimestamp } = require('../utils');
const { scrapeResmiGazete } = require('./resmigazete');
const { scrapeKamuIlan } = require('./kamuilan');
const { scrapeOsym } = require('./osym');
const { scrapeSaglik } = require('./saglik');
const { scrapeAdalet } = require('./adalet');
const { scrapeGsb } = require('./gsb');
const { scrapeIskur } = require('./iskur');
const { scrapeKariyerKapisi } = require('./kariyerKapisi');

/**
 * Tüm resmi kaynak kazıyıcılarını eşzamanlı ve hataya dayanıklı (fault-tolerant) çalıştırır
 */
async function runAllScrapers() {
  const scrapers = [
    { key: 'resmiGazete', fn: scrapeResmiGazete },
    { key: 'kamuIlan', fn: scrapeKamuIlan },
    { key: 'osym', fn: scrapeOsym },
    { key: 'saglikBakanligi', fn: scrapeSaglik },
    { key: 'adaletBakanligi', fn: scrapeAdalet },
    { key: 'gsb', fn: scrapeGsb },
    { key: 'iskur', fn: scrapeIskur },
    { key: 'kariyerKapisi', fn: scrapeKariyerKapisi }
  ];

  console.log(`[RADAR] ${scrapers.length} resmi kaynak taranıyor...`);

  const results = await Promise.allSettled(scrapers.map((s) => s.fn()));

  const sourcesReport = {};
  const rawItems = [];
  const now = getTurkeyTimestamp();

  results.forEach((res, index) => {
    const scraperInfo = scrapers[index];
    if (res.status === 'fulfilled') {
      const data = res.value;
      sourcesReport[data.key || scraperInfo.key] = {
        name: data.name,
        ok: data.ok,
        state: data.state,
        count: data.count,
        note: data.note
      };
      if (Array.isArray(data.items)) {
        rawItems.push(...data.items);
      }
    } else {
      sourcesReport[scraperInfo.key] = {
        name: scraperInfo.key,
        ok: false,
        state: 'CRITICAL_ERROR',
        count: 0,
        note: `Beklenmeyen Hata: ${res.reason?.message || String(res.reason)}`
      };
    }
  });

  // Tekrarlayan ilanları URL + Başlık karması ile tekilleştir (Deduplicate)
  const uniqueItemsMap = new Map();
  for (const raw of rawItems) {
    const id = generatePostingId(raw.url, raw.title);
    if (!uniqueItemsMap.has(id)) {
      const contentHash = generateContentHash(`${raw.url}|${raw.title}|${raw.deadline}|${raw.quota}`);
      uniqueItemsMap.set(id, {
        id,
        contentHash,
        ...raw,
        scannedAt: now
      });
    }
  }

  const items = Array.from(uniqueItemsMap.values());
  console.log(`[RADAR] Tarama tamamlandı. Toplam bulunan tekil ilan: ${items.length}`);

  return {
    items,
    sourcesReport,
    timestamp: now
  };
}

module.exports = { runAllScrapers };
