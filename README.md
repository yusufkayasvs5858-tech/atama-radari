# 🎯 Atama Radarı v2.1 (KPSS P94 & Kamu Personeli Alım Takip Sistemi)

> **Otomatik Resmî Gazete, SBB Kamu İlan, Sağlık, Adalet ve Gençlik Spor Bakanlığı Tarayıcısı, KPSS P94 Uygunluk Analiz Motoru ve Telefona Anlık Bildirim Sistemi.**

---

## 📱 TELEFONUMA BİLDİRİM GELMEME SORUNU VE KÖKTEN ÇÖZÜMÜ

Eski sürümde telefonunuza bildirim gelmemesinin **4 temel teknik nedeni** tespit edilmiş ve v2.1 sürümünde tamamen giderilmiştir:

1. **`notified.json` Yanlış Pozitif Engeli (Kritik):**
   - Eski kodda bir ilan tarandığında, bildirim telefona henüz **ulaşamamış veya ağ hatası almış olsa bile** doğrudan `notified.json` dosyasına yazılıyordu.
   - Sonuç olarak dosya ilanı "zaten bildirilmiş" işaretlediği için sonraki hiçbir taramada bir daha bildirim göndermiyordu.
   - **Çözüm:** Yeni mimaride `notified.json` yalnızca bildirim sunucusundan **HTTP 200 (Başarılı)** yanıtı alındıktan sonra güncellenir. Başarısız bildirimler bir sonraki taramada yeniden denenir.

2. **HTTP Başlıklarında (Header) Türkçe Karakter Kırılması:**
   - Node.js fetch motoru, HTTP başlıklarında (`Title: Sağlık Bakanlığı Sürekli İşçi Alımı`) Türkçe karakterler (`ş, ğ, ı, İ, ö, ü`) gönderildiğinde `TypeError: Byte string must not contain non-ISO-8859-1 characters` hatası fırlatıp bildirimi anında düşürüyordu.
   - **Çözüm:** `ntfy.sh` API'si HTTP başlığı yerine doğrudan **JSON Gövdesi (Payload)** üzerinden çalışacak şekilde yeniden yazıldı. Türkçe karakter sorunu %100 çözüldü.

3. **Android & iOS Pil Tasarrufu ve Öncelik (Priority) Sorunu:**
   - Bildirimler standart öncelikle gönderildiğinde Xiaomi, Samsung, Huawei ve iPhone telefonlar bildirimi arka planda sessize alır veya hiç göstermez.
   - **Çözüm:** Yeşil (Tam Uyumlu) ilanlar için `priority: 5` (Urgent / Acil) tanımlandı. Artık telefonunuz kilitliyken dahi sesli çalar ve kilit ekranı banner'ı düşürür.

4. **Telegram Bot Entegrasyonu (Kesintisiz Alternatif):**
   - GitHub Actions workflow'una ve notifier motoruna doğrudan **Telegram Bot API** desteği eklendi. Telegram botu kurduğunuzda bildirimler sıfır gecikmeyle ve %100 başarıyla cebinize düşer.

---

## 🚀 5 Dakikada Telefonda Bildirimi Aktif Etme

