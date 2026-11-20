const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// İsteğe bağlı harici paketler (Kurulu değilse yerel Node.js API'ları kullanılır)
let iconv = null;
try {
  iconv = require('iconv-lite');
} catch (e) {
  // iconv-lite kurulu değilse yerel Node.js TextDecoder kullanılacak
}

let cheerio = null;
try {
  cheerio = require('cheerio');
} catch (e) {
  // cheerio kurulu değilse yerel hafif ayrıştırıcı kullanılacak
}

/**
 * HTML içeriğini yükler. Cheerio kuruluysa Cheerio'yu, değilse hafif regex ayrıştırıcıyı kullanır.
 */
function loadHtml(htmlStr) {
  if (cheerio && cheerio.load) {
    return cheerio.load(htmlStr || '');
  }

  const str = String(htmlStr || '');
  return function(selector) {
    const matchedElements = [];
    const tagRegex = /<(a|tr|li|p|div|span)[^>]*>([\s\S]*?)<\/\1>/gi;
    let match;

    while ((match = tagRegex.exec(str)) !== null) {
      const fullTag = match[0];
      const hrefMatch = fullTag.match(/href=["']([^"']*)["']/i);
      const innerText = cleanHtmlText(fullTag.replace(/<[^>]*>/g, ' '));
      const isAnchor = fullTag.toLowerCase().startsWith('<a');

      const elObj = {
        text: () => innerText,
        attr: (name) => {
          if (name === 'href') return hrefMatch ? hrefMatch[1] : '';
          return '';
        },
        find: (sel) => ({
          attr: (name) => (name === 'href' && hrefMatch ? hrefMatch[1] : ''),
          text: () => innerText
        }),
        is: (sel) => {
          if (sel.toLowerCase() === 'a') return isAnchor;
          return false;
        }
      };
      matchedElements.push(elObj);
    }

    return {
      each: function(callback) {
        matchedElements.forEach((el, i) => callback(i, el));
      }
    };
  };
}

/**
 * Kullanıcı tarayıcısı başlıkları (User-Agent vb.)
 */
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache'
};

/**
 * Otomatik yeniden denemeli (retry) ve zaman aşımlı fetch fonksiyonu
 */
async function fetchWithRetry(url, options = {}) {
  const {
    timeoutMs = 15000,
    retries = 2,
    backoffMs = 1500,
    headers = {},
    method = 'GET',
    body = null
  } = options;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method,
        headers: { ...DEFAULT_HEADERS, ...headers },
        body,
        signal: controller.signal
      });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

/**
 * Buffer veya ArrayBuffer'ı belirtilen kodlamaya göre (windows-1254, utf-8 vb.) metne çevirir
 */
function decodeBuffer(buffer, encoding = 'utf-8') {
  if (!buffer) return '';
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  const enc = encoding.toLowerCase().replace('-', '');
  if (enc === 'windows1254' || enc === 'iso88599' || enc === 'latin5') {
    if (iconv && iconv.encodingExists && iconv.encodingExists('windows-1254')) {
      return iconv.decode(buf, 'windows-1254');
    }
    try {
      const decoder = new TextDecoder('windows-1254');
      return decoder.decode(buf);
    } catch (e) {
      try {
        const decoder = new TextDecoder('iso-8859-9');
        return decoder.decode(buf);
      } catch (err) {
        return buf.toString('utf-8');
      }
    }
  }

  return buf.toString('utf-8');
}

/**
 * Hata mesajını arındırarak sadeleştirir
 */
function sanitizeErrorMessage(err) {
  if (!err) return 'Bilinmeyen hata';
  if (typeof err === 'string') return err;
  if (err.name === 'AbortError') return 'Zaman aşımı (Timeout)';
  return err.message || String(err);
}

/**
 * İçerik için kısa karma (MD5/SHA) üretir
 */
function generateContentHash(content) {
  return crypto.createHash('md5').update(String(content || '')).digest('hex').slice(0, 16);
}

/**
 * İlan için benzersiz ve tekrarlanabilir kimlik (ID) üretir
 */
function generatePostingId(url, title) {
  const seed = `${(url || '').trim()}|${(title || '').trim().toLowerCase()}`;
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 24);
}

/**
 * Türkçe ay isimleri haritası
 */
const TURKISH_MONTHS = {
  'ocak': '01',
  'şubat': '02',
  'subat': '02',
  'mart': '03',
  'nisan': '04',
  'mayıs': '05',
  'mayis': '05',
  'haziran': '06',
  'temmuz': '07',
  'ağustos': '08',
  'agustos': '08',
  'eylül': '09',
  'eylul': '09',
  'ekim': '10',
  'kasım': '11',
  'kasim': '11',
  'aralık': '12',
  'aralik': '12'
};

