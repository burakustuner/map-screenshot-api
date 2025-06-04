const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json());

app.post('/screenshot', async (req, res) => {
  const { lat, lon, zoom } = req.body;

  try {
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    // ✅ Küçük ve optimize çözünürlük
    await page.setViewport({ width: 640, height: 480 });

    const html = generateHtml(lat, lon, zoom);
 await page.setContent(html, { waitUntil: 'networkidle0' });
    // ✅ JPEG çıktı, kalite düşürülerek boyut azaltıldı
    const buffer = await page.screenshot({
      type: 'jpeg',
      quality: 70,
      fullPage: false
    });

    await browser.close();

    res.set('Content-Type', 'image/jpeg');
    res.send(buffer);
  } catch (err) {
    console.error('Screenshot Error:', err);
    res.status(500).send('Error generating screenshot');
  }
});

// 🔧 HTML + OpenLayers haritası
function generateHtml(lat, lon, zoom) {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8" />
    <title>Map Screenshot</title>
    <style>
      html, body, #map {
        margin: 0;
        padding: 0;
        height: 100%;
        width: 100%;
      }
    </style>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ol@v7.3.0/ol.css" />
    <script src="https://cdn.jsdelivr.net/npm/ol@v7.3.0/dist/ol.js"></script>
  </head>
  <body>
    <div id="map"></div>
    <script>
      const map = new ol.Map({
        target: 'map',
        controls: [], // ✅ UI kontrolleri kaldırıldı
        layers: [
          new ol.layer.Tile({
            source: new ol.source.OSM()
          })
          // WMS kaldırıldı - istersen tekrar ekleyebilirsin
        ],
        view: new ol.View({
          center: ol.proj.fromLonLat([${lon}, ${lat}]),
          zoom: ${zoom}
        })
      });
    </script>
  </body>
  </html>`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
