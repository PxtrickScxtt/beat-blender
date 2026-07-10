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
  'http://etfaviqo:t5fqvjbx1r0k@45.43.65.113:6627',
  'http://etfaviqo:t5fqvjbx1r0k@104.253.223.76:5484',
  'http://etfaviqo:t5fqvjbx1r0k@142.111.98.127:5828',
  'http://etfaviqo:t5fqvjbx1r0k@198.89.123.23:6565',
  'http://etfaviqo:t5fqvjbx1r0k@46.203.210.192:5639',
  'http://etfaviqo:t5fqvjbx1r0k@104.164.254.122:6801',
  'http://etfaviqo:t5fqvjbx1r0k@104.239.13.193:6822',
  'http://etfaviqo:t5fqvjbx1r0k@136.0.117.129:6867',
  'http://etfaviqo:t5fqvjbx1r0k@142.147.128.175:6675',
  'http://etfaviqo:t5fqvjbx1r0k@216.74.80.57:6629',
  'http://etfaviqo:t5fqvjbx1r0k@82.21.238.128:7931',
  'http://etfaviqo:t5fqvjbx1r0k@142.147.132.21:6216',
  'http://etfaviqo:t5fqvjbx1r0k@82.24.212.82:5388',
  'http://etfaviqo:t5fqvjbx1r0k@191.101.41.254:6326',
  'http://etfaviqo:t5fqvjbx1r0k@82.23.230.240:8044',
  'http://etfaviqo:t5fqvjbx1r0k@107.173.132.42:6996',
  'http://etfaviqo:t5fqvjbx1r0k@145.223.55.41:7088',
  'http://etfaviqo:t5fqvjbx1r0k@152.232.123.129:6014',
  'http://etfaviqo:t5fqvjbx1r0k@38.154.199.215:5369',
  'http://etfaviqo:t5fqvjbx1r0k@64.137.59.140:6733',
  'http://etfaviqo:t5fqvjbx1r0k@104.239.105.136:6666',
  'http://etfaviqo:t5fqvjbx1r0k@193.42.225.170:6661',
  'http://etfaviqo:t5fqvjbx1r0k@31.57.88.93:7166',
  'http://etfaviqo:t5fqvjbx1r0k@31.58.20.45:5729',
  'http://etfaviqo:t5fqvjbx1r0k@104.253.48.175:5599',
  'http://etfaviqo:t5fqvjbx1r0k@104.238.8.213:6071',
  'http://etfaviqo:t5fqvjbx1r0k@206.206.118.140:6378',
  'http://etfaviqo:t5fqvjbx1r0k@45.43.82.176:6170',
  'http://etfaviqo:t5fqvjbx1r0k@192.198.126.70:7113',
  'http://etfaviqo:t5fqvjbx1r0k@82.26.221.46:5387',
  'http://etfaviqo:t5fqvjbx1r0k@192.241.94.24:6294',
  'http://etfaviqo:t5fqvjbx1r0k@217.198.177.37:5553',
  'http://etfaviqo:t5fqvjbx1r0k@38.154.199.45:5199'
];

function getRandomProxy() {
  return PROXIES[Math.floor(Math.random() * PROXIES.length)];
}

/**
 * Devuelve los argumentos base para yt-dlp incluyendo cookies si están disponibles
 */
function getYtdlpBaseArgs() {
  const args = [
    '--no-warnings',
    '--no-check-certificates',
    '--geo-bypass',
    '--socket-timeout', '8',
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    // web_creator no requiere PO token y funciona desde IPs de servidores cloud
    '--extractor-args', 'youtube:player_client=web_creator',
  ];

  if (process.env.RENDER || process.env.PORT) {
    const proxy = getRandomProxy();
    args.push('--proxy', proxy);
  }

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
    try {
      const progressData = await getJson(progressUrl);
      if (progressData.success === 1 && progressData.download_url) {
        return progressData.download_url;
      }
      if (progressData.success === 0 && progressData.error) {
        throw new Error(`SaveNow API error: ${progressData.error}`);
      }
    } catch (err) {
      console.warn(`[SAVENOW] Advertencia (intento ${i+1}): ${err.message}. Reintentando...`);
      if (err.message.includes('SaveNow API error')) {
        throw err;
      }
      // Si es un error temporal de conexión o JSON inválido, continuamos reintentando
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

  const tryYtdlpClient = async (playerClient) => {
    console.log(`[CARRERA] -> Iniciando yt-dlp con client=${playerClient}...`);
    const outputFile = path.join(tmpDir, `${filePrefix}-${playerClient}.%(ext)s`);
    const args = [
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificates',
      '--geo-bypass',
      '--socket-timeout', '8',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--extractor-args', `youtube:player_client=${playerClient}`,
      '-f', 'bestaudio[ext=m4a]/bestaudio/best',
      '-o', outputFile,
      ytUrl
    ];

    if (process.env.RENDER || process.env.PORT) {
      const proxy = getRandomProxy();
      args.splice(7, 0, '--proxy', proxy);
    }
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
    'cobalt.synesthesiam.com'
  ];
  cobaltHosts.forEach(host => {
    promises.push(tryCobaltHost(host));
  });

  // 3. Añadir hosts Invidious activos
  const invidiousHosts = [
    'yewtu.be',
    'vid.puffyan.us',
    'invidious.projectsegfau.lt',
    'invidious.io.lol',
    'iv.melmac.space',
    'invidious.flokinet.to'
  ];
  invidiousHosts.forEach(host => {
    promises.push(tryInvidiousHost(host));
  });

  // 4. Añadir hosts Piped activos
  const pipedHosts = [
    'pipedapi.kavin.rocks',
    'pipedapi.lunar.icu',
    'piped-api.garudalinux.org',
    'piped-api.lcomera.co',
    'piped-api.privacy.com.de',
    'pipedapi.r4fo.com'
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
