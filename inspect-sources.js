const { fetchWithRetry, cleanHtmlText, loadHtml } = require('./lib/utils');

async function inspectNewSources() {
  // 1. Kariyer.net
  console.log('=== KARİYER.NET İNCELEME ===');
  try {
    const res = await fetchWithRetry('https://www.kariyer.net/is-ilanlari/memur?pst=2168');
    const html = await res.text();
    const $ = loadHtml(html);
    // Linkleri ve ilan kartlarını ara
    let count = 0;
    $('a').each((i, el) => {
      const href = el.attr ? el.attr('href') : '';
      const text = cleanHtmlText(el.text ? el.text() : '');
      if (href && (href.includes('/is-ilani/') || href.includes('ilan')) && text.length > 10 && count < 10) {
        console.log('Kariyer:', href, '->', text);
        count++;
      }
    });
    // script __NUXT__ verisi var mı?
    if (html.includes('window.__NUXT__') || html.includes('__NUXT_DATA__')) {
      console.log('Nuxt verisi mevcut!');
    }
  } catch(e) { console.error('Kariyer hata:', e.message); }

  // 2. kamupersonelialimi.com
  console.log('\n=== KAMUPERSONELİALİMİ.COM İNCELEME ===');
  try {
    const res = await fetchWithRetry('https://kamupersonelialimi.com/');
    const html = await res.text();
    const $ = loadHtml(html);
    let count = 0;
    $('a').each((i, el) => {
      const href = el.attr ? el.attr('href') : '';
      const text = cleanHtmlText(el.text ? el.text() : '');
      if (href && (href.includes('/haber/') || href.includes('.html') || href.includes('ilan') || href.includes('-alimi') || href.includes('-personel')) && text.length > 20 && count < 10) {
        console.log('KP Alimi:', href, '->', text);
        count++;
      }
    });
  } catch(e) { console.error('KP Alimi hata:', e.message); }

  // 3. kamupersonelialim.com
  console.log('\n=== KAMUPERSONELİALİM.COM İNCELEME ===');
  try {
    const res = await fetchWithRetry('https://kamupersonelialim.com/');
    const html = await res.text();
    const $ = loadHtml(html);
    let count = 0;
    $('a').each((i, el) => {
      const href = el.attr ? el.attr('href') : '';
      const text = cleanHtmlText(el.text ? el.text() : '');
      if (href && text.length > 25 && (text.includes('Alım') || text.includes('Personel') || text.includes('Memur') || text.includes('İşçi') || text.includes('KPSS')) && count < 10) {
        console.log('KP Alim:', href, '->', text);
        count++;
      }
    });
  } catch(e) { console.error('KP Alim hata:', e.message); }
}

inspectNewSources();
