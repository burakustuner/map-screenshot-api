/*
Name: map-screenshoot-api
Author: burakustuner
Date:8.06.2025
GPT-Assisted:(Model: GPT-4o)
Description: Express.js + Puppeteer tabanlı, WMS destekli harita ekran görüntüsü servisi.
*/

const express = require('express');
const puppeteer = require('puppeteer');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(express.json());

// Rate Limiting - IP başına 1 dakikada 10 istek
const screenshotLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 15 dakika
  max: 60, // IP başına maksimum 60 istek
  message: {
    error: 'Too many screenshot requests, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Browser Pool Class - Performans için browser instance'ları yeniden kullanma
class BrowserPool {
  constructor() {
    this.browsers = [];
    this.maxSize = 3;
    this.inUse = new Set();
  }

  async getBrowser() {
    // Mevcut browser varsa kullan
    if (this.browsers.length > 0) {
      const browser = this.browsers.pop();
      this.inUse.add(browser);
      return browser;
    }

    // Yeni browser oluştur
    const browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });
    this.inUse.add(browser);
    return browser;
  }

  releaseBrowser(browser) {
    this.inUse.delete(browser);
    
    if (this.browsers.length < this.maxSize) {
      this.browsers.push(browser);
    } else {
      browser.close().catch(console.error);
    }
  }

  async cleanup() {
    // Tüm browser'ları temizle
    const allBrowsers = [...this.browsers, ...this.inUse];
    await Promise.all(allBrowsers.map(browser => browser.close().catch(console.error)));
    this.browsers = [];
    this.inUse.clear();
  }
}

const browserPool = new BrowserPool();

// Input Validation Function
function validateInput(lat, lon, zoom, width, height, wms, pin) {
  const errors = [];

  // Latitude kontrolü
  if (typeof lat !== 'number' || lat < -90 || lat > 90) {
    errors.push('Latitude must be a number between -90 and 90');
  }

  // Longitude kontrolü  
  if (typeof lon !== 'number' || lon < -180 || lon > 180) {
    errors.push('Longitude must be a number between -180 and 180');
  }

  // Zoom kontrolü
  if (typeof zoom !== 'number' || zoom < 1 || zoom > 20) {
    errors.push('Zoom must be a number between 1 and 20');
  }

  // Width kontrolü
  if (width && (typeof width !== 'number' || width < 50 || width > 2000)) {
    errors.push('Width must be a number between 100 and 2000');
  }

  // Height kontrolü
  if (height && (typeof height !== 'number' || height < 50 || height > 2000)) {
    errors.push('Height must be a number between 100 and 2000');
  }

  // WMS katmanları kontrolü
  if (wms) {
    if (!Array.isArray(wms)) {
      errors.push('WMS must be an array of layer objects');
    } else {
      if (wms.length > 5) {
        errors.push('Maximum 5 WMS layers allowed');
      }
      
      wms.forEach((layer, index) => {
        if (!layer.url || typeof layer.url !== 'string') {
          errors.push(`WMS layer ${index + 1}: URL is required and must be a string`);
        }
        if (!layer.layers || typeof layer.layers !== 'string') {
          errors.push(`WMS layer ${index + 1}: layers parameter is required and must be a string`);
        }
        if (layer.opacity !== undefined && (typeof layer.opacity !== 'number' || layer.opacity < 0 || layer.opacity > 1)) {
          errors.push(`WMS layer ${index + 1}: opacity must be a number between 0 and 1`);
        }
      });
    }
  }

  // Pin kontrolü
  if (pin) {
    if (typeof pin !== 'object' || Array.isArray(pin)) {
      errors.push('Pin must be an object');
    } else {
      if (pin.lat !== undefined && (typeof pin.lat !== 'number' || pin.lat < -90 || pin.lat > 90)) {
        errors.push('Pin latitude must be a number between -90 and 90');
      }
      if (pin.lon !== undefined && (typeof pin.lon !== 'number' || pin.lon < -180 || pin.lon > 180)) {
        errors.push('Pin longitude must be a number between -180 and 180');
      }
      if (pin.text && typeof pin.text !== 'string') {
        errors.push('Pin text must be a string');
      }
      if (pin.text && pin.text.length > 50) {
        errors.push('Pin text cannot exceed 50 characters');
      }
      if (pin.color && typeof pin.color !== 'string') {
        errors.push('Pin color must be a valid color string');
      }
      if (pin.size && (typeof pin.size !== 'number' || pin.size < 1 || pin.size > 50)) {
        errors.push('Pin size must be a number between 10 and 50');
      }
    }
  }

  return errors;
}

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'Map Screenshot API',
    version: '1.1.0',
    uptime: process.uptime()
  });
});

