const { fetchWithRetry, sanitizeErrorMessage, getTurkeyTimestamp, atomicWriteJson } = require('./utils');

const DASHBOARD_URL = 'https://yusufkayasvs5858-tech.github.io/atama-radari/';

/**
 * ntfy.sh üzerinden bildirim gönderir
 * JSON gövdesi kullanılarak HTTP başlıklarındaki Türkçe karakter (ISO-8859-1) hatası %100 önlenir.
 */
async function sendNtfyNotification(options = {}) {
  const {
    topic,
    token,
    title,
    message,
    url,
    priority = 4, // 1 (min) - 5 (max)
    tags = ['briefcase', 'bell']
  } = options;

  if (!topic) {
    return { ok: false, service: 'ntfy', error: 'NTFY_TOPIC tanımlı değil' };
  }

  // Güvenli topic adı (boşluk ve Türkçe karakter içermeyen)
  const cleanTopic = String(topic).trim();
  const endpoint = 'https://ntfy.sh';

  const headers = {
    'Content-Type': 'application/json'
  };

  if (token && String(token).trim()) {
    headers['Authorization'] = `Bearer ${String(token).trim()}`;
  }

  const isSafeUrl = typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'));

  const payload = {
    topic: cleanTopic,
    title: title || 'Atama Radarı Bildirimi',
    message: message || '',
    priority: Number(priority) || 4,
    tags: Array.isArray(tags) ? tags : ['bell'],
    click: isSafeUrl ? url : DASHBOARD_URL,
    actions: [
      {
        action: 'view',
        label: 'Canlı Takip Paneli 🌐',
        url: DASHBOARD_URL
      },
      ...(isSafeUrl ? [{ action: 'view', label: 'Resmi İlana Git 🔗', url }] : [])
    ]
  };

  try {
    const res = await fetchWithRetry(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      timeoutMs: 15000,
      retries: 2
    });

    if (res.ok) {
      return { ok: true, service: 'ntfy', status: res.status };
    }

    const errText = await res.text().catch(() => '');
    return {
      ok: false,
      service: 'ntfy',
      error: `HTTP ${res.status}: ${errText.slice(0, 200)}`
    };
  } catch (err) {
    return {
      ok: false,
      service: 'ntfy',
      error: sanitizeErrorMessage(err)
    };
  }
}

/**
 * Telegram Bot API üzerinden bildirim gönderir
 */
async function sendTelegramNotification(options = {}) {
  const {
    botToken,
    chatId,
    text,
    url
  } = options;

  if (!botToken || !chatId) {
    return { ok: false, service: 'telegram', error: 'TELEGRAM_BOT_TOKEN veya TELEGRAM_CHAT_ID tanımlı değil' };
  }

  const endpoint = `https://api.telegram.org/bot${String(botToken).trim()}/sendMessage`;
  const isSafeUrl = typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'));

  const inlineKeyboard = [
    [
      { text: '🌐 Canlı Takip Paneli', url: DASHBOARD_URL }
    ]
  ];

  if (isSafeUrl) {
    inlineKeyboard[0].unshift({ text: '🔗 Resmi İlana Git', url });
  }

  const payload = {
    chat_id: String(chatId).trim(),
    text: text || '',
    parse_mode: 'HTML',
    disable_web_page_preview: false,
    reply_markup: {
      inline_keyboard: inlineKeyboard
    }
  };

  try {
    const res = await fetchWithRetry(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeoutMs: 15000,
      retries: 2
    });

    const data = await res.json().catch(() => null);
    if (res.ok && data && data.ok) {
      return { ok: true, service: 'telegram' };
    }

    return {
      ok: false,
      service: 'telegram',
      error: data?.description || `HTTP ${res.status}`
    };
  } catch (err) {
    return {
      ok: false,
      service: 'telegram',
      error: sanitizeErrorMessage(err)
    };
  }
}

/**
 * Bir ilan için formatlı bildirim metinleri hazırlar ve hem ntfy hem Telegram'a gönderir
 */
