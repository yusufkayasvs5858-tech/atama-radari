const { fetchWithRetry } = require('./lib/utils');

async function testKariyerNuxt() {
  const res = await fetchWithRetry('https://www.kariyer.net/is-ilanlari/memur?pst=2168');
  const html = await res.text();
  
  // __NUXT__ script bloğunu bul
  const match = html.match(/<script>\s*window\.__NUXT__\s*=\s*([\s\S]*?)<\/script>/i);
  if (match) {
    console.log('NUXT script bulundu, uzunluk:', match[1].length);
    // İçinde job list veya jobs var mı?
    console.log('jobs var mı:', match[1].includes('jobList') || match[1].includes('jobs') || match[1].includes('items'));
  }

  // HTML içindeki kartları da regex ile ara
  const cardRegex = /<a[^>]*href=["']([^"']*\/is-ilani\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let cm;
  let count = 0;
  while ((cm = cardRegex.exec(html)) !== null && count < 10) {
    console.log('Kariyer Card:', cm[1]);
    count++;
  }
}

testKariyerNuxt();