// GET Screenshot Endpoint - Query parameters ile
app.get('/screenshot', screenshotLimiter, async (req, res) => {
  const { 
    lat, 
    lon, 
    zoom, 
    width = 640, 
    height = 480, 
    format = 'jpeg',
    quality = 70
  } = req.query;

  // Query parametrelerini number'a çevir
  const numLat = parseFloat(lat);
  const numLon = parseFloat(lon);
  const numZoom = parseInt(zoom);
  const numWidth = parseInt(width);
  const numHeight = parseInt(height);
  const numQuality = parseInt(quality);

  // Temel parametre kontrolü
  if (isNaN(numLat) || isNaN(numLon) || isNaN(numZoom)) {
    return res.status(400).json({
      error: 'Missing or invalid required parameters',
      required: ['lat', 'lon', 'zoom'],
      example: '/screenshot?lat=41.0082&lon=28.9784&zoom=15'
    });
  }

  // Input validation
  const validationErrors = validateInput(numLat, numLon, numZoom, numWidth, numHeight);
  if (validationErrors.length > 0) {
    return res.status(400).json({
      error: 'Validation failed',
      details: validationErrors,
      example: '/screenshot?lat=41.0082&lon=28.9784&zoom=15&width=800&height=600'
    });
  }

  // Format kontrolü
  const supportedFormats = ['jpeg', 'png', 'webp'];
  if (!supportedFormats.includes(format)) {
    return res.status(400).json({
      error: 'Unsupported format',
      supported: supportedFormats,
      example: '/screenshot?lat=41.0082&lon=28.9784&zoom=15&format=png'
    });
  }

  // Quality kontrolü (sadece jpeg için)
  if (format === 'jpeg' && (numQuality < 1 || numQuality > 100)) {
    return res.status(400).json({
      error: 'Quality must be between 1 and 100 for JPEG format'
    });
  }

  let browser = null;

  try {
    console.log(`GET Screenshot request: lat=${numLat}, lon=${numLon}, zoom=${numZoom}, ${numWidth}x${numHeight}, ${format}`);
    
    browser = await browserPool.getBrowser();
    const page = await browser.newPage();
    
    await page.setViewport({ width: numWidth, height: numHeight });

    // GET request'te WMS desteği yok (çok karmaşık olur)
    const html = generateHtml(numLat, numLon, numZoom, null);
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    await page.waitForFunction(
      () => document.title === 'ready',
      { timeout: 20000 }
    );

    await new Promise(resolve => setTimeout(resolve, 1000));

    const screenshotOptions = {
      type: format,
      fullPage: false
    };

    if (format === 'jpeg') {
      screenshotOptions.quality = numQuality;
    }

    const buffer = await page.screenshot(screenshotOptions);

    await page.close();
    browserPool.releaseBrowser(browser);

    console.log(`GET Screenshot generated successfully: ${buffer.length} bytes`);
    
    res.set('Content-Type', `image/${format}`);
    res.set('Content-Length', buffer.length.toString());
    res.send(buffer);

  } catch (err) {
    console.error('GET Screenshot Error:', err);
    
    if (browser) {
      try {
        await browser.close();
      } catch (closeErr) {
        console.error('Error closing browser:', closeErr);
      }
    }
    
    res.status(500).json({
      error: 'Error generating screenshot',
      message: err.message
    });
  }
});

