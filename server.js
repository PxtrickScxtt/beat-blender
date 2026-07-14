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

// yt-dlp y Proxies han sido removidos en favor de RapidAPI

/**
 * Endpoint: GET /api/audio/:videoId
 * Descarga el audio real de YouTube: primero cobalt.tools, luego yt-dlp con múltiples clientes.
 */
/**
 * Endpoint: GET /api/audio/:videoId
 * Descarga el audio real de YouTube: Ejecuta todos los motores de descarga (SaveNow, Cobalt, yt-dlp)
 * de forma concurrente en paralelo y devuelve el primero que responda con éxito (carrera de descargas).
 */
app.get('/api/audio/:videoId', async (req, res) => {
  const { videoId } = req.params;
  if (!videoId || videoId.length < 5) return res.status(400).json({ error: 'Video ID invalido.' });

  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const tmpDir = os.tmpdir();
  const filePrefix = `beatblender-${videoId}-${Date.now()}`;

  console.log(`[DESCARGA CONCURRENTE] Iniciando carrera para: ${videoId}`);

  const activeProcesses = [];

  // --- MOTOR 1: SaveNow ---
  const trySaveNow = async () => {
    console.log(`[CARRERA] -> Iniciando SaveNow para ${videoId}...`);
    const downloadUrl = await downloadViaSaveNow(videoId);
    return new Promise((resolve, reject) => {
      const https = require('https');
      const http = require('http');
      const client = downloadUrl.startsWith('https') ? https : http;
      
      const streamReq = client.get(downloadUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (audioRes) => {
        if (audioRes.statusCode !== 200) {
          audioRes.resume();
          return reject(new Error(`SaveNow: HTTP ${audioRes.statusCode}`));
        }
        const contentLength = parseInt(audioRes.headers['content-length'] || '-1');
        if (contentLength === 0) {
          audioRes.resume();
          return reject(new Error('SaveNow: respuesta vacía'));
        }
        console.log(`[CARRERA] -> ¡SaveNow ha GANADO la carrera!`);
        resolve({
          stream: audioRes,
          contentType: audioRes.headers['content-type'] || 'audio/mpeg',
          contentLength: contentLength > 0 ? contentLength : null,
          filename: `${videoId}.mp3`
        });
      });
      streamReq.on('error', reject);
    });
  };

  // --- MOTOR 2: Cobalt Host Individual ---
  const tryCobaltHost = async (host) => {
    console.log(`[CARRERA] -> Iniciando Cobalt en ${host}...`);
    const cobaltUrl = await downloadViaCobalt(videoId, host);
    return new Promise((resolve, reject) => {
      const https = require('https');
      const http = require('http');
      const client = cobaltUrl.startsWith('https') ? https : http;
      
      const audioReq = client.get(cobaltUrl, { 
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 25000
      }, (audioRes) => {
        if (audioRes.statusCode !== 200) {
          audioRes.resume();
          return reject(new Error(`Cobalt [${host}]: HTTP ${audioRes.statusCode}`));
        }
        const contentLength = parseInt(audioRes.headers['content-length'] || '-1');
        if (contentLength === 0 || (contentLength > 0 && contentLength < 10000)) {
          audioRes.resume();
          return reject(new Error(`Cobalt [${host}]: tamaño inválido (${contentLength} bytes)`));
        }
        console.log(`[CARRERA] -> ¡Cobalt en ${host} ha GANADO la carrera!`);
        resolve({
          stream: audioRes,
          contentType: audioRes.headers['content-type'] || 'audio/mp4',
          contentLength: contentLength > 0 ? contentLength : null,
          filename: `${videoId}.m4a`
        });
      });
      audioReq.on('error', reject);
      audioReq.on('timeout', () => {
        audioReq.destroy();
        reject(new Error(`Cobalt [${host}]: timeout`));
      });
    });
  };

  const tryYtdlpClient = async (playerClient, proxyOverride = null) => {
    const suffix = (proxyOverride && proxyOverride !== 'DIRECT') ? '-' + proxyOverride.split('@')[1].replace(/[:.]/g, '_') : '-direct';
    console.log(`[CARRERA] -> Iniciando yt-dlp con client=${playerClient}${proxyOverride && proxyOverride !== 'DIRECT' ? ' usando proxy ' + suffix : ' (directo)'}...`);
    const outputFile = path.join(tmpDir, `${filePrefix}-${playerClient}${suffix}.%(ext)s`);
    const args = [
      '--no-playlist',
      '--no-warnings',
      '--force-ipv4',
      '--no-check-certificates',
      '--geo-bypass',
      '--socket-timeout', '10',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--extractor-args', `youtube:player_client=${playerClient}`,
      '-f', 'bestaudio',
      '-o', outputFile
    ];

    const proxy = proxyOverride === 'DIRECT' ? null : (proxyOverride || ((process.env.RENDER || process.env.PORT) ? getRandomProxy() : null));
    if (proxy) {
      args.push('--proxy', proxy);
    }
    const cookies = getCookiesFile();
    if (cookies) args.push('--cookies', cookies);

    args.push(ytUrl);

    return new Promise((resolve, reject) => {
      const child = execFile(YT_DLP, args, { timeout: 25000, maxBuffer: 1024 * 1024 * 100 }, (error, stdout, stderr) => {
        if (error) {
          let actualError = stderr ? stderr.trim() : '';
          if (!actualError) {
            actualError = error.killed ? `TIMEOUT or KILLED (Signal: ${error.signal})` : error.message;
          }
          return reject(new Error(`yt-dlp [${playerClient}${suffix}]: ${actualError.slice(0, 350)}`));
        }
        const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(`${filePrefix}-${playerClient}${suffix}`));
        if (files.length === 0) return reject(new Error(`yt-dlp [${playerClient}${suffix}]: no se generó archivo`));
        
        const filePath = path.join(tmpDir, files[0]);
        try {
          const stat = fs.statSync(filePath);
          if (stat.size < 10000) {
            try { fs.unlinkSync(filePath); } catch(e) {}
            return reject(new Error(`yt-dlp [${playerClient}${suffix}]: archivo demasiado pequeño`));
          }
          console.log(`[CARRERA] -> ¡yt-dlp con ${playerClient}${suffix} ha GANADO la carrera!`);
          const stream = fs.createReadStream(filePath);
  console.log(`[RAPIDAPI] Solicitando audio para: ${videoId}`);

  const https = require('https');
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
    const client = downloadUrl.startsWith('https') ? https : require('http');

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
        const redirClient = redirUrl.startsWith('https') ? https : require('http');
        redirClient.get(redirUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (redirRes) => {
            if (redirRes.statusCode !== 200) {
              redirRes.resume();
              return res.status(502).json({ error: `Redir Stream HTTP ${redirRes.statusCode}` });
            }
            serveStream(redirRes);
        }).on('error', e => res.status(502).json({ error: e.message }));
        return;
      }

      serveStream(audioRes);
    });

    streamReq.on('error', e => res.status(502).json({ error: e.message }));
    
  } catch(error) {
    console.error(`[ERROR RAPIDAPI]`, error.message);
    if (!res.headersSent) {
      res.status(502).json({ error: error.message });
    }
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

async function searchViaPiped(query) {
  const pipedHosts = [
    'pipedapi.kavin.rocks',
    'piped-api.garudalinux.org',
    'piped-api.lcomera.co',
    'pipedapi.r4fo.com'
  ];

  for (const host of pipedHosts) {
    try {
      console.log(`[BUSQUEDA] Intentando fallback con Piped host: ${host}`);
      const https = require('https');
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
        console.log(`[BUSQUEDA] Fallback exitoso usando Piped host: ${host}`);
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
  throw new Error('Todos los motores de búsqueda alternativa (Piped) fallaron');
}

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
    console.warn(`[BUSQUEDA] yt-dlp falló ("${err.message}"). Intentando fallback con Piped API...`);
    try {
      const parsedFallback = await searchViaPiped(query);
      res.json(parsedFallback);
    } catch (fallbackErr) {
      console.error(`[ERROR] Ambos motores de búsqueda fallaron para "${query}":`, fallbackErr.message);
      res.status(500).json({ error: `Búsqueda fallida: ${err.message} / Fallback: ${fallbackErr.message}` });
    }
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
