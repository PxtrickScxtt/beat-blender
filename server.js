const express = require('express');
const cors = require('cors');
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = 3001;

// Habilitar CORS para que la app Angular en localhost:4200 pueda acceder
app.use(cors({ origin: '*', methods: ['GET'] }));

/**
 * Encuentra el ejecutable de yt-dlp en el PATH del sistema
 */
function getYtDlpPath() {
  // Intentar encontrarlo en las ubicaciones comunes de winget
  const possiblePaths = [
    'yt-dlp', // Si está en el PATH
    path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links', 'yt-dlp.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages', 'yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe', 'yt-dlp.exe'),
  ];
  
  for (const p of possiblePaths) {
    try {
      if (p === 'yt-dlp') return p; // Dejar que el sistema lo resuelva
      if (fs.existsSync(p)) return p;
    } catch(e) {}
  }
  return 'yt-dlp';
}

const YT_DLP = getYtDlpPath();

/** 
 * Si la variable de entorno YOUTUBE_COOKIES existe, la escribe a un archivo temporal
 * y devuelve su path para pasarla a yt-dlp con --cookies.
 */
let cookiesFilePath = null;
function getCookiesFile() {
  if (cookiesFilePath && fs.existsSync(cookiesFilePath)) return cookiesFilePath;
  const cookiesContent = process.env.YOUTUBE_COOKIES;
  if (!cookiesContent) return null;
  cookiesFilePath = path.join(os.tmpdir(), 'yt-cookies.txt');
  try {
    fs.writeFileSync(cookiesFilePath, cookiesContent, 'utf8');
    console.log('[COOKIES] Archivo de cookies escrito en:', cookiesFilePath);
  } catch(e) {
    console.error('[COOKIES] Error escribiendo cookies:', e.message);
    return null;
  }
  return cookiesFilePath;
}

/**
 * Devuelve los argumentos base para yt-dlp incluyendo cookies si están disponibles
 */
function getYtdlpBaseArgs() {
  const args = [
    '--no-warnings',
    '--no-check-certificates',
    '--geo-bypass',
    // web_creator no requiere PO token y funciona desde IPs de servidores cloud
    '--extractor-args', 'youtube:player_client=web_creator',
  ];
  const cookies = getCookiesFile();
  if (cookies) {
    args.push('--cookies', cookies);
  }
  return args;
}

/**
 * Intenta descargar via cobalt.tools API (bypass de bot detection de YouTube)
 */
async function downloadViaCobalt(videoId) {
  const https = require('https');
  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const body = JSON.stringify({ url: youtubeUrl, downloadMode: 'audio', audioFormat: 'best' });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.cobalt.tools',
      path: '/',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'BeatBlender/1.0', 'Content-Length': Buffer.byteLength(body) }
    }, (res2) => {
      let data = '';
      res2.on('data', chunk => data += chunk);
      res2.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.url) resolve(json.url);
          else reject(new Error(`Cobalt: ${json.error?.code || JSON.stringify(json)}`));
        } catch(e) { reject(new Error('Cobalt: respuesta invalida')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Cobalt: timeout')); });
    req.write(body);
    req.end();
  });
}

/**
 * Endpoint: GET /api/audio/:videoId
 * Descarga el audio real de YouTube: primero cobalt.tools, luego yt-dlp.
 */
