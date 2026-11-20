const { sendNtfyNotification, sendTelegramNotification } = require('./lib/notifier');
const { getTurkeyTimestamp } = require('./lib/utils');

async function runNotificationTest() {
  console.log('='.repeat(65));
  console.log('📱 ATAMA RADARI BİLDİRİM VE TELEFON TEST ARACI');
  console.log(`⏰ Zaman: ${getTurkeyTimestamp()}`);
  console.log('='.repeat(65));

  const ntfyTopic = process.env.NTFY_TOPIC;
  const ntfyToken = process.env.NTFY_TOKEN;
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChatId = process.env.TELEGRAM_CHAT_ID;

  console.log('\n[AYAR KONTROLÜ]');
  console.log(`- NTFY_TOPIC:          ${ntfyTopic ? `✅ Ayarlı (${ntfyTopic})` : '❌ TANIMLI DEĞİL'}`);
  console.log(`- NTFY_TOKEN:          ${ntfyToken ? '✅ Ayarlı (Gizli)' : 'ℹ️  Tanımsız (Genel konu kullanılıyor)'}`);
  console.log(`- TELEGRAM_BOT_TOKEN:  ${tgToken ? '✅ Ayarlı (Gizli)' : '❌ TANIMLI DEĞİL'}`);
  console.log(`- TELEGRAM_CHAT_ID:    ${tgChatId ? `✅ Ayarlı (${tgChatId})` : '❌ TANIMLI DEĞİL'}`);

  if (!ntfyTopic && (!tgToken || !tgChatId)) {
    console.error('\n⚠️  DİKKAT: Hiçbir bildirim kanalı tanımlı değil!');
    console.log('\nTelefona bildirim almak için şu yollardan birini izleyin:');
    console.log('1. NTFY İLE (Ücretsiz ve Hesap Açmadan):');
    console.log('   - Telefonunuza ntfy uygulamasını indirin (Google Play veya App Store).');
    console.log('   - "+" butonuna basıp benzersiz bir konu (topic) adı belirleyin (Örn: atama_radari_yusuf_2026).');
    console.log('   - Ortam değişkeni veya GitHub Secret olarak NTFY_TOPIC=atama_radari_yusuf_2026 tanımlayın.\n');
    console.log('2. TELEGRAM İLE (En Güvenilir & Hızlı Çözüm):');
    console.log('   - Telegram\'da @BotFather ile bir bot oluşturup token alın (TELEGRAM_BOT_TOKEN).');
    console.log('   - Botunuza /start mesajı atıp @userinfobot yardımıyla Chat ID\'nizi alın (TELEGRAM_CHAT_ID).');
    console.log('   - Bu bilgileri GitHub Secrets veya .env dosyanıza ekleyin.\n');
    process.exit(1);
  }

  // 1. NTFY TESTİ
  if (ntfyTopic) {
    console.log(`\n📡 [ntfy.sh] '${ntfyTopic}' konusuna test bildirimi gönderiliyor...`);
    const ntfyRes = await sendNtfyNotification({
      topic: ntfyTopic,
      token: ntfyToken,
      title: '🟢 [TEST BAŞARILI] Atama Radarı Telefonda!',
      message: 'Tebrikler! Atama Radarı bildirim sistemi telefonunuza başarıyla bağlandı. Yeni KPSS P94 ve kamu ilanları anında buraya iletilecek.',
      url: 'https://resmigazete.gov.tr',
      priority: 5, // En yüksek öncelik (sesli ve banner)
      tags: ['tada', 'white_check_mark', 'rocket']
    });

    if (ntfyRes.ok) {
      console.log('✅ [ntfy.sh] Bildirim başarıyla iletildi! Lütfen telefonunuzun ekranını kontrol edin.');
    } else {
      console.error(`❌ [ntfy.sh] Bildirim gönderilemedi: ${ntfyRes.error}`);
    }
  }

  // 2. TELEGRAM TESTİ
  if (tgToken && tgChatId) {
    console.log(`\n💬 [Telegram] Chat ID ${tgChatId}'ye test mesajı gönderiliyor...`);
    const tgHtml = [
      `<b>🟢 [TEST BAŞARILI] ATAMA RADARI TELEGRAM ENTEGRASYONU</b>`,
      ``,
      `Tebrikler! Telegram bildirim motoru kusursuz çalışıyor.`,
      `Resmî Gazete, SBB Kamu İlan, Sağlık ve Adalet Bakanlığı ilanları tarandığında uygun kadrolar anında telefonunuza düşecektir.`,
      ``,
      `⏰ <b>Test Zamanı:</b> <code>${getTurkeyTimestamp()}</code>`
    ].join('\n');

    const tgRes = await sendTelegramNotification({
      botToken: tgToken,
      chatId: tgChatId,
      text: tgHtml,
      url: 'https://resmigazete.gov.tr'
    });

    if (tgRes.ok) {
      console.log('✅ [Telegram] Bildirim başarıyla iletildi! Telegram uygulamanızı kontrol edin.');
    } else {
      console.error(`❌ [Telegram] Bildirim gönderilemedi: ${tgRes.error}`);
    }
  }

  console.log('\n' + '='.repeat(65));
  console.log('🏁 Bildirim testi tamamlandı.');
  console.log('='.repeat(65));
}

runNotificationTest().catch(console.error);
