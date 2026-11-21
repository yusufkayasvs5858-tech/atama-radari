const { fetchWithRetry } = require('./lib/utils');

async function testNewSources() {
  const urls = [
    'https://www.kariyer.net/is-ilanlari/memur?pst=2168',
    'https://share.google/BDB9GAvN4yUKGqlx4',
    'https://share.google/fwLwR4FZOgiYO5UFr'
  ];

  for (const url of urls) {
    console.log('\n--- Test Ediliyor:', url);
    try {
      const res = await fetchWithRetry(url, { timeoutMs: 15000, retries: 1 });
      console.log('Status:', res.status, 'Final URL:', res.url);
      const text = await res.text();
      console.log('Response Length:', text.length);
      console.log('Sample content:', text.slice(0, 400).replace(/\s+/g, ' '));
    } catch (err) {
      console.error('Hata:', err.message);
    }
  }
}

testNewSources();
