import { Injectable, signal, computed, inject } from '@angular/core';
import { AudioRecorderService } from './audio-recorder';
import { SpotifyYoutubeService } from './spotify-youtube';

export interface Track {
  id: string; // ID único autogenerado en la cola
  videoId: string; // Vacío para local
  title: string;
  artist: string;
  thumbnail: string;
  startMinutes: number;
  startSeconds: number;
  endMinutes: number;
  endSeconds: number;
  duration: number; // Duración total original en segundos
  crossfadeTime: number; // Tiempo de crossfade en segundos (por defecto 5)
  source: 'youtube' | 'spotify' | 'local';
  downloadStatus?: 'pending' | 'downloading' | 'completed' | 'failed';
  downloadProgress?: number;
  bpm?: number;
  key?: string;
}

@Injectable({
  providedIn: 'root',
})
export class MixerService {
  private recorderService = inject(AudioRecorderService);
  private spotifyYoutube = inject(SpotifyYoutubeService);

  // Estado reactivo (Signals)
  public queue = signal<Track[]>([]);
  public currentIndex = signal<number>(-1);
  public isPlaying = signal<boolean>(false);
  public masterVolume = signal<number>(80);
  public crossfaderValue = signal<number>(0); // -100 (Solo Reproductor A) a 100 (Solo Reproductor B)
  public activePlayer = signal<'A' | 'B'>('A');

  // Estado del procesamiento offline
  public isOfflineProcessing = signal<boolean>(false);
  public offlineProgress = signal<number>(0);

  // Estado de descarga de YouTube en segundo plano
  public isDownloadingTrack = signal<boolean>(false);
  public downloadProgress = signal<number>(0);

  // Tiempos de reproducción actuales (segundos)
  public playerATime = signal<number>(0);
  public playerBTime = signal<number>(0);
  public playerADuration = signal<number>(0);
  public playerBDuration = signal<number>(0);

  // Sistema de notificaciones flotantes (Toasts)
  public toast = signal<{ message: string; type: 'success' | 'error' | 'info'; actionLabel?: string; action?: () => void } | null>(null);
  public retryingTrackId = signal<string | null>(null);
  private toastTimeout: any = null;

  public showToast(message: string, type: 'success' | 'error' | 'info' = 'info', duration = 8000, actionLabel?: string, action?: () => void): void {
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toast.set({ message, type, actionLabel, action });
    if (duration > 0) {
      this.toastTimeout = setTimeout(() => {
        this.toast.set(null);
      }, duration);
    }
  }

  public clearToast(): void {
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toast.set(null);
  }

  // Instancias de los reproductores de YouTube
  private playerA: any = null;
  private playerB: any = null;
  private playerAReady = false;
  private playerBReady = false;

  // Reproductores de Audio Local HTML5
  private audioA = new Audio();
  private audioB = new Audio();

  // Almacenamiento de archivos binarios locales
  private localFilesMap = new Map<string, File>();

  // Timers para monitorear el progreso y la mezcla
  private monitorInterval: any = null;
  private fadeInterval: any = null;
  private isFading = false;

  constructor() {
    // Cargar la API de YouTube
    this.loadYoutubeApi();

    // Configurar volúmenes iniciales para los reproductores locales
    this.audioA.volume = this.masterVolume() / 100;
    this.audioB.volume = 0;

    // Configurar listeners de finalización para los audios locales (similares a los de YT)
    this.audioA.onended = () => this.handleLocalPlayerEnded('A');
    this.audioB.onended = () => this.handleLocalPlayerEnded('B');
  }

  // Computed signals útiles para la UI
  public currentTrack = computed(() => {
    const idx = this.currentIndex();
    const q = this.queue();
    return (idx >= 0 && idx < q.length) ? q[idx] : null;
  });

  public nextTrack = computed(() => {
    const idx = this.currentIndex() + 1;
    const q = this.queue();
    return (idx >= 0 && idx < q.length) ? q[idx] : null;
  });

  public currentPlaybackTime = computed(() => {
    return this.activePlayer() === 'A' ? this.playerATime() : this.playerBTime();
  });

  public currentTrackProgress = computed(() => {
    const track = this.currentTrack();
    if (!track) return 0;
    
    const start = track.startMinutes * 60 + track.startSeconds;
    const end = track.endMinutes * 60 + track.endSeconds;
    const current = this.currentPlaybackTime();
    
    if (end === start) return 0;
    return Math.max(0, Math.min(100, ((current - start) / (end - start)) * 100));
  });

  /**
   * Carga dinámica de la API IFrame de YouTube
   */
  private loadYoutubeApi(): Promise<void> {
    return new Promise((resolve) => {
      if ((window as any).YT && (window as any).YT.Player) {
        resolve();
        return;
      }

      const previousOnReady = (window as any).onYouTubeIframeAPIReady;
      (window as any).onYouTubeIframeAPIReady = () => {
        if (previousOnReady) previousOnReady();
        resolve();
      };

      if (!document.getElementById('youtube-iframe-api-script')) {
        const tag = document.createElement('script');
        tag.id = 'youtube-iframe-api-script';
        tag.src = 'https://www.youtube.com/iframe_api';
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
      }
    });
  }