/**
 * Metin içindeki Türkçe tarihleri (28.11.2026 veya 28 Kasım 2026) parse eder
 * { iso: "2026-11-28", formatted: "28.11.2026", dateObj: Date } döndürür
 */
function parseTurkishDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;

  const clean = dateStr.trim();

  // Biçim 1: GG.AA.YYYY veya GG/AA/YYYY veya GG-AA-YYYY
  const numMatch = clean.match(/\b([0-3]?\d)[\.\/-]([0-1]?\d)[\.\/-](20\d{2})\b/);
  if (numMatch) {
    const day = String(numMatch[1]).padStart(2, '0');
    const month = String(numMatch[2]).padStart(2, '0');
    const year = numMatch[3];
    const iso = `${year}-${month}-${day}`;
    const dateObj = new Date(Date.UTC(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10), 23, 59, 59));
    return {
      iso,
      formatted: `${day}.${month}.${year}`,
      dateObj
    };
  }

  // Biçim 2: 28 Kasım 2026
  const textMatch = clean.match(/\b([0-3]?\d)\s+([a-zA-ZçğıöşüÇĞİÖŞÜ]+)\s+(20\d{2})\b/);
  if (textMatch) {
    const day = String(textMatch[1]).padStart(2, '0');
    const monthName = textMatch[2].toLowerCase();
    const year = textMatch[3];
    const month = TURKISH_MONTHS[monthName];
    if (month) {
      const iso = `${year}-${month}-${day}`;
      const dateObj = new Date(Date.UTC(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10), 23, 59, 59));
      return {
        iso,
        formatted: `${day}.${month}.${year}`,
        dateObj
      };
    }
  }

  // Biçim 3: YYYY-MM-DD
  const isoMatch = clean.match(/\b(20\d{2})-([0-1]\d)-([0-3]\d)\b/);
  if (isoMatch) {
    const year = isoMatch[1];
    const month = isoMatch[2];
    const day = isoMatch[3];
    const iso = `${year}-${month}-${day}`;
    const dateObj = new Date(Date.UTC(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10), 23, 59, 59));
    return {
      iso,
      formatted: `${day}.${month}.${year}`,
      dateObj
    };
  }

  return null;
}

/**
 * Verilen son başvuru tarihinin geçip geçmediğini denetler
 */
function isDateExpired(dateStr) {
  if (!dateStr) return false;
  const parsed = parseTurkishDate(dateStr);
  if (!parsed || !parsed.dateObj) return false;

  // Şu anki TR saati (UTC+3)
  const now = new Date();
  return now.getTime() > parsed.dateObj.getTime();
}

/**
 * Metin içindeki fazla boşluk ve HTML varlıklarını temizler
 */
function cleanHtmlText(text) {
  if (!text) return '';
  return String(text)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r?\n|\r/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Atomik JSON yazma: Önce geçici (.tmp) dosyaya yazar, ardından asıl dosyanın üzerine taşır.
 * Bu sayede kesintilerde dosyanın bozulması %100 engellenir.
 */
function atomicWriteJson(filePath, data) {
  const absolutePath = path.resolve(filePath);
  const dir = path.dirname(absolutePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmpPath = `${absolutePath}.tmp.${Date.now()}`;
  const jsonContent = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmpPath, jsonContent, 'utf-8');
  fs.renameSync(tmpPath, absolutePath);
}

/**
 * JSON dosyasını güvenli okur, dosya yoksa veya bozuksa defaultValue döndürür.
 */
function readJsonSafe(filePath, defaultValue = {}) {
  try {
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) {
      return defaultValue;
    }
    const content = fs.readFileSync(absolutePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.warn(`[UYARI] JSON dosyası okunamadı (${filePath}): ${err.message}`);
    return defaultValue;
  }
}

/**
 * Türkiye saatiyle biçimlendirilmiş zaman damgası döndürür
 */
function getTurkeyTimestamp() {
  const d = new Date();
  // UTC+3 ofseti ekleme
  const trDate = new Date(d.getTime() + (3 * 60 * 60 * 1000));
  const day = String(trDate.getUTCDate()).padStart(2, '0');
  const month = String(trDate.getUTCMonth() + 1).padStart(2, '0');
  const year = trDate.getUTCFullYear();
  const hour = String(trDate.getUTCHours()).padStart(2, '0');
  const minute = String(trDate.getUTCMinutes()).padStart(2, '0');
  const second = String(trDate.getUTCSeconds()).padStart(2, '0');
  return `${day}.${month}.${year} ${hour}:${minute}:${second}`;
}

module.exports = {
  DEFAULT_HEADERS,
  fetchWithRetry,
  decodeBuffer,
  loadHtml,
  sanitizeErrorMessage,
  generateContentHash,
  generatePostingId,
  parseTurkishDate,
  isDateExpired,
  cleanHtmlText,
  atomicWriteJson,
  readJsonSafe,
  getTurkeyTimestamp
};
