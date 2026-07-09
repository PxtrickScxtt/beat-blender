const express = require('express');
const cors = require('cors');
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
let ytdl; try { ytdl = require('@distube/ytdl-core'); } catch(e) { ytdl = null; console.warn('[YTDL] @distube/ytdl-core no disponible:', e.message); }


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

const PROXIES = [
  'http://etfaviqo:t5fqvjbx1r0k@31.59.20.176:6754',
  'http://etfaviqo:t5fqvjbx1r0k@31.56.127.193:7684',
  'http://etfaviqo:t5fqvjbx1r0k@45.38.107.97:6014',
  'http://etfaviqo:t5fqvjbx1r0k@198.105.121.200:6462',
  'http://etfaviqo:t5fqvjbx1r0k@64.137.96.74:6641',
  'http://etfaviqo:t5fqvjbx1r0k@198.23.243.226:6361',
  'http://etfaviqo:t5fqvjbx1r0k@38.154.185.97:6370',
  'http://etfaviqo:t5fqvjbx1r0k@84.247.60.125:6095',
  'http://etfaviqo:t5fqvjbx1r0k@142.111.67.146:5611',
  'http://etfaviqo:t5fqvjbx1r0k@191.96.254.138:6185'
];

function getRandomProxy() {
  return PROXIES[Math.floor(Math.random() * PROXIES.length)];
}

/**
 * Devuelve los argumentos base para yt-dlp incluyendo cookies si están disponibles
 */
function getYtdlpBaseArgs() {
  const proxy = getRandomProxy();
  const args = [
    '--no-warnings',
    '--no-check-certificates',
    '--geo-bypass',
    '--proxy', proxy,
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
 * Intenta descargar via cobalt.tools API usando una de las instancias publicas
 */
async function downloadViaCobalt(videoId, apiHost = 'cblt.fariz.dev') {
  const https = require('https');
  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const body = JSON.stringify({ url: youtubeUrl, downloadMode: 'audio', audioFormat: 'best' });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: apiHost,
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
          else reject(new Error(`Cobalt [${apiHost}]: ${json.error?.code || JSON.stringify(json)}`));
        } catch(e) { reject(new Error(`Cobalt [${apiHost}]: respuesta invalida`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error(`Cobalt [${apiHost}]: timeout`)); });
    req.write(body);
    req.end();
  });
}

/**
 * Intenta descargar via SaveNow (loader.to backend) con polling de progreso
 */
