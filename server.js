const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Servir frontend en producción
app.use(express.static(path.join(__dirname, 'dist/beat-blender/browser')));

// ==========================================
// 1. ENDPOINT: AUDIO (RapidAPI youtube-mp36)
// ==========================================
app.get('/api/audio/:videoId', async (req, res) => {
  const { videoId } = req.params;
  if (!videoId || videoId.length < 5) return res.status(400).json({ error: 'Video ID invalido.' });

  console.log(`[RAPIDAPI] Solicitando audio para: ${videoId}`);

  const options = {
    hostname: 'youtube-mp36.p.rapidapi.com',
    port: 443,
    path: `/dl?id=${videoId}`,
    method: 'GET',
    headers: {
      'x-rapidapi-host': 'youtube-mp36.p.rapidapi.com',
      'x-rapidapi-key': '2c9f165934msh23fc2f9df36b684p127d8ejsnf3adda3bf495'
    }
  };

  try {
    const apiResponse = await new Promise((resolve, reject) => {
      const reqApi = https.request(options, apiRes => {
        let body = '';
        apiRes.on('data', d => body += d);
        apiRes.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch(e) {
            reject(new Error('Respuesta inválida de RapidAPI'));
          }
        });
      });
      reqApi.on('error', reject);
      reqApi.setTimeout(25000, () => {
        reqApi.destroy();
        reject(new Error('Timeout de RapidAPI'));
      });
      reqApi.end();
    });

    if (apiResponse.status !== 'ok' || !apiResponse.link) {
      throw new Error(`RapidAPI Error: ${apiResponse.msg || 'Link no encontrado'}`);
    }

    console.log(`[RAPIDAPI] Enlace obtenido con éxito. Descargando stream...`);

    const downloadUrl = apiResponse.link;
    const client = downloadUrl.startsWith('https') ? https : http;

    const streamReq = client.get(downloadUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (audioRes) => {
      if (audioRes.statusCode !== 200 && audioRes.statusCode !== 302) {
        audioRes.resume();
        return res.status(502).json({ error: `Stream HTTP ${audioRes.statusCode}` });
      }

      const serveStream = (responseStream) => {
        res.setHeader('Content-Type', responseStream.headers['content-type'] || 'audio/mpeg');
        const cl = responseStream.headers['content-length'];
        if (cl) res.setHeader('Content-Length', cl);
        res.setHeader('Content-Disposition', `attachment; filename="${videoId}.mp3"`);
        responseStream.pipe(res);
      };

      if (audioRes.statusCode === 302 && audioRes.headers.location) {
        const redirUrl = audioRes.headers.location;
        const redirClient = redirUrl.startsWith('https') ? https : http;
        redirClient.get(redirUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (redirRes) => {
            if (redirRes.statusCode !== 200) {
              redirRes.resume();
              return res.status(502).json({ error: `Redir Stream HTTP ${redirRes.statusCode}` });
            }
            serveStream(redirRes);
        }).on('error', e => {
          if (!res.headersSent) res.status(502).json({ error: e.message });
        });
        return;
      }

      serveStream(audioRes);
    });

    streamReq.on('error', e => {
      if (!res.headersSent) res.status(502).json({ error: e.message });
    });
    
  } catch(error) {
    console.error(`[ERROR RAPIDAPI]`, error.message);
    if (!res.headersSent) {
      res.status(502).json({ error: error.message });
    }
  }
});

// ==========================================
// 2. ENDPOINT: BÚSQUEDA (Piped Fallback)
// ==========================================
async function searchViaPiped(query) {
  const pipedHosts = [
    'pipedapi.kavin.rocks',
    'piped-api.garudalinux.org',
    'piped-api.lcomera.co',
    'pipedapi.r4fo.com'
  ];

  for (const host of pipedHosts) {
    try {
      console.log(`[BUSQUEDA] Intentando con Piped host: ${host}`);
      const url = `https://${host}/search?q=${encodeURIComponent(query)}&filter=videos`;
      
      const json = await new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 }, (apiRes) => {
          if (apiRes.statusCode !== 200) {
            apiRes.resume();
            return reject(new Error(`Piped API ${host} status ${apiRes.statusCode}`));
          }
          let data = '';
          apiRes.on('data', chunk => data += chunk);
          apiRes.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch(e) { reject(new Error(`Piped API ${host} JSON inválido`)); }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error(`Piped API ${host} timeout`));
        });
      });

      if (json && json.items && json.items.length > 0) {
        console.log(`[BUSQUEDA] Búsqueda exitosa usando Piped host: ${host}`);
        return json.items.map(item => {
          const videoId = item.url ? item.url.replace('/watch?v=', '') : '';
          return {
            videoId: videoId,
            title: item.title || 'Sin título',
            artist: item.uploaderName || 'Canal Desconocido',
            thumbnail: item.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            duration: item.duration || 0
          };
        }).filter(item => item.videoId);
      }
    } catch (e) {
      console.warn(`[BUSQUEDA] Falló Piped host ${host}: ${e.message}`);
    }
  }
  throw new Error('Todos los servidores de búsqueda fallaron');
}

app.get('/api/search/:query', async (req, res) => {
  const { query } = req.params;
  try {
    const results = await searchViaPiped(query);
    res.json(results);
  } catch (err) {
    console.error(`[ERROR] Búsqueda fallida para "${query}":`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 3. HEALTH CHECK & CATCH-ALL
// ==========================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', engine: 'RapidAPI', message: 'BeatBlender Proxy' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist/beat-blender/browser/index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🎧 BeatBlender Audio Proxy (RapidAPI Edition) corriendo en puerto ${PORT}`);
});