async function notifyPosting(posting, envConfig = {}) {
  const ntfyTopic = envConfig.NTFY_TOPIC || process.env.NTFY_TOPIC;
  const ntfyToken = envConfig.NTFY_TOKEN || process.env.NTFY_TOKEN;
  const tgToken = envConfig.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const tgChatId = envConfig.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID;

  const isGreen = posting.status === 'YESIL';
  const icon = isGreen ? '🟢' : '🟡';
  const priority = isGreen ? 5 : 4; // Yeşil ilanlar yüksek öncelikli sesli çalar

  const title = `${icon} [${posting.status}] ${posting.institution || 'Yeni Kamu İlanı'}`;
  
  // Düz metin bildirim (ntfy)
  const ntfyMessage = [
    `📌 Unvan: ${posting.title || 'Belirtilmemiş'}`,
    `🏢 Kurum: ${posting.institution || 'Kamu Kurumu'}`,
    `📍 Şehir: ${posting.city || 'Tüm Türkiye'}`,
    `👥 Kontenjan: ${posting.quota || 'Belirtilmemiş'}`,
    `📅 Son Başvuru: ${posting.deadline || 'Belirtilmemiş'}`,
    `🎯 Puan/Nitelik: ${posting.kpssType || 'P94'} | ${posting.matchReason || ''}`,
    `🔗 İlan Bağlantısı: ${posting.url || 'Belirtilmemiş'}`,
    `🌐 Canlı Takip Paneli: ${DASHBOARD_URL}`
  ].join('\n');

  // HTML formatlı Telegram bildirimi
  const tgHtml = [
    `<b>${icon} YENİ KAMU ATAMA İLANI TESPİT EDİLDİ</b>`,
    `<b>Durum:</b> #${posting.status} (${isGreen ? 'Tam Uyumlu' : 'İnceleme Gerekli'})`,
    ``,
    `🏛 <b>Kurum:</b> ${escapeHtml(posting.institution || '')}`,
    `💼 <b>Kadro/Unvan:</b> ${escapeHtml(posting.title || '')}`,
    `📍 <b>Şehir:</b> ${escapeHtml(posting.city || 'Tüm İller')}`,
    `👥 <b>Kontenjan:</b> ${escapeHtml(String(posting.quota || 'Belirtilmemiş'))}`,
    `📅 <b>Son Başvuru:</b> <code>${posting.deadline || 'Belirtilmemiş'}</code>`,
    `🎓 <b>Öğrenim:</b> ${escapeHtml(posting.educationLevel || 'Ortaöğretim')}`,
    `📊 <b>KPSS:</b> ${escapeHtml(posting.kpssType || 'P94')} (Taban: ${posting.minKpssScore || 'Belirtilmedi'})`,
    ``,
    `💡 <i>${escapeHtml(posting.matchReason || '')}</i>`,
    ``,
    `🔗 <b>İlan Bağlantısı:</b> <a href="${escapeHtml(posting.url || '')}">${escapeHtml(posting.url || 'Belirtilmedi')}</a>`,
    `🌐 <b>Canlı Takip Paneli:</b> <a href="${DASHBOARD_URL}">${DASHBOARD_URL}</a>`
  ].join('\n');

  const results = [];

  // ntfy gönderimi
  if (ntfyTopic) {
    const ntfyRes = await sendNtfyNotification({
      topic: ntfyTopic,
      token: ntfyToken,
      title,
      message: ntfyMessage,
      url: posting.url,
      priority,
      tags: isGreen ? ['tada', 'white_check_mark', 'briefcase'] : ['warning', 'clipboard']
    });
    results.push(ntfyRes);
  }

  // Telegram gönderimi
  if (tgToken && tgChatId) {
    const tgRes = await sendTelegramNotification({
      botToken: tgToken,
      chatId: tgChatId,
      text: tgHtml,
      url: posting.url
    });
    results.push(tgRes);
  }

  if (!ntfyTopic && (!tgToken || !tgChatId)) {
    return {
      sent: false,
      reason: 'Hiçbir bildirim kanalı (NTFY_TOPIC veya TELEGRAM_BOT_TOKEN+CHAT_ID) yapılandırılmamış'
    };
  }

  const anySuccess = results.some((r) => r.ok);
  return {
    sent: anySuccess,
    results
  };
}