app.get('/api/audio/:videoId', async (req, res) => {
  const { videoId } = req.params;
  if (!videoId || videoId.length < 5) return res.status(400).json({ error: 'Video ID invalido.' });

  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const tmpDir = os.tmpdir();
  const filePrefix = `beatblender-${videoId}-${Date.now()}`;
  const outputFile = path.join(tmpDir, `${filePrefix}.%(ext)s`);

  console.log(`[DESCARGA] Iniciando: ${videoId}`);

  const doYtdlp = (onDone) => {
    const args = ['--no-playlist', ...getYtdlpBaseArgs(), '-o', outputFile, ytUrl];
    console.log(`[yt-dlp] Ejecutando: yt-dlp ${args.join(' ')}`);
    execFile(YT_DLP, args, { timeout: 120000, maxBuffer: 1024 * 1024 * 50 }, (error) => {
      if (error) { onDone(error, null); return; }
      const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(filePrefix));
      if (files.length === 0) { onDone(new Error('Archivo no encontrado'), null); return; }
      onDone(null, path.join(tmpDir, files[0]));
    });
  };

  // === ESTRATEGIA 1: cobalt.tools ===
  try {
    console.log(`[COBALT] Intentando cobalt.tools...`);
    const cobaltUrl = await downloadViaCobalt(videoId);
    console.log(`[COBALT] URL obtenida, haciendo stream...`);
    const https2 = require('https');
    const http2 = require('http');
    const client = cobaltUrl.startsWith('https') ? https2 : http2;
    client.get(cobaltUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (audioRes) => {
      if (audioRes.statusCode !== 200) {
        console.warn(`[COBALT] Stream status ${audioRes.statusCode}, usando yt-dlp...`);
        if (!res.headersSent) {
          doYtdlp((err, filePath) => {
            if (err || !filePath) return res.status(500).json({ error: 'No se pudo descargar el audio.' });
            const stat = fs.statSync(filePath);
            res.setHeader('Content-Type', 'audio/mp4'); res.setHeader('Content-Length', stat.size);
            const s = fs.createReadStream(filePath); s.pipe(res);
            s.on('end', () => { try { fs.unlinkSync(filePath); } catch(e){} });
          });
        }
        return;
      }
      console.log(`[COBALT] Stream OK`);
      res.setHeader('Content-Type', audioRes.headers['content-type'] || 'audio/mp4');
      if (audioRes.headers['content-length']) res.setHeader('Content-Length', audioRes.headers['content-length']);
      res.setHeader('Content-Disposition', `attachment; filename="${videoId}.m4a"`);
      audioRes.pipe(res);
    }).on('error', (err) => {
      console.error(`[COBALT] Stream error:`, err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Error descargando audio.' });
    });
    return;
  } catch (cobaltErr) {
    console.warn(`[COBALT] Fallo: ${cobaltErr.message}. Usando yt-dlp...`);
  }

  // === ESTRATEGIA 2: yt-dlp ===
  doYtdlp((err, filePath) => {
    if (err || !filePath) {
      console.error(`[ERROR] yt-dlp fallo:`, err?.message);
      if (!res.headersSent) return res.status(500).json({ error: `No se pudo descargar: ${err?.message}` });
      return;
    }
    const stat = fs.statSync(filePath);
    console.log(`[yt-dlp] Archivo: ${filePath} (${(stat.size/1024/1024).toFixed(2)} MB)`);
    res.setHeader('Content-Type', 'audio/mp4'); res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `attachment; filename="${videoId}.m4a"`);
    const s = fs.createReadStream(filePath); s.pipe(res);
    s.on('end', () => { try { fs.unlinkSync(filePath); } catch(e){} });
  });
});

/**
 * Endpoint: GET /api/info/:videoId
 * Devuelve los metadatos del video usando yt-dlp
 */
app.get('/api/info/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    const info = await new Promise((resolve, reject) => {
      execFile(YT_DLP, [
        '--no-playlist',
        '--dump-json',
        ...getYtdlpBaseArgs(),
        url
      ], { timeout: 15000 }, (error, stdout) => {
        if (error) reject(error);
        else resolve(JSON.parse(stdout));
      });
    });

    res.json({
      id: info.id,
      title: info.title || 'Sin título',
      artist: info.uploader || info.channel || 'Canal desconocido',
      thumbnail: info.thumbnail || '',
      duration: info.duration || 0,
    });
  } catch (err) {
    console.error(`[ERROR] Info fallida para ${videoId}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/search/:query', async (req, res) => {
  const { query } = req.params;
  try {
    const results = await new Promise((resolve, reject) => {
      execFile(YT_DLP, [
        `ytsearch10:${query}`,
        '--dump-json',
        '--no-playlist',
        ...getYtdlpBaseArgs(),
        '--flat-playlist',
      ], { timeout: 20000, maxBuffer: 1024 * 1024 * 10 }, (error, stdout) => {
        if (error) {
          if (stdout.trim().length > 0) resolve(stdout);
          else reject(error);
        } else resolve(stdout);
      });
    });

    // Parsear resultados (cada línea es un JSON)
    const lines = results.trim().split('\n').filter(l => l.trim());
    const parsed = lines.map(line => JSON.parse(line)).map(v => ({
      videoId: v.id,
      title: v.title || 'Sin título',
      artist: v.uploader || v.channel || 'Canal Desconocido',
      thumbnail: (v.thumbnails && v.thumbnails.length > 0) ? v.thumbnails[v.thumbnails.length - 1].url : `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
      duration: v.duration || 0,
    }));
    res.json(parsed);
  } catch (err) {
    console.error(`[ERROR] Búsqueda fallida para "${query}":`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', engine: 'yt-dlp', message: 'BeatBlender Audio Proxy activo' });
});

app.listen(PORT, () => {
  console.log(`\n🎧 BeatBlender Audio Proxy corriendo en http://localhost:${PORT}`);
  console.log(`   Motor de descarga: yt-dlp`);
  console.log(`   Endpoints disponibles:`);
  console.log(`   GET /api/audio/:videoId  - Descarga audio REAL de YouTube`);
  console.log(`   GET /api/info/:videoId   - Obtiene metadatos del video`);
  console.log(`   GET /api/health          - Estado del servidor\n`);
});