### Seçenek 1: ntfy.sh ile (En Kolay — Kayıt Gerektirmez)
1. Telefonunuza **ntfy** uygulamasını indirin ([Google Play](https://play.google.com/store/apps/details?id=io.heckel.ntfy) veya [App Store](https://apps.apple.com/us/app/ntfy/id1625396347)).
2. Uygulamayı açıp sağ alttaki **`+`** butonuna basın.
3. Kendinize özel, tahmin edilemez bir konu (topic) adı yazıp abone olun (Örn: `atama_radari_yusuf_2026`).
4. Telefon ayarlarından ntfy uygulaması için **"Pil Tasarrufunu Kapat"** ve **"Bildirim İzinlerini Aç"** yapın.
5. GitHub deponuzda **Settings -> Secrets and variables -> Actions** bölümüne gidin:
   - Secret Adı: `NTFY_TOPIC`
   - Secret Değeri: Belirlediğiniz konu adı (Örn: `atama_radari_yusuf_2026`).

---

### Seçenek 2: Telegram Botu ile (En Güvenilir & Hızlı)
1. Telegram uygulamasında [@BotFather](https://t.me/BotFather)'ı açıp `/newbot` yazarak kendi bildirim botunuzu oluşturun.
2. BotFather'ın verdiği **API Token**'ı kopyalayın (Bu `TELEGRAM_BOT_TOKEN` olacak).
3. Botunuza Telegram'dan `/start` yazın.
4. [@userinfobot](https://t.me/userinfobot)'a mesaj atarak kendi **Chat ID** numaranızı öğrenin (Bu `TELEGRAM_CHAT_ID` olacak).
5. GitHub deponuzda Secrets bölümüne şu iki bilgiyi ekleyin:
   - `TELEGRAM_BOT_TOKEN`: BotFather'dan aldığınız token.
   - `TELEGRAM_CHAT_ID`: Sayısal kullanıcı ID'niz.

---

## ⚡ Tek Tıkla Telefon Bildirimini Test Etme

Sistemin telefonunuza bildirim atıp atmadığını hemen test etmek için terminalde şu komutu çalıştırabilirsiniz:

```bash
# Windows PowerShell veya CMD:
$env:NTFY_TOPIC="atama_radari_yusuf_2026"
node test-notify.js
```
*(Veya Telegram bilgilerinizi `$env:TELEGRAM_BOT_TOKEN` ve `$env:TELEGRAM_CHAT_ID` olarak girip çalıştırın.)*

Ekranda:
```text
✅ [ntfy.sh] Bildirim başarıyla iletildi! Lütfen telefonunuzun ekranını kontrol edin.
✅ [Telegram] Bildirim başarıyla iletildi! Telegram uygulamanızı kontrol edin.
```
mesajını göreceksiniz ve telefonunuz anında çalacaktır!

---

## 🛠️ Proje Mimarisi

```text
atama-radari/
├── .github/workflows/
│   └── radar.yml               # Günde 3 kez (08:00, 13:00, 19:00) otomatik çalışan tarama
├── data/
│   ├── ilanlar.json            # Taranan ve sınıflandırılan aktif kamu ilanları
│   ├── notified.json           # Çift bildirim engelleyici veritabanı
│   └── scan-report.json        # Son tarama analizi ve kaynak istatistikleri
├── lib/
│   ├── qualifications.js       # 2001, 6506, 6225 vb. KPSS nitelik kodları sözlüğü
│   ├── matcher.js              # Aday profili (P94, Ortaöğretim, Ehliyet) eşleştirici
│   ├── notifier.js             # ntfy.sh JSON API ve Telegram Bot bildirim motoru
│   ├── utils.js                # Windows-1254 Türkçe çözücü, tarih ayrıştırıcı, atomik yazıcı
│   └── scrapers/               # Modüler kazıma motorları:
│       ├── resmigazete.js      # Resmî Gazete Çeşitli İlanlar (-4.htm) tarayıcısı
│       ├── kamuilan.js         # Cumhurbaşkanlığı SBB Kamu İlan portalı
│       ├── osym.js             # ÖSYM KPSS tercih kılavuzları ve yerleştirme duyuruları
│       ├── saglik.js           # T.C. Sağlık Bakanlığı (YHGM) sürekli işçi ve personel alımları
│       ├── adalet.js           # T.C. Adalet Bakanlığı (PGM) Zabıt Katibi / İKM alımları
│       ├── gsb.js              # T.C. Gençlik ve Spor Bakanlığı destek personeli alımları
│       ├── iskur.js            # T.C. İŞKUR kamu işgücü alımları
│       └── kariyerKapisi.js    # CBİKO Kariyer Kapısı alımları
├── index.html                  # Modern, Tailwind CSS tabanlı Canlı Takip Paneli
├── scraper.js                  # Ana tarama, analiz ve bildirim yürütücüsü
├── test.js                     # 13 adet otomatik birim testi
├── test-notify.js              # Doğrudan telefona test bildirimi atma aracı
└── package.json                # Bağımlılıklar ve komutlar
```

---

## 🎯 Aday Profili Nasıl Özelleştirilir?

Varsayılan aday profili:
- **Eğitim:** Ortaöğretim (Lise)
- **KPSS Puanı:** P94 (75.0 Puan)
- **Ehliyet:** B Sınıfı Sürücü Belgesi (6506)
- **Sertifika:** MEB Onaylı Bilgisayar İşletmeni (6225)
- **Nitelik Kodları:** 2001 (Düz Lise), 6506 (B Ehliyet), 7225 (Güvenlik Soruşturması), 7300 (Vardiya)

Farklı bir puan veya bölüm için GitHub Secret olarak `USER_PROFILE_JSON` değişkenine kendi profilinizi JSON olarak ekleyebilirsiniz:

```json
{
  "name": "Yusuf (Özel Profil)",
  "educationLevel": "Ortaöğretim",
  "kpss": {
    "type": "P94",
    "score": 78.5
  },
  "licenses": ["B"],
  "certificates": ["MEB Onaylı Bilgisayar İşletmeni"],
  "qualifications": ["2001", "6506", "6225", "7225", "7300"],
  "gender": "Erkek",
  "preferredCities": ["Ankara", "İstanbul", "İzmir"]
}
```

---

## 💻 Ön Yüz Kontrol Paneli (`index.html`)

`index.html` dosyasını doğrudan herhangi bir tarayıcıda açabilirsiniz.
- **Canlı Metrikler:** Toplam İlan, Tam Uyumlu (Yeşil), İnceleme Gereken (Sarı), Elenen (Kırmızı), Favoriler.
- **Arama & Filtre:** Metin araması, kaynak filtresi, durum filtreleri.
- **Akıllı Kalan Gün Sayacı:** Son başvuru tarihine göre kaç gün kaldığını renkli sayaçlarla gösterir.
- **Favoriye Ekle & İncelendi İşaretle:** Tarayıcınızın `localStorage` hafızasında tutulur.
- **Detay Modalı:** Kadro şartlarını, 2001/6506 kod açıklamalarını ve resmi başvuru linkini tek pencerede sunar.