/**
 * Tarama tamamlandığında yeni ilan çıkmasa dahi kullanıcının sistemin çalıştığını
 * teyit edebilmesi için gönderilen periyodik durum (heartbeat) bildirimi
 */
async function sendHeartbeatNotification(envConfig = {}, stats = {}) {
  const ntfyTopic = envConfig.NTFY_TOPIC || process.env.NTFY_TOPIC;
  const ntfyToken = envConfig.NTFY_TOKEN || process.env.NTFY_TOKEN;
  const tgToken = envConfig.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const tgChatId = envConfig.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID;

  const now = getTurkeyTimestamp();
  const title = `ℹ️ Atama Radarı: Tarama tamamlandı`;
  const message = `Atama Radarı: 2 saatlik periyodik tarama tamamlandı, şu an yeni uygun ilan bulunamadı.\nAktif İlanlar: ${stats.total || 0} | Yeşil: ${stats.green || 0} | Sarı: ${stats.yellow || 0}\nSaat: ${now}\n🌐 ${DASHBOARD_URL}`;

  const tgHtml = [
    `ℹ️ <b>ATAMA RADARI: 2 SAATLİK TARAMA TAMAMLANDI</b>`,
    ``,
    `Resmi kaynaklar başarıyla kontrol edildi. Bu taramada kriterlerinize uygun yeni bir ilan bulunamadı.`,
    `📊 <b>Veritabanı:</b> Toplam ${stats.total || 0} aktif ilan izleniyor (🟢 ${stats.green || 0} Yeşil, 🟡 ${stats.yellow || 0} Sarı).`,
    `⏰ <b>Tarama Zamanı:</b> <code>${now}</code>`,
    ``,
    `🌐 <b>Canlı Takip Paneli:</b> <a href="${DASHBOARD_URL}">atama-radari.github.io</a>`
  ].join('\n');

  const results = [];

  if (ntfyTopic) {
    const res = await sendNtfyNotification({
      topic: ntfyTopic,
      token: ntfyToken,
      title,
      message,
      url: DASHBOARD_URL,
      priority: 2, // Sessiz / düşük öncelik
      tags: ['arrows_counterclockwise', 'white_check_mark']
    });
    results.push(res);
  }

  if (tgToken && tgChatId) {
    const res = await sendTelegramNotification({
      botToken: tgToken,
      chatId: tgChatId,
      text: tgHtml,
      url: DASHBOARD_URL
    });
    results.push(res);
  }

  return results;
}

/**
 * HTML özel karakterlerini kaçırır
 */
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Yeni tespit edilen YEŞİL ve SARI ilanlar için bildirim gönderir ve notified.json'ı günceller
 */
async function dispatchNotifications(postings, notifiedDb, notifiedDbPath, envConfig = {}) {
  let sentCount = 0;
  let skippedCount = 0;
  let failCount = 0;

  for (const posting of postings) {
    // Sadece YEŞİL ve SARI ilanlar bildirilir (KIRMIZI elenir)
    if (posting.status !== 'YESIL' && posting.status !== 'SARI') {
      continue;
    }

    // Daha önce bildirilmiş mi kontrol et
    if (notifiedDb[posting.id]) {
      skippedCount++;
      continue;
    }

    console.log(`[BİLDİRİM] Gönderiliyor: ${posting.institution} - ${posting.title} (${posting.status})`);
    const res = await notifyPosting(posting, envConfig);

    if (res.sent) {
      sentCount++;
      notifiedDb[posting.id] = {
        lastNotifiedAt: getTurkeyTimestamp(),
        contentHash: posting.contentHash,
        status: posting.status,
        title: posting.title,
        institution: posting.institution
      };
      if (notifiedDbPath) {
        atomicWriteJson(notifiedDbPath, notifiedDb);
      }
    } else {
      failCount++;
      console.warn(`[BİLDİRİM BAŞARISIZ] ${posting.title}:`, res.results || res.reason);
    }
  }

  return {
    sentCount,
    skippedCount,
    failCount
  };
}

module.exports = {
  DASHBOARD_URL,
  sendNtfyNotification,
  sendTelegramNotification,
  notifyPosting,
  sendHeartbeatNotification,
  dispatchNotifications
};