async function downloadViaSaveNow(videoId) {
  const https = require('https');
  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const initUrl = `https://p.savenow.to/api/v2/download?button=1&format=mp3&url=${encodeURIComponent(ytUrl)}`;
  
  const getJson = (url) => new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON invalido')); }
      });
    }).on('error', reject);
  });

  console.log('[SAVENOW] Iniciando conversión...');
  const initData = await getJson(initUrl);
  if (!initData.success || !initData.id) {
    throw new Error('SaveNow init falló');
  }

  const taskId = initData.id;
  const progressUrl = `https://p.savenow.to/api/progress?id=${taskId}`;

  for (let i = 0; i < 20; i++) { // Max 40 segundos
    await new Promise(r => setTimeout(r, 2000));
    console.log(`[SAVENOW] Consultando progreso (intento ${i+1})...`);
    const progressData = await getJson(progressUrl);
    if (progressData.success === 1 && progressData.download_url) {
      return progressData.download_url;
    }
    if (progressData.success === 0) {
      throw new Error('SaveNow falló en procesar');
    }
  }
  throw new Error('SaveNow timeout');
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

  // === ESTRATEGIA 1: yt-dlp (Con proxies rotativos - Altamente fiable) ===
  const ytdlpSuccess = await new Promise((resolveYtdlp) => {
    doYtdlp((err, filePath) => {
      if (err || !filePath) {
        console.error(`[yt-dlp] Falló:`, err?.message || 'Ruta vacía. Probando fallbacks...');
        resolveYtdlp(false);
        return;
      }
      try {
        const stat = fs.statSync(filePath);
        console.log(`[yt-dlp] Éxito: ${filePath} (${(stat.size/1024/1024).toFixed(2)} MB)`);
        res.setHeader('Content-Type', 'audio/mp4');
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Content-Disposition', `attachment; filename="${videoId}.m4a"`);
        const s = fs.createReadStream(filePath);
        s.pipe(res);
        s.on('end', () => { 
          try { fs.unlinkSync(filePath); } catch(e){}
          resolveYtdlp(true);
        });
        s.on('error', (streamErr) => {
          console.error('[yt-dlp] Error de lectura del stream:', streamErr.message);
          resolveYtdlp(false);
        });
      } catch (statErr) {
        console.error('[yt-dlp] Error leyendo stats/archivo:', statErr.message);
        resolveYtdlp(false);
      }
    });
  });

  if (ytdlpSuccess) return;

  // === ESTRATEGIA 2: cobalt.tools (Instancias Públicas Rotativas - Fallback) ===
  const cobaltHosts = [
    'cblt.fariz.dev',
    'rue-cobalt.xenon.zone',
    'dog.kittycat.boo',
    'cobaltapi.kittycat.boo',
    'cobaltapi.cjs.nz'
  ];

  for (const host of cobaltHosts) {
    try {
      console.log(`[COBALT] Intentando con instancia: ${host}...`);
      const cobaltUrl = await downloadViaCobalt(videoId, host);
      console.log(`[COBALT] URL obtenida desde ${host}, haciendo stream...`);
      const https2 = require('https');
      const http2 = require('http');
      const client = cobaltUrl.startsWith('https') ? https2 : http2;
      
      const success = await new Promise((resolveStream) => {
        client.get(cobaltUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (audioRes) => {
          if (audioRes.statusCode !== 200) {
            console.warn(`[COBALT] Stream desde ${host} devolvió status ${audioRes.statusCode}`);
            resolveStream(false);
            return;
          }
          console.log(`[COBALT] Stream exitoso desde ${host}`);
          res.setHeader('Content-Type', audioRes.headers['content-type'] || 'audio/mp4');
          if (audioRes.headers['content-length']) res.setHeader('Content-Length', audioRes.headers['content-length']);
          res.setHeader('Content-Disposition', `attachment; filename="${videoId}.m4a"`);
          audioRes.pipe(res);
          resolveStream(true);
        }).on('error', (err) => {
          console.error(`[COBALT] Error de stream en ${host}:`, err.message);
          resolveStream(false);
        });
      });

      if (success) return; // Terminado con éxito
    } catch (cobaltErr) {
      console.warn(`[COBALT] Instancia ${host} falló: ${cobaltErr.message}`);
    }
  }

  // === ESTRATEGIA 3: SaveNow API (loader.to Backend - Fallback) ===
  try {
    console.log(`[SAVENOW] Intentando SaveNow...`);
    const downloadUrl = await downloadViaSaveNow(videoId);
    console.log(`[SAVENOW] URL de descarga obtenida: ${downloadUrl}`);
    const https3 = require('https');
    const http3 = require('http');
    const client = downloadUrl.startsWith('https') ? https3 : http3;
    
    const success = await new Promise((resolveStream) => {
      client.get(downloadUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (audioRes) => {
        if (audioRes.statusCode !== 200) {
          console.warn(`[SAVENOW] Stream devolvió status ${audioRes.statusCode}`);
          resolveStream(false);
          return;
        }
        console.log(`[SAVENOW] Stream exitoso`);
        res.setHeader('Content-Type', audioRes.headers['content-type'] || 'audio/mpeg');
        if (audioRes.headers['content-length']) res.setHeader('Content-Length', audioRes.headers['content-length']);
        res.setHeader('Content-Disposition', `attachment; filename="${videoId}.mp3"`);
        audioRes.pipe(res);
        resolveStream(true);
      }).on('error', (err) => {
        console.error(`[SAVENOW] Error de stream:`, err.message);
        resolveStream(false);
      });
    });

    if (success) return;
  } catch (saveNowErr) {
    console.warn(`[SAVENOW] Falló: ${saveNowErr.message}.`);
  }

  // Si todo lo demás falla, responder error
  if (!res.headersSent) {
    res.status(500).json({ error: "Todos los motores de descarga fallaron en este servidor." });
  }
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
