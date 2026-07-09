import { Injectable } from '@angular/core';

export interface SearchResult {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: number; // in seconds
  source: 'youtube' | 'spotify';
  url: string;
}

@Injectable({
  providedIn: 'root',
})
export class SpotifyYoutubeService {
  // Servidores públicos de Invidious para proxying de descarga de audio con CORS
  private invidiousInstances = [
    'https://yewtu.be',
    'https://vid.puffyan.us',
    'https://inv.tux.im',
    'https://invidious.projectsegfau.lt',
    'https://invidious.privacydev.net',
    'https://inv.riverside.rocks',
    'https://invidious.namazso.eu'
  ];

  // Dirección del servidor proxy (dinámica según el host de ejecución)
  private get proxyUrl(): string {
    if (typeof window !== 'undefined') {
      const hostname = window.location.hostname;
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 'http://localhost:3001';
      }
    }
    return 'https://beatblender-proxy.onrender.com';
  }

  /**
   * Descarga la pista de audio real de un video de YouTube.
   * 
   * Estrategia de descarga (en orden de prioridad):
   * 1. Servidor proxy local (localhost:3001) - Descarga el audio REAL usando yt-dlp
   * 2. Piped API (fallback público con CORS nativo)
   * 3. Invidious + proxy CORS externo (último recurso)
   */
  public async downloadAudioTrack(videoId: string, onProgress?: (p: number) => void): Promise<Blob> {
    // ═══════════════════════════════════════════════════════════════
    // 1. SERVIDOR PROXY LOCAL / PRODUCTION PROXY (Audio real de YouTube)
    // ═══════════════════════════════════════════════════════════════
    try {
      const localProxyUrl = `${this.proxyUrl}/api/audio/${videoId}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 180000); // 180s (3 minutos) para dar margen a arranques en frío de Render y fallbacks.
 
      const response = await fetch(localProxyUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
 
      if (response.ok) {
        const contentLength = response.headers.get('content-length');
        const total = contentLength ? parseInt(contentLength, 10) : 0;
        
        if (!response.body || total === 0) {
          // Fallback en caso de que no soporte ReadableStream o no tenga content-length
          const blob = await response.blob();
          if (blob && blob.size > 50000) {
            console.log(`✅ Audio descargado vía proxy local (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
            return blob;
          }
        } else {
          const reader = response.body.getReader();
          let loaded = 0;
          const chunks = [];
          
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            chunks.push(value);
            loaded += value.byteLength;
            
            if (onProgress && total > 0) {
              const percent = Math.round((loaded / total) * 100);
              onProgress(percent);
            }
          }
          
          const blob = new Blob(chunks);
          if (blob && blob.size > 50000) {
            console.log(`✅ Audio descargado vía proxy local con progress tracking (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
            return blob;
          }
        }
      }
    } catch (e) {
      console.warn('⚠️ Proxy local no disponible, intentando fallbacks...', e);
    }
 
    // ═══════════════════════════════════════════════════════════════
    // 1.5 FALLBACK DIRECTO: COBALT DESDE EL NAVEGADOR (Bypass IP del Servidor)
    // ═══════════════════════════════════════════════════════════════
    const cobaltHosts = [
      'cblt.fariz.dev',
      'cobalt.hpko.xyz',
      'cobaltapi.cjs.nz',
      'cobalt.drgns.space',
      'rue-cobalt.xenon.zone',
      'cobalt.synesthesiam.com'
    ];
 
    for (const host of cobaltHosts) {
      try {
        console.log(`[FRONTEND-COBALT] Intentando con instancia: ${host}...`);
        const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
        
        const apiResponse = await fetch(`https://${host}/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            url: youtubeUrl,
            downloadMode: 'audio',
            audioFormat: 'best',
            audioOnly: true
          })
        });
 
        if (apiResponse.ok) {
          const json = await apiResponse.json();
          if (json.url) {
            console.log(`[FRONTEND-COBALT] URL de audio obtenida desde ${host}: ${json.url}`);
            
            const audioResponse = await fetch(json.url);
            if (audioResponse.ok) {
              const contentLength = audioResponse.headers.get('content-length');
              const total = contentLength ? parseInt(contentLength, 10) : 0;
              
              if (!audioResponse.body || total === 0) {
                const blob = await audioResponse.blob();
                if (blob && blob.size > 50000) {
                  console.log(`✅ Audio descargado vía Cobalt directo en el navegador desde ${host} (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
                  return blob;
                }
              } else {
                const reader = audioResponse.body.getReader();
                let loaded = 0;
                const chunks = [];
                
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  
                  chunks.push(value);
                  loaded += value.byteLength;
                  
                  if (onProgress && total > 0) {
                    const percent = Math.round((loaded / total) * 100);
                    onProgress(percent);
                  }
                }
                
                const blob = new Blob(chunks);
                if (blob && blob.size > 50000) {
                  console.log(`✅ Audio descargado vía Cobalt directo con progress tracking desde ${host} (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
                  return blob;
                }
              }
            }
          }
        }
      } catch (cobaltErr: any) {
        console.warn(`[FRONTEND-COBALT] Instancia ${host} falló: ${cobaltErr.message}`);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 2. FALLBACK: PIPED API (CORS nativo)
    // ═══════════════════════════════════════════════════════════════
    for (const instance of this.pipedInstances) {
      try {
        const streamUrl = `${instance}/streams/${videoId}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const response = await fetch(streamUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          if (data && data.audioStreams && data.audioStreams.length > 0) {
            const audioStream = data.audioStreams.find((s: any) => s.format === 'M4A') || data.audioStreams[0];
            const audioUrl = audioStream.url;

            const downloadController = new AbortController();
            const downloadTimeout = setTimeout(() => downloadController.abort(), 35000);

            const audioRes = await fetch(audioUrl, { signal: downloadController.signal });
            clearTimeout(downloadTimeout);

            if (audioRes.ok) {
              const blob = await audioRes.blob();
              if (blob && blob.size > 50000) {
                console.log(`✅ Audio descargado vía Piped (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
                return blob;
              }
            }
          }
        }
      } catch (e) {
        console.warn(`Intento con Piped instance ${instance} falló:`, e);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 3. ÚLTIMO RECURSO: INVIDIOUS + PROXY CORS EXTERNO
    // ═══════════════════════════════════════════════════════════════
    const corsProxies = [
      (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
      (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
    ];

    for (const proxy of corsProxies) {
      for (const instance of this.invidiousInstances) {
        try {
          const originalUrl = `${instance}/latest_version?id=${videoId}&itag=140&local=true`;
          const proxiedUrl = proxy(originalUrl);
          
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 35000);

          const response = await fetch(proxiedUrl, { signal: controller.signal });
          clearTimeout(timeoutId);

          if (response.ok) {
            const blob = await response.blob();
            if (blob && blob.size > 50000) {
              return blob;
            }
          }
        } catch (e) {
          console.warn(`Fallo fallback Invidious en ${instance}:`, e);
        }
      }
    }

    throw new Error('No se pudo descargar el audio. Asegúrate de que el servidor proxy local esté corriendo (node server.js).');
  }

  // Servidores públicos de Piped/Invidious para buscar en YouTube sin API key
  private pipedInstances = [
    'https://api.piped.yt',
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.lunar.icu',
    'https://pipedapi.colbydray.com'
  ];

  // Regex para extraer IDs
  private youtubeRegex = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=|shorts\/)([^#\&\?]*).*/;
  private spotifyRegex = /spotify\.com\/(?:[a-zA-Z0-9-]+\/)?track\/([a-zA-Z0-9]+)/;

  /**
   * Extrae el ID de video de YouTube de una URL
   */
  public extractYoutubeId(url: string): string | null {
    const match = url.match(this.youtubeRegex);
    return (match && match[2].length === 11) ? match[2] : null;
  }

  /**
   * Extrae el ID de track de Spotify de una URL
   */
  public extractSpotifyId(url: string): string | null {
    const match = url.match(this.spotifyRegex);
    return match ? match[1] : null;
  }

  /**
   * Obtiene metadatos de un enlace de Spotify usando la API pública de oEmbed
   */
  public async getSpotifyMetadata(url: string): Promise<{ title: string; artist: string; thumbnail?: string } | null> {
    try {
      // Usar el endpoint oEmbed oficial de Spotify que soporta CORS
      const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
      const response = await fetch(oembedUrl);
      if (!response.ok) throw new Error('Error al obtener metadatos de Spotify');
      
      const data = await response.json();
      return {
        title: data.title || 'Canción Desconocida',
        artist: data.author_name || 'Artista Desconocido',
        thumbnail: data.thumbnail_url
      };
    } catch (e) {
      console.error('Error al resolver Spotify oEmbed:', e);
      return null;
    }
  }

  /**
   * Busca videos en YouTube utilizando servidores Piped con fallbacks
   */
  public async search(query: string): Promise<SearchResult[]> {
    if (!query || query.trim() === '') return [];

    // Si parece una URL directa, la procesamos
    if (query.includes('youtube.com') || query.includes('youtu.be') || query.includes('youtube.com/shorts')) {
      const id = this.extractYoutubeId(query);
      if (id) {
        return [{
          id,
          title: `Video de YouTube (${id})`,
          artist: 'YouTube Link',
          thumbnail: `https://img.youtube.com/vi/${id}/mqdefault.jpg`,
          duration: 0, // Se actualizará al cargar en el reproductor
          source: 'youtube',
          url: query
        }];
      }
    }

    if (query.includes('spotify.com') && query.includes('/track/')) {
      const metadata = await this.getSpotifyMetadata(query);
      if (metadata) {
        // Buscar el equivalente en YouTube
        const isUnknown = (artist: string | undefined | null) => {
          if (!artist) return true;
          const lower = artist.toLowerCase();
          return lower.includes('desconocido') || lower.includes('unknown');
        };
        const searchQuery = metadata.artist && !isUnknown(metadata.artist)
          ? `${metadata.artist} ${metadata.title}`
          : metadata.title;
        const youtubeResults = await this.searchYoutubeApi(searchQuery);
        if (youtubeResults.length > 0) {
          // Devolver el mejor resultado pero con metadatos de Spotify
          return [{
            ...youtubeResults[0],
            title: metadata.title,
            artist: metadata.artist,
            thumbnail: metadata.thumbnail || youtubeResults[0].thumbnail,
            source: 'spotify',
            url: query
          }];
        }
      }
    }

    // Si es búsqueda de texto normal
    return this.searchYoutubeApi(query);
  }

  /**
   * Realiza la consulta a las APIs públicas de YouTube
   */
  private async searchYoutubeApi(query: string): Promise<SearchResult[]> {
    // 1. INTENTAR CON EL PROXY LOCAL PRIMERO (Más rápido y sin bloqueos)
    try {
      const localProxyUrl = `${this.proxyUrl}/api/search/${encodeURIComponent(query)}`;
      const response = await fetch(localProxyUrl);
      if (response.ok) {
        const data = await response.json();
        if (data && data.length > 0) {
          return data.map((item: any) => ({
            id: item.videoId || '',
            title: item.title || 'Sin título',
            artist: item.artist || 'Desconocido',
            thumbnail: item.thumbnail || `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
            duration: item.duration || 0,
            source: 'youtube',
            url: `https://www.youtube.com/watch?v=${item.videoId}`
          }));
        }
      }
    } catch (e) {
      console.warn('⚠️ Proxy local de búsqueda falló, intentando con Piped...', e);
    }

    // Intentar con cada instancia de Piped en la lista
    for (const instance of this.pipedInstances) {
      try {
        const url = `${instance}/search?q=${encodeURIComponent(query)}&filter=videos`;
        const response = await fetch(url);
        if (!response.ok) continue;

        const data = await response.json();
        if (data && data.items && data.items.length > 0) {
          return data.items.slice(0, 10).map((item: any) => {
            // El ID en Piped API a veces viene en item.url (/watch?v=ID)
            let id = item.id;
            if (!id && item.url) {
              const idMatch = item.url.match(/v=([^&#]+)/);
              id = idMatch ? idMatch[1] : '';
            }

            return {
              id: id || '',
              title: item.title || 'Título desconocido',
              artist: item.uploaderName || 'Canal desconocido',
              thumbnail: item.thumbnail || `https://img.youtube.com/vi/${id}/mqdefault.jpg`,
              duration: item.duration || 0,
              source: 'youtube',
              url: `https://www.youtube.com/watch?v=${id}`
            };
          });
        }
      } catch (e) {
        console.warn(`Error buscando en la instancia ${instance}:`, e);
      }
    }

    // Fallback: Si todas las APIs fallan (ej. por problemas de red o CORS),
    // creamos resultados ficticios o una respuesta de búsqueda aproximada
    // basada en búsquedas comunes para que la UI no se quede colgada
    console.error('Todas las instancias de búsqueda fallaron. Usando mock fallback.');
    return this.getMockResults(query);
  }

  /**
   * Resultados Mock en caso de que las APIs fallen completamente (CORS / offline)
   */
  private getMockResults(query: string): SearchResult[] {
    const cleanQuery = query.toLowerCase();
    
    // Lista de canciones populares para responder de manera interactiva
    const popularSongs = [
      { title: 'Ojitos Lindos', artist: 'Bad Bunny ft. Bomba Estéreo', id: 'CAYOb9MDixo', duration: 258 },
      { title: 'Titi Me Pregunto', artist: 'Bad Bunny', id: '5sPXvXuJ_8Q', duration: 283 },
      { title: 'Moscow Mule', artist: 'Bad Bunny', id: '-rtO90pJ54w', duration: 240 },
      { title: 'Blinding Lights', artist: 'The Weeknd', id: '4PTG3Z6ehGkBF3zIqYQGSy', duration: 200 },
      { title: 'Shape of You', artist: 'Ed Sheeran', id: 'JGwWNGJdvx8', duration: 233 },
      { title: 'As It Was', artist: 'Harry Styles', id: 'H5v3kku4y6Q', duration: 167 },
      { title: 'Flowers', artist: 'Miley Cyrus', id: 'G7KNmW9a75Y', duration: 200 }
    ];

    // Filtrar canciones que coincidan con la búsqueda
    const matches = popularSongs.filter(s => 
      s.title.toLowerCase().includes(cleanQuery) || 
      s.artist.toLowerCase().includes(cleanQuery)
    );

    const resultsToUse = matches.length > 0 ? matches : popularSongs;

    return resultsToUse.map(song => ({
      id: song.id,
      title: song.title,
      artist: song.artist,
      thumbnail: `https://img.youtube.com/vi/${song.id}/mqdefault.jpg`,
      duration: song.duration,
      source: 'youtube',
      url: `https://www.youtube.com/watch?v=${song.id}`
    }));
  }
}