// Ana Screenshot Endpoint - Rate limiting uygulanmış
app.post('/screenshot', screenshotLimiter, async (req, res) => {
  const { 
    lat, 
    lon, 
    zoom, 
    width = 640, 
    height = 480, 
    format = 'jpeg',
    quality = 70,
    wms = null,
    pin = null
  } = req.body;

  // Input validation
  const validationErrors = validateInput(lat, lon, zoom, width, height, wms, pin);
  if (validationErrors.length > 0) {
    return res.status(400).json({
      error: 'Validation failed',
      details: validationErrors
    });
  }

  // Format kontrolü
  const supportedFormats = ['jpeg', 'png', 'webp'];
  if (!supportedFormats.includes(format)) {
    return res.status(400).json({
      error: 'Unsupported format',
      supported: supportedFormats
    });
  }

  // Quality kontrolü (sadece jpeg için)
  if (format === 'jpeg' && (quality < 1 || quality > 100)) {
    return res.status(400).json({
      error: 'Quality must be between 1 and 100 for JPEG format'
    });
  }

  let browser = null;

  try {
    console.log(`Screenshot request: lat=${lat}, lon=${lon}, zoom=${zoom}, ${width}x${height}, ${format}${wms ? `, WMS layers: ${wms.length}` : ''}${pin ? `, Pin: ${pin.text || 'No text'}` : ''}`);
    
    browser = await browserPool.getBrowser();
    const page = await browser.newPage();
    
    await page.setViewport({ width: parseInt(width), height: parseInt(height) });

    const html = generateHtml(lat, lon, zoom, wms, pin);
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    // Tüm karolar yüklenene kadar bekle
    await page.waitForFunction(
      () => document.title === 'ready',
      { timeout: 20000 } // 20 saniyeye kadar bekle
    );

    // Ek güvenlik: biraz daha bekle ki render tamamen tamamlansın
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Screenshot ayarları
    const screenshotOptions = {
      type: format,
      fullPage: false
    };

    // Format'a göre kalite ayarı
    if (format === 'jpeg') {
      screenshotOptions.quality = parseInt(quality);
    }

    const buffer = await page.screenshot(screenshotOptions);

    await page.close();
    browserPool.releaseBrowser(browser);

    console.log(`Screenshot generated successfully: ${buffer.length} bytes`);
    
    res.set('Content-Type', `image/${format}`);
    res.set('Content-Length', buffer.length.toString());
    res.send(buffer);

  } catch (err) {
    console.error('Screenshot Error:', err);
    
    if (browser) {
      try {
        await browser.close();
      } catch (closeErr) {
        console.error('Error closing browser:', closeErr);
      }
    }
    
    res.status(500).json({
      error: 'Error generating screenshot',
      message: err.message
    });
  }
});

// Debug: HTML preview endpoint
app.post('/preview-html', (req, res) => {
  const { lat, lon, zoom, wms = null, pin = null } = req.body;
  
  if (!lat || !lon || !zoom) {
    return res.status(400).json({
      error: 'lat, lon, and zoom are required'
    });
  }
  
  const html = generateHtml(lat, lon, zoom, wms, pin);
  res.set('Content-Type', 'text/html');
  res.send(html);
});

