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
    '--socket-timeout', '5',
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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

  for (let i = 0; i < 35; i++) { // Max 70 segundos para dar margen en conversiones lentas
    await new Promise(r => setTimeout(r, 2000));
    console.log(`[SAVENOW] Consultando progreso (intento ${i+1})...`);
    const progressData = await getJson(progressUrl);
    if (progressData.success === 1 && progressData.download_url) {
      return progressData.download_url;
    }
  }
  throw new Error('SaveNow timeout');
}

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

  // --- MOTOR 3: yt-dlp ---
  const tryYtdlpClient = async (playerClient) => {
    console.log(`[CARRERA] -> Iniciando yt-dlp con client=${playerClient}...`);
    const outputFile = path.join(tmpDir, `${filePrefix}-${playerClient}.%(ext)s`);
    const proxy = getRandomProxy();
    const args = [
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificates',
      '--geo-bypass',
      '--socket-timeout', '8',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--proxy', proxy,
      '--extractor-args', `youtube:player_client=${playerClient}`,
      '-f', 'bestaudio[ext=m4a]/bestaudio/best',
      '-o', outputFile,
      ytUrl
    ];
    const cookies = getCookiesFile();
    if (cookies) args.push('--cookies', cookies);

    return new Promise((resolve, reject) => {
      const child = execFile(YT_DLP, args, { timeout: 25000, maxBuffer: 1024 * 1024 * 100 }, (error) => {
        if (error) return reject(new Error(`yt-dlp [${playerClient}]: ${error.message?.slice(0, 80)}`));
        const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(`${filePrefix}-${playerClient}`));
        if (files.length === 0) return reject(new Error(`yt-dlp [${playerClient}]: no se generó archivo`));
        
        const filePath = path.join(tmpDir, files[0]);
        try {
          const stat = fs.statSync(filePath);
          if (stat.size < 10000) {
            try { fs.unlinkSync(filePath); } catch(e) {}
            return reject(new Error(`yt-dlp [${playerClient}]: archivo demasiado pequeño`));
          }
          console.log(`[CARRERA] -> ¡yt-dlp con ${playerClient} ha GANADO la carrera!`);
          const stream = fs.createReadStream(filePath);
          
          // Limpieza al cerrar la descarga
          const cleanFile = () => { try { fs.unlinkSync(filePath); } catch(e) {} };
          stream.on('end', cleanFile);
          stream.on('close', cleanFile);
          stream.on('error', cleanFile);

          resolve({
            stream: stream,
            contentType: 'audio/mp4',
            contentLength: stat.size,
            filename: `${videoId}.m4a`
          });
        } catch (e) {
          reject(e);
        }
      });
      activeProcesses.push(child);
    });
  };

  // --- MOTOR 4: Invidious Host ---
  const tryInvidiousHost = async (host) => {
    console.log(`[CARRERA] -> Iniciando Invidious en ${host}...`);
    const invidiousUrl = `https://${host}/latest_version?id=${videoId}&itag=140&local=true`;
    return new Promise((resolve, reject) => {
      const https = require('https');
      const http = require('http');
      const client = invidiousUrl.startsWith('https') ? https : http;
      
      const streamReq = client.get(invidiousUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 20000
      }, (audioRes) => {
        if (audioRes.statusCode !== 200 && audioRes.statusCode !== 302) {
          audioRes.resume();
          return reject(new Error(`Invidious [${host}]: HTTP ${audioRes.statusCode}`));
        }
        
        // Si hay redirección (302)
        if (audioRes.statusCode === 302 && audioRes.headers.location) {
          const redirectUrl = audioRes.headers.location;
          const redirectClient = redirectUrl.startsWith('https') ? https : http;
          redirectClient.get(redirectUrl, { timeout: 20000 }, (redirRes) => {
            if (redirRes.statusCode !== 200) {
              redirRes.resume();
              return reject(new Error(`Invidious [${host}] Redir: HTTP ${redirRes.statusCode}`));
            }
            const contentLength = parseInt(redirRes.headers['content-length'] || '-1');
            if (contentLength === 0 || (contentLength > 0 && contentLength < 10000)) {
              redirRes.resume();
              return reject(new Error(`Invidious [${host}] Redir: tamaño inválido`));
            }
            console.log(`[CARRERA] -> ¡Invidious en ${host} ha GANADO la carrera!`);
            resolve({
              stream: redirRes,
              contentType: redirRes.headers['content-type'] || 'audio/mp4',
              contentLength: contentLength > 0 ? contentLength : null,
              filename: `${videoId}.m4a`
            });
          }).on('error', reject);
          return;
        }

        const contentLength = parseInt(audioRes.headers['content-length'] || '-1');
        if (contentLength === 0 || (contentLength > 0 && contentLength < 10000)) {
          audioRes.resume();
          return reject(new Error(`Invidious [${host}]: tamaño inválido`));
        }
        console.log(`[CARRERA] -> ¡Invidious en ${host} ha GANADO la carrera!`);
        resolve({
          stream: audioRes,
          contentType: audioRes.headers['content-type'] || 'audio/mp4',
          contentLength: contentLength > 0 ? contentLength : null,
          filename: `${videoId}.m4a`
        });
      });
      streamReq.on('error', reject);
      streamReq.on('timeout', () => {
        streamReq.destroy();
        reject(new Error(`Invidious [${host}]: timeout`));
      });
    });
  };

  // --- MOTOR 5: Piped Host ---
  const tryPipedHost = async (host) => {
    console.log(`[CARRERA] -> Iniciando Piped en ${host}...`);
    const apiUrl = `https://${host}/streams/${videoId}`;
    
    // Obtener metadatos de los streams
    const getStreamsJson = () => new Promise((resolve, reject) => {
      const https = require('https');
      const req = https.get(apiUrl, { 
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 12000 
      }, (apiRes) => {
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
      req.on('timeout', () => { req.destroy(); reject(new Error(`Piped API ${host} timeout`)); });
    });

    const data = await getStreamsJson();
    if (!data.audioStreams || data.audioStreams.length === 0) {
      throw new Error(`Piped [${host}]: Sin streams de audio`);
    }

    const streamUrl = data.audioStreams[0].url;
    if (!streamUrl) throw new Error(`Piped [${host}]: URL de stream vacía`);

    // Descargar el stream de audio
    return new Promise((resolve, reject) => {
      const https = require('https');
      const http = require('http');
      const client = streamUrl.startsWith('https') ? https : http;

      const audioReq = client.get(streamUrl, { 
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 25000 
      }, (audioRes) => {
        if (audioRes.statusCode !== 200) {
          audioRes.resume();
          return reject(new Error(`Piped Stream [${host}] HTTP ${audioRes.statusCode}`));
        }
        const contentLength = parseInt(audioRes.headers['content-length'] || '-1');
        if (contentLength === 0 || (contentLength > 0 && contentLength < 10000)) {
          audioRes.resume();
          return reject(new Error(`Piped Stream [${host}] tamaño inválido`));
        }
        console.log(`[CARRERA] -> ¡Piped en ${host} ha GANADO la carrera!`);
        resolve({
          stream: audioRes,
          contentType: audioRes.headers['content-type'] || 'audio/webm',
          contentLength: contentLength > 0 ? contentLength : null,
          filename: `${videoId}.webm`
        });
      });
      audioReq.on('error', reject);
      audioReq.on('timeout', () => { audioReq.destroy(); reject(new Error(`Piped Stream [${host}] timeout`)); });
    });
  };

  // --- Lista de promesas para correr en paralelo ---
  const promises = [];

  // 1. Añadir SaveNow
  promises.push(trySaveNow());

  // 2. Añadir hosts Cobalt activos
  const cobaltHosts = [
    'cblt.fariz.dev',
    'cobalt.hpko.xyz',
    'cobaltapi.cjs.nz',
    'cobalt.drgns.space',
    'rue-cobalt.xenon.zone',
    'cobalt.privacydev.net'
  ];
  cobaltHosts.forEach(host => {
    promises.push(tryCobaltHost(host));
  });

  // 3. Añadir hosts Invidious activos
  const invidiousHosts = [
    'yewtu.be',
    'vid.puffyan.us',
    'inv.tux.im',
    'invidious.projectsegfau.lt',
    'invidious.privacydev.net'
  ];
  invidiousHosts.forEach(host => {
    promises.push(tryInvidiousHost(host));
  });

  // 4. Añadir hosts Piped activos
  const pipedHosts = [
    'pipedapi.kavin.rocks',
    'pipedapi.lunar.icu',
    'pipedapi.colbydray.com',
    'pipedapi.privacydev.net'
  ];
  pipedHosts.forEach(host => {
    promises.push(tryPipedHost(host).catch(e => {
      // Registrar error pero permitir que siga la carrera
      throw new Error(`Piped [${host}] falló: ${e.message}`);
    }));
  });

  // 5. Añadir clientes de yt-dlp
  const ytdlpClients = ['mweb', 'web_creator', 'ios'];
  ytdlpClients.forEach(client => {
    promises.push(tryYtdlpClient(client));
  });

  // --- Ejecución en paralelo con primer ganador (Promise.any) ---
  const cleanActiveProcesses = () => {
    activeProcesses.forEach(child => {
      try { child.kill('SIGKILL'); } catch(e) {}
    });
  };

  try {
    // Implementación manual de Promise.any para compatibilidad y recolección de logs
    const winner = await new Promise((resolveRace, rejectRace) => {
      let completed = 0;
      const errors = [];
      promises.forEach((p, idx) => {
        Promise.resolve(p)
          .then((resVal) => {
            resolveRace(resVal);
          })
          .catch((err) => {
            errors.push(err.message);
            completed++;
            if (completed === promises.length) {
              rejectRace(new Error("Todos los motores de descarga fallaron:\n" + errors.map(e => ` - ${e}`).join("\n")));
            }
          });
      });
    });

    // Detener los otros procesos de yt-dlp para ahorrar CPU/disco en Render
    cleanActiveProcesses();

    // Servir stream ganador
    res.setHeader('Content-Type', winner.contentType);
    if (winner.contentLength) res.setHeader('Content-Length', winner.contentLength);
    res.setHeader('Content-Disposition', `attachment; filename="${winner.filename}"`);
    
    winner.stream.pipe(res);
  } catch (raceError) {
    cleanActiveProcesses();
    console.error(`[CARRERA FALLIDA]`, raceError.message);
    if (!res.headersSent) {
      res.status(502).json({ error: raceError.message });
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