  /**
   * Inicializa las dos instancias de reproductores virtuales en el DOM
   */
  public async initPlayers(containerAId: string, containerBId: string): Promise<void> {
    await this.loadYoutubeApi();

    return new Promise((resolve) => {
      let playersToInit = 2;

      const checkResolve = () => {
        playersToInit--;
        if (playersToInit === 0) {
          resolve();
        }
      };

      // Inicializar Player A
      this.playerA = new (window as any).YT.Player(containerAId, {
        height: '100%',
        width: '100%',
        videoId: '',
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          rel: 0,
          showinfo: 0,
          iv_load_policy: 3
        },
        events: {
          onReady: () => {
            this.playerAReady = true;
            this.playerA.setVolume(0);
            checkResolve();
          },
          onStateChange: (event: any) => this.handlePlayerStateChange('A', event)
        }
      });

      // Inicializar Player B
      this.playerB = new (window as any).YT.Player(containerBId, {
        height: '100%',
        width: '100%',
        videoId: '',
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          rel: 0,
          showinfo: 0,
          iv_load_policy: 3
        },
        events: {
          onReady: () => {
            this.playerBReady = true;
            this.playerB.setVolume(0);
            checkResolve();
          },
          onStateChange: (event: any) => this.handlePlayerStateChange('B', event)
        }
      });
    });
  }

  /**
   * Agrega una pista a la cola inmediatamente y arranca la descarga en segundo plano.
   * Esto permite añadir y descargar múltiples pistas en paralelo.
   */
  public async addTrack(video: { id: string; title: string; artist: string; thumbnail: string; duration: number; source: 'youtube' | 'spotify' }): Promise<void> {
    const duration = video.duration || 300;
    const trackId = Math.random().toString(36).substring(2, 9);
    
    const bpmAndKey = this.generateBpmAndKey(video.title, video.artist);
    
    // 1. Crear track inmediatamente en la cola con estado 'downloading'
    const newTrack: Track = {
      id: trackId,
      videoId: video.id,
      title: video.title,
      artist: video.artist,
      thumbnail: video.thumbnail,
      startMinutes: 0,
      startSeconds: 0,
      endMinutes: Math.floor(duration / 60),
      endSeconds: Math.floor(duration % 60),
      duration: duration,
      crossfadeTime: 5,
      source: video.source,
      downloadStatus: 'downloading',
      downloadProgress: 15,
      bpm: bpmAndKey.bpm,
      key: bpmAndKey.key
    };

    this.queue.update(q => [...q, newTrack]);
    this.saveQueueToLocalStorage();

    // Iniciar reproducción si es el primer track
    if (this.queue().length > 0 && this.currentIndex() === -1) {
      this.currentIndex.set(0);
      this.preloadTrackOnPlayer('A', this.queue()[0]);
    } else if (this.queue().length === this.currentIndex() + 2) {
      // Si acabamos de añadir la canción que le toca sonar JUSTO después de la actual
      const nextPlay = this.activePlayer() === 'A' ? 'B' : 'A';
      this.preloadTrackOnPlayer(nextPlay, this.queue()[this.currentIndex() + 1]);
    }

    // 2. Disparar descarga asíncrona en segundo plano sin bloquear
    this.downloadTrackAsync(trackId, video.id, video.title);
  }

  /**
   * Proceso de descarga en segundo plano para una pista en la cola
   */
  private async downloadTrackAsync(trackId: string, videoId: string, title: string): Promise<void> {
    const updateProgress = (progress: number) => {
      this.queue.update(q => q.map(t => t.id === trackId ? { ...t, downloadProgress: progress } : t));
    };

    try {
      updateProgress(30);
      const audioBlob = await this.spotifyYoutube.downloadAudioTrack(videoId);
      updateProgress(70);

      // Crear archivo virtual
      const file = new File([audioBlob], `${title}.m4a`, { type: 'audio/mp4' });
      updateProgress(90);

      // Registrar el archivo File en el mapa local de memoria
      this.localFilesMap.set(trackId, file);

      // Actualizar estado del track a local y completado
      this.queue.update(q => q.map(t => t.id === trackId ? { 
        ...t, 
        source: 'local', 
        downloadStatus: 'completed', 
        downloadProgress: 100 
      } : t));
      this.saveQueueToLocalStorage();

      // Recargar el reproductor si esta pista ya debería estar sonando o precargada
      if (this.currentIndex() !== -1) {
        const currentTrack = this.queue()[this.currentIndex()];
        const nextTrack = this.queue()[this.currentIndex() + 1];
        if (currentTrack && currentTrack.id === trackId) {
          this.preloadTrackOnPlayer(this.activePlayer(), currentTrack);
        } else if (nextTrack && nextTrack.id === trackId) {
          const nextPlay = this.activePlayer() === 'A' ? 'B' : 'A';
          this.preloadTrackOnPlayer(nextPlay, nextTrack);
        }
      }

      this.showToast(`¡Descargada con éxito: "${title}"!`, 'success', 4000);

    } catch (e) {
      console.warn(`[DESCARGA] Falló background download para ${title}:`, e);
      
      // Pasar a modo online / fallido
      this.queue.update(q => q.map(t => t.id === trackId ? { 
        ...t, 
        downloadStatus: 'failed', 
        downloadProgress: 0 
      } : t));
      this.saveQueueToLocalStorage();

      this.showToast(
        `Error de descarga para "${title}". Queda en modo "Online". Puedes reintentar.`,
        'error',
        12000,
        'REINTENTAR',
        () => this.retryDownloadTrack(trackId)
      );
    }
  }

  /**
   * Intenta descargar de nuevo el audio de un track que está en modo online
   */
  public async retryDownloadTrack(trackId: string): Promise<void> {
    const track = this.queue().find(t => t.id === trackId);
    if (!track || track.source === 'local') return;

    this.retryingTrackId.set(trackId);
    
    // Marcar de nuevo en estado de descarga
    this.queue.update(q => q.map(t => t.id === trackId ? { 
      ...t, 
      downloadStatus: 'downloading', 
      downloadProgress: 15 
    } : t));

    try {
      const updateProgress = (progress: number) => {
        this.queue.update(q => q.map(t => t.id === trackId ? { ...t, downloadProgress: progress } : t));
      };

      updateProgress(30);
      const audioBlob = await this.spotifyYoutube.downloadAudioTrack(track.videoId);
      updateProgress(70);

      const file = new File([audioBlob], `${track.title}.m4a`, { type: 'audio/mp4' });
      updateProgress(90);

      this.localFilesMap.set(trackId, file);

      this.queue.update(q => q.map(t => t.id === trackId ? { 
        ...t, 
        source: 'local', 
        downloadStatus: 'completed', 
        downloadProgress: 100 
      } : t));
      this.saveQueueToLocalStorage();

      if (this.currentIndex() !== -1) {
        const currentTrack = this.queue()[this.currentIndex()];
        const nextTrack = this.queue()[this.currentIndex() + 1];
        if (currentTrack && currentTrack.id === trackId) {
          this.preloadTrackOnPlayer(this.activePlayer(), currentTrack);
        } else if (nextTrack && nextTrack.id === trackId) {
          const nextPlay = this.activePlayer() === 'A' ? 'B' : 'A';
          this.preloadTrackOnPlayer(nextPlay, nextTrack);
        }
      }

      this.retryingTrackId.set(null);
      this.showToast(`¡Pista "${track.title}" descargada con éxito!`, 'success');
      
    } catch (e) {
      console.warn('Re-descarga fallida:', e);
      
      this.queue.update(q => q.map(t => t.id === trackId ? { 
        ...t, 
        downloadStatus: 'failed', 
        downloadProgress: 0 
      } : t));
      this.saveQueueToLocalStorage();

      this.retryingTrackId.set(null);
      this.showToast(
        'Los servidores proxy siguen saturados. No se pudo descargar en este momento.',
        'error',
        8000,
        'VOLVER A INTENTAR',
        () => this.retryDownloadTrack(trackId)
      );
    }
  }

  /**
   * Registra y agrega un archivo de música local (MP3/WAV)
   */
  public addLocalTrack(file: File, duration: number, customMetadata?: { title: string; artist: string; thumbnail: string }): string {
    const id = Math.random().toString(36).substring(2, 9);
    
    const title = customMetadata ? customMetadata.title : file.name.replace(/\.[^/.]+$/, "");
    const artist = customMetadata ? customMetadata.artist : 'Archivo Local';
    const bpmAndKey = this.generateBpmAndKey(title, artist);
    
    const newTrack: Track = {
      id,
      videoId: '', // Vacío para archivos locales
      title,
      artist,
      thumbnail: customMetadata ? customMetadata.thumbnail : 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=150&auto=format&fit=crop&q=60', // Miniatura disco DJ genérica
      startMinutes: 0,
      startSeconds: 0,
      endMinutes: Math.floor(duration / 60),
      endSeconds: Math.floor(duration % 60),
      duration: duration,
      crossfadeTime: 5,
      source: 'local',
      bpm: bpmAndKey.bpm,
      key: bpmAndKey.key
    };

    // Registrar el archivo File binario en el mapa local
    this.localFilesMap.set(id, file);
    
    this.queue.update(q => [...q, newTrack]);
    this.saveQueueToLocalStorage();

    if (this.queue().length > 0 && this.currentIndex() === -1) {
      this.currentIndex.set(0);
      this.preloadTrackOnPlayer('A', this.queue()[0]);
    } else if (this.queue().length === this.currentIndex() + 2) {
      // Si acabamos de añadir la canción que le toca sonar JUSTO después de la actual, precargarla de inmediato
      const nextPlay = this.activePlayer() === 'A' ? 'B' : 'A';
      this.preloadTrackOnPlayer(nextPlay, this.queue()[this.currentIndex() + 1]);
    }

    return id;
  }

  /**
   * Elimina una pista de la cola
   */
  public removeTrack(trackId: string): void {
    const q = this.queue();
    const idx = q.findIndex(t => t.id === trackId);
    if (idx === -1) return;

    // Si es la canción que se está reproduciendo, detener y avanzar
    if (idx === this.currentIndex()) {
      this.stop();
      this.queue.update(prev => prev.filter(t => t.id !== trackId));
      this.localFilesMap.delete(trackId);

      if (this.queue().length > 0) {
        this.currentIndex.set(Math.min(idx, this.queue().length - 1));
        const activePlay = this.activePlayer();
        this.preloadTrackOnPlayer(activePlay, this.queue()[this.currentIndex()]);
      } else {
        this.currentIndex.set(-1);
      }
    } else {
      this.queue.update(prev => prev.filter(t => t.id !== trackId));
      this.localFilesMap.delete(trackId);
      
      // Ajustar el índice actual si borramos una canción anterior
      if (idx < this.currentIndex()) {
        this.currentIndex.update(c => c - 1);
      }
    }
    
    this.saveQueueToLocalStorage();
  }

  /**
   * Mueve una canción en la cola a una posición arbitraria
   */
  public reorderTrack(fromIndex: number, toIndex: number, updateCurrentIndex: boolean = true): void {
    if (fromIndex === toIndex) return;
    const q = [...this.queue()];
    if (fromIndex < 0 || fromIndex >= q.length || toIndex < 0 || toIndex >= q.length) return;

    const [movedTrack] = q.splice(fromIndex, 1);
    q.splice(toIndex, 0, movedTrack);

    // Ajustar el currentIndex si fue afectado y queremos seguir la canción antigua
    if (updateCurrentIndex) {
      let currIdx = this.currentIndex();
      if (currIdx === fromIndex) {
        this.currentIndex.set(toIndex);
      } else if (fromIndex < currIdx && toIndex >= currIdx) {
        this.currentIndex.update(c => c - 1);
      } else if (fromIndex > currIdx && toIndex <= currIdx) {
        this.currentIndex.update(c => c + 1);
      }
    }

    this.queue.set(q);
    this.saveQueueToLocalStorage();
    
    const currIdx = this.currentIndex();
    if (currIdx === -1) return;

    if (!this.isPlaying()) {
      this.preloadTrackOnPlayer(this.activePlayer(), this.queue()[currIdx]);
      if (currIdx < this.queue().length - 1) {
        const nextPlay = this.activePlayer() === 'A' ? 'B' : 'A';
        this.preloadTrackOnPlayer(nextPlay, this.queue()[currIdx + 1]);
      }
    } else {
      // Si está reproduciendo, debemos asegurarnos de que la SIGUIENTE pista esté correctamente precargada
      // por si el usuario movió la canción que venía justo después
      if (currIdx < this.queue().length - 1) {
        const nextPlay = this.activePlayer() === 'A' ? 'B' : 'A';
        this.preloadTrackOnPlayer(nextPlay, this.queue()[currIdx + 1]);
      }
    }
  }

  /**
   * Intercambia la posición de dos pistas (útil para asignar a un deck)
   */
  public swapTrack(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    const q = [...this.queue()];
    if (fromIndex < 0 || fromIndex >= q.length || toIndex < 0 || toIndex >= q.length) return;

    // Intercambiar
    const temp = q[fromIndex];
    q[fromIndex] = q[toIndex];
    q[toIndex] = temp;

    this.queue.set(q);
    this.saveQueueToLocalStorage();

    const currIdx = this.currentIndex();
    if (currIdx === -1) return;

    if (!this.isPlaying()) {
      if (fromIndex === currIdx || toIndex === currIdx) {
        this.preloadTrackOnPlayer(this.activePlayer(), this.queue()[currIdx]);
      }
      if (currIdx < q.length - 1 && (fromIndex === currIdx + 1 || toIndex === currIdx + 1)) {
        const nextPlay = this.activePlayer() === 'A' ? 'B' : 'A';
        this.preloadTrackOnPlayer(nextPlay, this.queue()[currIdx + 1]);
      }
    } else {
      // Si está reproduciendo, solo actualizamos el deck inactivo (el siguiente)
      if (currIdx < q.length - 1 && (fromIndex === currIdx + 1 || toIndex === currIdx + 1)) {
        const nextPlay = this.activePlayer() === 'A' ? 'B' : 'A';
        this.preloadTrackOnPlayer(nextPlay, this.queue()[currIdx + 1]);
      }
    }
  }

  /**
   * Mueve una canción en la cola (subir/bajar)
   */
  public moveTrack(index: number, direction: 'up' | 'down'): void {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    this.reorderTrack(index, targetIndex);
  }

  /**
   * Actualiza los límites de tiempo de una canción
   */
  public updateTrackTimes(trackId: string, startMin: number, startSec: number, endMin: number, endSec: number, crossfade: number): void {
    this.queue.update(q => q.map(t => {
      if (t.id === trackId) {
        return {
          ...t,
          startMinutes: startMin,
          startSeconds: startSec,
          endMinutes: endMin,
          endSeconds: endSec,
          crossfadeTime: crossfade
        };
      }
      return t;
    }));
    this.saveQueueToLocalStorage();

    const current = this.currentTrack();
    if (current && current.id === trackId && !this.isPlaying()) {
      const active = this.activePlayer();
      this.preloadTrackOnPlayer(active, current);
    }
  }

  /**
   * Prepara una canción en un reproductor específico sin reproducir
   */
  private preloadTrackOnPlayer(playerSymbol: 'A' | 'B', track: Track): void {
    const startSeconds = track.startMinutes * 60 + track.startSeconds;

    if (track.source === 'local') {
      const file = this.localFilesMap.get(track.id);
      if (file) {
        const fileUrl = URL.createObjectURL(file);
        const audio = playerSymbol === 'A' ? this.audioA : this.audioB;
        
        audio.src = fileUrl;
        audio.currentTime = startSeconds;
        audio.volume = 0;
        
        // Cargar video vacío en el reproductor de YouTube para silenciarlo
        const ytPlayer = playerSymbol === 'A' ? this.playerA : this.playerB;
        if (ytPlayer && (playerSymbol === 'A' ? this.playerAReady : this.playerBReady)) {
          try {
            ytPlayer.stopVideo();
          } catch(e) {}
        }
      }
    } else {
      // YouTube / Spotify
      const player = playerSymbol === 'A' ? this.playerA : this.playerB;
      const isReady = playerSymbol === 'A' ? this.playerAReady : this.playerBReady;

      // Asegurar que el audio local correspondiente esté apagado
      const audio = playerSymbol === 'A' ? this.audioA : this.audioB;
      audio.pause();
      audio.src = '';

      if (player && isReady) {
        player.cueVideoById({
          videoId: track.videoId,
          startSeconds: startSeconds
        });
        player.setVolume(0);
      }
    }

    if (playerSymbol === 'A') {
      this.playerATime.set(startSeconds);
    } else {
      this.playerBTime.set(startSeconds);
    }
  }

  /**
   * Inicia o reanuda la mezcla
   */
  public play(): void {
    if (this.queue().length === 0) return;

    if (this.currentIndex() === -1) {
      this.currentIndex.set(0);
    }

    const track = this.currentTrack();
    if (!track) return;

    this.isPlaying.set(true);
    
    const active = this.activePlayer();
    this.updateVolumesBasedOnCrossfader();

    if (track.source === 'local') {
      const audio = active === 'A' ? this.audioA : this.audioB;
      audio.play().catch(err => console.warn('Error al reproducir audio local:', err));
    } else {
      const player = active === 'A' ? this.playerA : this.playerB;
      if (player) {
        player.playVideo();
      }
    }

    this.startMonitoring();
  }

  /**
   * Pausa la mezcla
   */
  public pause(): void {
    this.isPlaying.set(false);
    this.stopMonitoring();

    if (this.playerA) this.playerA.pauseVideo();
    if (this.playerB) this.playerB.pauseVideo();
    
    this.audioA.pause();
    this.audioB.pause();
  }

  /**
   * Detiene por completo la mezcla
   */
  public stop(): void {
    this.isPlaying.set(false);
    this.stopMonitoring();
    this.isFading = false;
    if (this.fadeInterval) clearInterval(this.fadeInterval);
    
    this.crossfaderValue.set(this.activePlayer() === 'A' ? -100 : 100);

    if (this.playerA) {
      try { this.playerA.stopVideo(); } catch(e) {}
      this.playerA.setVolume(0);
    }
    if (this.playerB) {
      try { this.playerB.stopVideo(); } catch(e) {}
      this.playerB.setVolume(0);
    }

    this.audioA.pause();
    this.audioA.currentTime = 0;
    this.audioA.volume = 0;

    this.audioB.pause();
    this.audioB.currentTime = 0;
    this.audioB.volume = 0;

    // Regresar al inicio del track actual
    const current = this.currentTrack();
    if (current) {
      this.preloadTrackOnPlayer(this.activePlayer(), current);
    }
    
    // Asegurar que el deck inactivo tenga precargada la siguiente canción
    const next = this.nextTrack();
    if (next) {
      const nextPlay = this.activePlayer() === 'A' ? 'B' : 'A';
      this.preloadTrackOnPlayer(nextPlay, next);
    }
  }

  /**
   * Salta a la siguiente canción forzando una mezcla inmediata
   */
  public next(): void {
    const nextTrack = this.nextTrack();
    if (!nextTrack) return;

    if (!this.isPlaying()) {
      // Salto instantáneo si está en pausa (evita iniciar el crossfade y desincronizar el estado isPlaying)
      const nextIdx = this.currentIndex() + 1;
      this.currentIndex.set(nextIdx);
      
      const nextPlay = this.activePlayer() === 'A' ? 'B' : 'A';
      this.activePlayer.set(nextPlay);
      this.crossfaderValue.set(nextPlay === 'A' ? -100 : 100);
      
      this.preloadTrackOnPlayer(nextPlay, this.queue()[nextIdx]);
      if (nextIdx + 1 < this.queue().length) {
        const inactivePlay = nextPlay === 'A' ? 'B' : 'A';
        this.preloadTrackOnPlayer(inactivePlay, this.queue()[nextIdx + 1]);
      }
      return;
    }

    this.triggerCrossfade();
  }

  /**
   * Retrocede a la canción anterior
   */
  public prev(): void {
    const idx = this.currentIndex();
    if (idx <= 0) return;

    this.stopMonitoring();
    if (this.fadeInterval) clearInterval(this.fadeInterval);
    this.isFading = false;

    // Pausar limpieza para evitar audio superpuesto de un crossfade interrumpido
    if (this.playerA) { try { this.playerA.pauseVideo(); } catch(e){} }
    if (this.playerB) { try { this.playerB.pauseVideo(); } catch(e){} }
    this.audioA.pause();
    this.audioB.pause();

    const newIdx = idx - 1;
    this.currentIndex.set(newIdx);
    
    // Cambiar reproductor para mantener simetría A/B
    const active = this.activePlayer() === 'A' ? 'B' : 'A';
    this.activePlayer.set(active);
    this.crossfaderValue.set(active === 'A' ? -100 : 100);
    
    // Precargar las pistas correspondientes en ambos decks
    this.preloadTrackOnPlayer(active, this.queue()[newIdx]);
    
    const inactive = active === 'A' ? 'B' : 'A';
    this.preloadTrackOnPlayer(inactive, this.queue()[newIdx + 1]);

    if (this.isPlaying()) {
      this.play();
    }
  }

  /**
   * Ajusta el volumen maestro (0 - 100)
   */
  public setMasterVolume(vol: number): void {
    this.masterVolume.set(vol);
    this.updateVolumesBasedOnCrossfader();
  }

  /**
   * Ajusta manualmente el crossfader (-100 a 100)
   */
  public setCrossfaderManual(val: number): void {
    if (this.isFading) {
      clearInterval(this.fadeInterval);
      this.isFading = false;
    }
    
    this.crossfaderValue.set(val);
    this.updateVolumesBasedOnCrossfader();
  }

  /**
   * Modifica el tiempo actual de reproducción del track activo
   */
  public seekTo(seconds: number): void {
    const active = this.activePlayer();
    const current = this.currentTrack();
    
    if (current && current.source === 'local') {
      const audio = active === 'A' ? this.audioA : this.audioB;
      audio.currentTime = seconds;
      if (active === 'A') {
        this.playerATime.set(seconds);
      } else {
        this.playerBTime.set(seconds);
      }
    } else {
      const player = active === 'A' ? this.playerA : this.playerB;
      if (player) {
        player.seekTo(seconds, true);
        if (active === 'A') {
          this.playerATime.set(seconds);
        } else {
          this.playerBTime.set(seconds);
        }
      }
    }
  }

  /**
   * Inicia el monitoreo constante de los reproductores (progreso)
   */
  private startMonitoring(): void {
    if (this.monitorInterval) clearInterval(this.monitorInterval);

    this.monitorInterval = setInterval(() => {
      const active = this.activePlayer();
      const currentTrack = this.currentTrack();
      
      if (!currentTrack) return;

      const endSeconds = currentTrack.endMinutes * 60 + currentTrack.endSeconds;
      const fadeStart = endSeconds - currentTrack.crossfadeTime;

      // Actualizar tiempos en signals
      try {
        // Deck A
        const trackA = (this.activePlayer() === 'A') ? this.currentTrack() : this.nextTrack();
        if (trackA) {
          if (trackA.source === 'local') {
            this.playerATime.set(this.audioA.currentTime);
            this.playerADuration.set(this.audioA.duration || 0);
          } else if (this.playerA && this.playerAReady) {
            const time = this.playerA.getCurrentTime();
            this.playerATime.set(time);
            this.playerADuration.set(this.playerA.getDuration());
          }
        }

        // Deck B
        const trackB = (this.activePlayer() === 'B') ? this.currentTrack() : this.nextTrack();
        if (trackB) {
          if (trackB.source === 'local') {
            this.playerBTime.set(this.audioB.currentTime);
            this.playerBDuration.set(this.audioB.duration || 0);
          } else if (this.playerB && this.playerBReady) {
            const time = this.playerB.getCurrentTime();
            this.playerBTime.set(time);
            this.playerBDuration.set(this.playerB.getDuration());
          }
        }
      } catch (e) {
        // Ignorar
      }

      const currentPlayback = this.currentPlaybackTime();

      // Verificar si es hora de iniciar el crossfade automático
      if (this.isPlaying() && !this.isFading && this.nextTrack() && currentPlayback >= fadeStart) {
        this.triggerCrossfade();
      }

      // Si llegó al final absoluto de la canción y no hay siguiente, detener
      if (this.isPlaying() && currentPlayback >= endSeconds) {
        if (!this.nextTrack() && !this.isFading) {
          this.stop();
        }
      }
    }, 250);
  }

  private stopMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
  }

  /**
   * Ejecuta la mezcla (crossfade) de la pista actual a la siguiente
   */
  private triggerCrossfade(): void {
    const next = this.nextTrack();
    if (!next || this.isFading) return;

    this.isFading = true;
    const currentTrack = this.currentTrack()!;
    const fadeDuration = currentTrack.crossfadeTime * 1000;
    const steps = 30;
    const stepDuration = fadeDuration / steps;

    const fromPlayer = this.activePlayer();
    const toPlayer = fromPlayer === 'A' ? 'B' : 'A';
    
    // Iniciar reproducción
    if (next.source === 'local') {
      const nextAudio = toPlayer === 'A' ? this.audioA : this.audioB;
      nextAudio.play().catch(err => console.warn('Error al iniciar audio local en crossfade:', err));
    } else {
      const nextPlayerObj = toPlayer === 'A' ? this.playerA : this.playerB;
      if (nextPlayerObj) {
        nextPlayerObj.playVideo();
      }
    }

    let currentStep = 0;
    const startCrossfaderVal = fromPlayer === 'A' ? -100 : 100;
    const targetCrossfaderVal = fromPlayer === 'A' ? 100 : -100;
    const crossfaderDiff = targetCrossfaderVal - startCrossfaderVal;

    if (this.fadeInterval) clearInterval(this.fadeInterval);

    this.fadeInterval = setInterval(() => {
      currentStep++;
      const progress = currentStep / steps;

      // Calcular el valor del crossfader
      const currentCrossfaderVal = startCrossfaderVal + (crossfaderDiff * progress);
      this.crossfaderValue.set(currentCrossfaderVal);

      // Actualizar volúmenes de ambos reproductores
      this.updateVolumesBasedOnCrossfader();

      if (currentStep >= steps) {
        clearInterval(this.fadeInterval);
        this.fadeInterval = null;
        
        // Detener el reproductor anterior
        if (currentTrack.source === 'local') {
          const prevAudio = fromPlayer === 'A' ? this.audioA : this.audioB;
          prevAudio.pause();
          prevAudio.currentTime = 0;
          prevAudio.volume = 0;
        } else {
          const prevPlayerObj = fromPlayer === 'A' ? this.playerA : this.playerB;
          if (prevPlayerObj) {
            try { prevPlayerObj.stopVideo(); } catch(e) {}
            prevPlayerObj.setVolume(0);
          }
        }

        // Intercambiar reproductor activo principal
        this.activePlayer.set(toPlayer);
        this.crossfaderValue.set(toPlayer === 'A' ? -100 : 100);
        this.currentIndex.update(idx => idx + 1);
        
        this.isFading = false;

        // Pre-cargar la que le sigue en el que quedó libre si existe
        const nextNext = this.nextTrack();
        if (nextNext) {
          this.preloadTrackOnPlayer(fromPlayer, nextNext);
        }
      }
    }, stepDuration);
  }

  /**
   * Recalcula los volúmenes de Player A y Player B usando el valor del masterVolume y del crossfader
   */
  private updateVolumesBasedOnCrossfader(): void {
    const master = this.masterVolume();
    const xFader = this.crossfaderValue(); // -100 a 100

    let volA = 0;
    let volB = 0;

    if (xFader <= 0) {
      volA = master;
      volB = master * (1 + (xFader / 100));
    } else {
      volB = master;
      volA = master * (1 - (xFader / 100));
    }

    // Aplicar a YouTube A
    if (this.playerA && this.playerAReady) {
      this.playerA.setVolume(Math.round(volA));
    }
    // Aplicar a YouTube B
    if (this.playerB && this.playerBReady) {
      this.playerB.setVolume(Math.round(volB));
    }

    // Aplicar a HTML5 Audio A y B (rango de 0.0 a 1.0)
    this.audioA.volume = volA / 100;
    this.audioB.volume = volB / 100;
  }

  /**
   * Escucha cambios de estado de YouTube y reacciona (ej. buffering, finalización)
   */
  private handlePlayerStateChange(playerSymbol: 'A' | 'B', event: any): void {
    const state = event.data;
    if (state === 0) { // ENDED
      if (playerSymbol === this.activePlayer() && !this.isFading) {
        if (this.nextTrack()) {
          this.triggerCrossfade();
        } else {
          this.stop();
        }
      }
    }
  }

  /**
   * Listener cuando finaliza un archivo local
   */
  private handleLocalPlayerEnded(playerSymbol: 'A' | 'B'): void {
    if (playerSymbol === this.activePlayer() && !this.isFading) {
      if (this.nextTrack()) {
        this.triggerCrossfade();
      } else {
        this.stop();
      }
    }
  }

  /**
   * Unifica y renderiza la mezcla de archivos locales offline de forma instantánea (en 3s)
   */
  public async renderOfflineMix(format: 'mp3' | 'wav'): Promise<Blob> {
    const queue = this.queue();
    if (queue.length === 0) {
      throw new Error('El setlist está vacío.');
    }

    // Validar que todas las canciones sean locales para poder hacer mezcla offline
    const hasExternal = queue.some(t => t.source !== 'local');
    if (hasExternal) {
      throw new Error('Solo se pueden exportar al instante mezclas que contengan canciones locales (MP3/WAV). Si tienes canciones de YouTube, debes usar la función de Grabación en Vivo.');
    }

    this.isOfflineProcessing.set(true);
    this.offlineProgress.set(5);

    try {
      // 1. Calcular duración total del mix final
      let totalDuration = 0;
      const trackParams = queue.map((track, i) => {
        const startSec = track.startMinutes * 60 + track.startSeconds;
        const endSec = track.endMinutes * 60 + track.endSeconds;
        const duration = endSec - startSec;
        return { track, startSec, endSec, duration };
      });

      for (let i = 0; i < trackParams.length; i++) {
        const params = trackParams[i];
        if (i === trackParams.length - 1) {
          totalDuration += params.duration;
        } else {
          totalDuration += (params.duration - params.track.crossfadeTime);
        }
      }

      this.offlineProgress.set(15);

      // 2. Crear OfflineAudioContext
      const sampleRate = 44100;
      const offlineCtx = new OfflineAudioContext(2, Math.max(1, totalDuration * sampleRate), sampleRate);
      
      // Contexto temporal de audio para decodificar
      const tempCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

      // 3. Cargar y decodificar todos los archivos en buffers de audio
      const audioBuffersMap = new Map<string, AudioBuffer>();
      let progressStep = 15;

      for (let i = 0; i < queue.length; i++) {
        const track = queue[i];
        const file = this.localFilesMap.get(track.id);
        if (!file) {
          throw new Error(`No se encontró el archivo físico para: ${track.title}`);
        }

        const arrayBuffer = await file.arrayBuffer();
        const decodedBuffer = await tempCtx.decodeAudioData(arrayBuffer);
        audioBuffersMap.set(track.id, decodedBuffer);

        // Incrementar progreso
        progressStep += Math.round(35 / queue.length);
        this.offlineProgress.set(progressStep);
      }

      tempCtx.close();
      this.offlineProgress.set(55);

      // 4. Programar los nodos y curvas de ganancia (crossfading) en el Offline Context
      let scheduleTime = 0;

      for (let i = 0; i < trackParams.length; i++) {
        const { track, startSec, duration } = trackParams[i];
        const buffer = audioBuffersMap.get(track.id)!;

        // Crear nodo fuente y ganancia
        const sourceNode = offlineCtx.createBufferSource();
        sourceNode.buffer = buffer;
        
        const gainNode = offlineCtx.createGain();
        
        // Enlazar nodos
        sourceNode.connect(gainNode);
        gainNode.connect(offlineCtx.destination);

        // Programar volumen maestro en la ganancia
        const masterVolCoeff = this.masterVolume() / 100;

        // Programar curvas de Crossfading
        const fadeTime = track.crossfadeTime;

        // Configuración inicial de ganancia
        gainNode.gain.setValueAtTime(0, scheduleTime);

        if (i === 0) {
          // Primera canción empieza a volumen completo
          gainNode.gain.setValueAtTime(masterVolCoeff, scheduleTime);
        } else {
          // Fade in gradual desde el inicio del overlap
          gainNode.gain.linearRampToValueAtTime(masterVolCoeff, scheduleTime + fadeTime);
        }

        if (i < queue.length - 1) {
          // Fade out gradual antes de terminar
          const fadeOutStart = scheduleTime + duration - fadeTime;
          gainNode.gain.setValueAtTime(masterVolCoeff, fadeOutStart);
          gainNode.gain.linearRampToValueAtTime(0, scheduleTime + duration);
        } else {
          // Última canción reproduce a volumen completo hasta el final
          gainNode.gain.setValueAtTime(masterVolCoeff, scheduleTime + duration);
        }

        // Programar inicio y fin de reproducción de la pista recortada
        sourceNode.start(scheduleTime, startSec, duration);

        // Actualizar el tiempo para la siguiente canción (restando el solapamiento del fade)
        scheduleTime += (duration - fadeTime);
      }

      this.offlineProgress.set(65);

      // 5. Iniciar renderizado offline
      const renderedBuffer = await offlineCtx.startRendering();
      this.offlineProgress.set(80);

      // 6. Codificar el AudioBuffer resultante a MP3 o WAV
      let resultBlob: Blob;
      if (format === 'wav') {
        resultBlob = this.recorderService.bufferToWav(renderedBuffer);
      } else {
        resultBlob = await this.recorderService.bufferToMp3Async(renderedBuffer);
      }

      this.offlineProgress.set(100);
      return resultBlob;

    } catch (e) {
      console.error('Error en mezcla offline:', e);
      throw e;
    } finally {
      this.isOfflineProcessing.set(false);
    }
  }

  /**
   * Guarda el estado actual de la cola en LocalStorage
   */
  private saveQueueToLocalStorage(): void {
    try {
      // Nota: No podemos guardar el archivo File binario en LocalStorage,
      // solo guardamos la estructura de metadatos de las pistas.
      // Al reiniciar la página, las canciones locales pedirán ser re-cargadas si no están en memoria.
      const serializableQueue = this.queue().map(t => ({
        ...t,
        // Si es local, lo marcamos para pedir al usuario re-cargar o advertir
      }));
      localStorage.setItem('beat_blender_queue', JSON.stringify(serializableQueue));
    } catch (e) {
      console.error('No se pudo guardar la cola en LocalStorage:', e);
    }
  }

  /**
   * Carga la cola guardada previamente
   */
  public loadQueueFromLocalStorage(): void {
    try {
      const data = localStorage.getItem('beat_blender_queue');
      if (data) {
        const parsed = JSON.parse(data) as Track[];
        if (parsed && parsed.length > 0) {
          // Limpiar referencias locales obsoletas
          this.queue.set(parsed.filter(t => t.source !== 'local')); 
          if (this.queue().length > 0) {
            this.currentIndex.set(0);
            this.preloadTrackOnPlayer('A', this.queue()[0]);
          }
        }
      }
    } catch (e) {
      console.error('No se pudo cargar la cola desde LocalStorage:', e);
    }
  }

  private generateBpmAndKey(title: string, artist: string): { bpm: number; key: string } {
    const str = `${title} ${artist}`.toLowerCase();
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    hash = Math.abs(hash);
    
    // BPM entre 90 y 135
    const bpm = 90 + (hash % 46);
    
    // Clave Camelot (1A a 12A, 1B a 12B)
    const keyNumber = 1 + (hash % 12);
    const keyLetter = (hash >> 4) % 2 === 0 ? 'A' : 'B';
    const key = `${keyNumber}${keyLetter}`;
    
    return { bpm, key };
  }

  public autoMixQueue(): void {
    const q = [...this.queue()];
    if (q.length < 2) {
      this.showToast('Añade al menos 2 canciones a la cola para mezclar automáticamente.', 'info');
      return;
    }

    // Identificar la canción inicial (la que está sonando, o la primera)
    let currentActiveTrackId: string | null = null;
    const currentIdx = this.currentIndex();
    if (currentIdx >= 0 && currentIdx < q.length) {
      currentActiveTrackId = q[currentIdx].id;
    }

    // Helper para parsear la clave Camelot (Ej: "8A" -> { num: 8, char: 'A' })
    const parseKey = (keyStr: string | undefined) => {
      if (!keyStr) return { num: 1, char: 'A' };
      const num = parseInt(keyStr.slice(0, -1)) || 1;
      const char = keyStr.slice(-1) || 'A';
      return { num, char };
    };

    // Helper para distancia Camelot
    const getKeyDistance = (k1: string | undefined, k2: string | undefined) => {
      const p1 = parseKey(k1);
      const p2 = parseKey(k2);
      
      if (p1.num === p2.num && p1.char === p2.char) return 0; // Idéntico
      
      const numDiff = Math.min(
        Math.abs(p1.num - p2.num),
        12 - Math.abs(p1.num - p2.num)
      );

      if (p1.char === p2.char) {
        if (numDiff === 1) return 1; // Vecino en el círculo
        return 3; // Distante
      } else {
        if (p1.num === p2.num) return 1; // Relativa mayor/menor
        if (numDiff === 1) return 2; // Diagonal
        return 4; // Muy distante
      }
    };

    const newOrder: Track[] = [];
    
    // Extraer la primera pista
    let currentTrack: Track;
    if (currentActiveTrackId) {
      const idx = q.findIndex(t => t.id === currentActiveTrackId);
      currentTrack = q.splice(idx, 1)[0];
    } else {
      currentTrack = q.shift()!;
    }
    
    newOrder.push(currentTrack);

    while (q.length > 0) {
      const last = newOrder[newOrder.length - 1];
      
      let bestIdx = 0;
      let bestScore = Infinity;

      for (let i = 0; i < q.length; i++) {
        const candidate = q[i];
        const keyDist = getKeyDistance(last.key, candidate.key);
        const bpmDiff = Math.abs((last.bpm || 120) - (candidate.bpm || 120));
        
        // Penalizar de forma masiva saltos que no sean armónicos (distancia > 1 en Rueda Camelot)
        // Distancia 0 = 0 penalización
        // Distancia 1 (vecino o relativa) = 5 penalización
        // Distancia 2 (diagonal) = 60 penalización
        // Distancia >= 3 (incompatible) = 300 penalización
        const keyPenalty = keyDist === 0 ? 0 : (keyDist === 1 ? 5 : (keyDist === 2 ? 60 : 300));
        
        const score = bpmDiff + keyPenalty;
        if (score < bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }

      const next = q.splice(bestIdx, 1)[0];
      newOrder.push(next);
    }

    // Aplicar optimización de cortes de tiempo y crossfade a todas las pistas
    const optimizedQueue = newOrder.map(track => {
      // Intros y Outros automatizadas: quitar 8 segundos al inicio y final para mezclas fluidas
      const startOffset = track.duration > 30 ? 8 : 0;
      const endOffset = track.duration > 30 ? track.duration - 8 : track.duration;
      
      return {
        ...track,
        startMinutes: Math.floor(startOffset / 60),
        startSeconds: Math.floor(startOffset % 60),
        endMinutes: Math.floor(endOffset / 60),
        endSeconds: Math.floor(endOffset % 60),
        crossfadeTime: 8 // Forzar a un crossfade de 8s (más suave y profesional)
      };
    });

    // Guardar nueva cola
    this.queue.set(optimizedQueue);
    
    // Restablecer el currentIndex para que coincida con la posición de la pista activa
    if (currentActiveTrackId) {
      const newActiveIdx = optimizedQueue.findIndex(t => t.id === currentActiveTrackId);
      if (newActiveIdx !== -1) {
        this.currentIndex.set(newActiveIdx);
      }
    } else {
      this.currentIndex.set(0);
    }

    this.saveQueueToLocalStorage();
    this.showToast('¡Mezcla automática optimizada! Pistas reordenadas por tono (Camelot Wheel) y BPM con crossfade de 8s.', 'success', 6000);
  }
}
