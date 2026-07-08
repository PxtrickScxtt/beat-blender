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
 * Endpoint: GET /api/audio/:videoId
 * Descarga el audio real de YouTube usando yt-dlp y lo envía al cliente.
 */
app.get('/api/audio/:videoId', async (req, res) => {
  const { videoId } = req.params;

  if (!videoId || videoId.length < 5) {
    return res.status(400).json({ error: 'Video ID inválido.' });
  }

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const tmpDir = os.tmpdir();
  const filePrefix = `beatblender-${videoId}-${Date.now()}`;
  const outputFile = path.join(tmpDir, `${filePrefix}.%(ext)s`);

  console.log(`[DESCARGA] Iniciando descarga de audio: ${videoId}`);

  try {
    // Descargar audio usando yt-dlp a un archivo temporal
    await new Promise((resolve, reject) => {
      const args = [
        '--no-playlist',
        '-f', 'ba/b',
        '--no-warnings',
        '--no-check-certificates',
        '--extractor-args', 'youtube:player_client=android',
        '-o', outputFile,
        url
      ];

      console.log(`[yt-dlp] Ejecutando: yt-dlp ${args.join(' ')}`);

      const proc = execFile(YT_DLP, args, { 
        timeout: 120000, // 2 minutos máximo
        maxBuffer: 1024 * 1024 * 50 // 50MB buffer
      }, (error, stdout, stderr) => {
        if (error) {
          console.error(`[yt-dlp] Error:`, error.message);
          if (stderr) console.error(`[yt-dlp] stderr:`, stderr);
          reject(error);
        } else {
          console.log(`[yt-dlp] Descarga completada: ${stdout.trim()}`);
          resolve(stdout);
        }
      });
    });

    // Verificar que el archivo existe y tiene contenido
    let found = null;
    const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(filePrefix));
    if (files.length > 0) {
      found = path.join(tmpDir, files[0]);
    }
    
    if (!found || !fs.existsSync(found)) {
      return res.status(500).json({ error: 'No se encontró el archivo de audio descargado.' });
    }
    
    // Usar el archivo encontrado
      const stat = fs.statSync(found);
      console.log(`[DESCARGA] Archivo encontrado: ${found} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
      
      res.setHeader('Content-Type', 'audio/mp4');
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Content-Disposition', `attachment; filename="${videoId}.m4a"`);
      
      const stream = fs.createReadStream(found);
      stream.pipe(res);
      stream.on('end', () => {
        try { fs.unlinkSync(found); } catch(e) {}
      });
    } catch (err) {
      console.error(`[ERROR] Fallo en descarga de ${videoId}:`, err.message);
      // Limpiar archivos si falló
      const filesToClean = fs.readdirSync(tmpDir).filter(f => f.startsWith(filePrefix));
      for (const f of filesToClean) {
        try { fs.unlinkSync(path.join(tmpDir, f)); } catch(e) {}
      }
      
      if (!res.headersSent) {
        res.status(500).json({ error: `No se pudo descargar el audio: ${err.message}` });
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
        '--no-warnings',
        '--no-check-certificates',
        '--extractor-args', 'youtube:player_client=android',
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
        '--no-warnings',
        '--no-check-certificates',
        '--flat-playlist'
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