// API Usage Info Endpoint
app.get('/api-info', (req, res) => {
  res.json({
    service: 'Map Screenshot API',
    version: '1.1.0',
        endpoints: {
      'GET /screenshot': {
        description: 'Generate map screenshot with URL parameters',
        parameters: {
          lat: 'number (required) - Latitude between -90 and 90',
          lon: 'number (required) - Longitude between -180 and 180', 
          zoom: 'number (required) - Zoom level between 1 and 20',
          width: 'number (optional) - Image width between 100 and 2000, default: 640',
          height: 'number (optional) - Image height between 100 and 2000, default: 480',
          format: 'string (optional) - Image format: jpeg, png, webp, default: jpeg',
          quality: 'number (optional) - JPEG quality between 1 and 100, default: 70'
        },
        example: '/screenshot?lat=41.0082&lon=28.9784&zoom=15&width=800&height=600&format=png'
      },
      'POST /screenshot': {
        description: 'Generate map screenshot with JSON body (supports WMS layers)',
        parameters: {
          lat: 'number (required) - Latitude between -90 and 90',
          lon: 'number (required) - Longitude between -180 and 180', 
          zoom: 'number (required) - Zoom level between 1 and 20',
          width: 'number (optional) - Image width between 100 and 2000, default: 640',
          height: 'number (optional) - Image height between 100 and 2000, default: 480',
          format: 'string (optional) - Image format: jpeg, png, webp, default: jpeg',
          quality: 'number (optional) - JPEG quality between 1 and 100, default: 70',
          wms: 'array (optional) - WMS layers to overlay, max 5 layers',
          pin: 'object (optional) - Pin marker with text label'
        }
      },
      'GET /health': {
        description: 'Health check endpoint'
      },
      'GET /api-info': {
        description: 'API usage information'
      },
      'POST /preview-html': {
        description: 'Debug endpoint to preview generated HTML'
      }
    },
         rateLimits: {
       screenshot: '10 requests per 15 minutes per IP'
     },
     examples: {
       getRequest: '/screenshot?lat=41.0082&lon=28.9784&zoom=15',
       getRequestCustom: '/screenshot?lat=41.0082&lon=28.9784&zoom=15&width=1200&height=800&format=png&quality=90',
       postBasic: {
         lat: 41.0082,
         lon: 28.9784,
         zoom: 15
       },
       postWithWms: {
         lat: 41.0082,
         lon: 28.9784,
         zoom: 15,
         width: 1200,
         height: 800,
         format: 'png',
         wms: [
           {
             url: 'https://your-geoserver.com/wms',
             layers: 'your:layer_name',
             opacity: 0.7
           }
         ]
       },
       postWithPin: {
         lat: 41.0082,
         lon: 28.9784,
         zoom: 15,
         pin: {
           text: 'DEPREM',
           color: '#FF0000',
           size: 25
         }
       },
       postWithCustomPin: {
         lat: 41.0082,
         lon: 28.9784,
         zoom: 15,
         pin: {
           lat: 41.0100,
           lon: 28.9800,
           text: 'ACIL DURUM',
           color: '#FF6600',
           size: 30
         }
       }
     }
   });
 });

