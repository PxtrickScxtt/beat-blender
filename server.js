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

    console.log(`[RAPIDAPI] Enlace obtenido con éxito. Redirigiendo cliente al stream...`);

    const downloadUrl = apiResponse.link;
    // Redirigimos al cliente para que su navegador descargue directamente el archivo y bypass el bloqueo de IP de Render.
    res.redirect(302, downloadUrl);
    
  } catch(error) {
    console.error(`[ERROR RAPIDAPI]`, error.message);
    if (!res.headersSent) {
      res.status(502).json({ error: error.message });
    }
  }
});

// ==========================================
// 2. ENDPOINT: BÚSQUEDA (yt-search)
// ==========================================
app.get('/api/search/:query', async (req, res) => {
  const { query } = req.params;
  try {
    console.log(`[BUSQUEDA] Buscando en YouTube: "${query}"`);
    const ytSearch = require('yt-search');
    const r = await ytSearch(query);
    const videos = r.videos.slice(0, 15);
    
    if (videos.length === 0) {
      return res.json([]);
    }

    const results = videos.map(v => ({
      videoId: v.videoId,
      title: v.title,
      artist: v.author.name,
      thumbnail: v.thumbnail,
      duration: v.seconds
    }));

    res.json(results);
  } catch (err) {
    const errorMsg = err && err.message ? err.message : String(err);
    console.error(`[ERROR] Búsqueda fallida para "${query}":`, errorMsg, err);
    res.status(500).json({ error: errorMsg });
  }
});

// ==========================================
// 3. HEALTH CHECK & CATCH-ALL
// ==========================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', engine: 'RapidAPI', message: 'BeatBlender Proxy' });
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'dist/beat-blender/browser/index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🎧 BeatBlender Audio Proxy (RapidAPI Edition) corriendo en puerto ${PORT}`);
});