function generateHtml(lat, lon, zoom, wmsLayers = null, pin = null) {
  // WMS katmanları için JavaScript kodunu oluştur
  let wmsLayersCode = '';
  let layersArray = '  layers.push(osmLayer);';
  
  if (wmsLayers && wmsLayers.length > 0) {
    wmsLayers.forEach((wmsLayer, index) => {
      const opacity = wmsLayer.opacity !== undefined ? wmsLayer.opacity : 1;
      const layerName = `wmsLayer${index}`;
      
      wmsLayersCode += `
      // WMS Layer ${index + 1}: ${wmsLayer.layers}
      const ${layerName} = new ol.layer.Tile({
        source: new ol.source.TileWMS({
          url: '${wmsLayer.url}',
          params: {
            'LAYERS': '${wmsLayer.layers}',
            'TILED': true,
            'VERSION': '1.1.1',
            'FORMAT': 'image/png',
            'TRANSPARENT': true
          },
          serverType: 'geoserver'
        }),
        opacity: ${opacity}
      });
      `;
      
      layersArray += `\n  layers.push(${layerName});`;
      layersArray += `\n  tileSources.push(${layerName}.getSource());`;
    });
  }

  // Pin katmanı için kod oluştur
  let pinLayerCode = '';
  if (pin) {
    const pinLat = pin.lat !== undefined ? pin.lat : lat;
    const pinLon = pin.lon !== undefined ? pin.lon : lon;
    const pinText = pin.text || '';
    const pinColor = pin.color || '#FF0000';
    const pinSize = pin.size || 20;
    
    pinLayerCode = `
    // Pin Layer - En üstte görünmesi için
    const pinFeature = new ol.Feature({
      geometry: new ol.geom.Point(ol.proj.fromLonLat([${pinLon}, ${pinLat}])),
      name: 'pin'
    });

    const pinStyle = new ol.style.Style({
      image: new ol.style.Circle({
        radius: ${pinSize},
        fill: new ol.style.Fill({
          color: '${pinColor}'
        }),
        stroke: new ol.style.Stroke({
          color: '#FFFFFF',
          width: 4
        })
      }),
      text: new ol.style.Text({
        text: '${pinText}',
        font: 'bold 16px Arial',
        fill: new ol.style.Fill({
          color: '#FFFFFF'
        }),
        stroke: new ol.style.Stroke({
          color: '#000000',
          width: 4
        }),
        offsetY: -${pinSize + 20},
        textAlign: 'center',
        textBaseline: 'middle',
        backgroundFill: new ol.style.Fill({
          color: 'rgba(0, 0, 0, 0.7)'
        }),
        padding: [5, 10, 5, 10]
      })
    });

    pinFeature.setStyle(pinStyle);

    const pinLayer = new ol.layer.Vector({
      source: new ol.source.Vector({
        features: [pinFeature]
      }),
      zIndex: 1000 // En üstte görünmesi için yüksek z-index
    });
    
    console.log('Pin created at:', ${pinLon}, ${pinLat}, 'with text:', '${pinText}');
    `;
    
    // Pin'i en son ekle ki diğer katmanların üstünde olsun
    layersArray += `\n  // Pin layer'ı en son ekle`;
  }

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8" />
    <title>Loading</title>
    <style>
      html, body, #map {
        margin: 0;
        padding: 0;
        height: 100%;
        width: 100%;
        background: transparent;
      }
      
      /* OpenLayers spesifik stil düzeltmeleri */
      .ol-viewport {
        background: transparent !important;
      }
      
      .ol-layer {
        position: relative;
      }
      
      /* Loading sırasında beyaz ekranı önle */
      .ol-viewport canvas {
        background: transparent;
      }
    </style>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ol@v7.3.0/ol.css" />
    <script src="https://cdn.jsdelivr.net/npm/ol@v7.3.0/dist/ol.js"></script>
  </head>
  <body>
    <div id="map"></div>
    <script>
      // Base OSM layer
      const osmLayer = new ol.layer.Tile({
        source: new ol.source.OSM()
      });

      ${wmsLayersCode}

      ${pinLayerCode}

      // Katmanları topla
      const layers = [];
      const tileSources = [];
      
      ${layersArray}
      tileSources.push(osmLayer.getSource());
      
      ${pin ? 'layers.push(pinLayer);' : '// No pin layer'}

      const map = new ol.Map({
        target: 'map',
        controls: [],
        layers: layers,
        view: new ol.View({
          center: ol.proj.fromLonLat([${lon}, ${lat}]),
          zoom: ${zoom}
        }),
        // Ek harita ayarları
        loadTilesWhileAnimating: true,
        loadTilesWhileInteracting: true
      });

      // Harita render tamamlandığında kontrol et
      map.on('rendercomplete', function() {
        console.log('Map render completed');
        // Tüm katmanlar yüklendiyse ready yap
        if (total > 0 && loaded >= total) {
          document.title = 'ready';
        }
      });

      // Tüm katmanların tile'larını takip et
      let total = 0, loaded = 0;

      tileSources.forEach(tileSource => {
        tileSource.on('tileloadstart', () => {
          total++;
        });

        tileSource.on('tileloadend', () => {
          loaded++;
          if (total > 0 && loaded >= total) {
            document.title = 'ready';
          }
        });

        tileSource.on('tileloaderror', () => {
          loaded++;
          if (total > 0 && loaded >= total) {
            document.title = 'ready';
          }
        });
      });

      // Debug bilgileri
      console.log('Map created with', layers.length, 'layers');
      layers.forEach((layer, index) => {
        console.log('Layer', index, ':', layer.constructor.name, layer.getZIndex ? layer.getZIndex() : 'no z-index');
      });
      
      // İlk render'ı tetikle ve bekle
      map.renderSync();
      
      // Pin var mı kontrol et
      ${pin ? `console.log('Pin should be visible at:', ${pin.lat !== undefined ? pin.lat : lat}, ${pin.lon !== undefined ? pin.lon : lon});` : ''}
      
      // Eğer hiç tile yoksa (offline harita gibi) direkt ready yap
      setTimeout(() => {
        if (total === 0 && document.title !== 'ready') {
          console.log('No tiles to load, setting ready');
          document.title = 'ready';
        }
      }, 2000);

      // Timeout güvenliği - 15 saniye sonra zorla ready yap
      setTimeout(() => {
        if (document.title !== 'ready') {
          console.warn('Forcing ready state after timeout');
          document.title = 'ready';
        }
      }, 15000);
    </script>
  </body>
  </html>`;
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, cleaning up...');
  await browserPool.cleanup();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, cleaning up...');
  await browserPool.cleanup();
  process.exit(0);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Map Screenshot API v1.1.0 listening on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`📖 API info: http://localhost:${PORT}/api-info`);
});
