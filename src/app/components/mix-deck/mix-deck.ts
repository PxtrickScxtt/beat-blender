import { Component, inject, signal, effect, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MixerService } from '../../services/mixer';
import { AudioRecorderService } from '../../services/audio-recorder';

@Component({
  selector: 'app-mix-deck',
  imports: [CommonModule],
  templateUrl: './mix-deck.html',
  styleUrl: './mix-deck.scss',
})
export class MixDeck implements OnDestroy {
  public mixer = inject(MixerService);
  public recorder = inject(AudioRecorderService);
  
  protected readonly Math = Math;

  // Formato de descarga seleccionado
  public selectedFormat = signal<'mp3' | 'wav' | 'webm'>('mp3');
  
  // Mensaje informativo/error de grabación
  public recordingError = signal<string | null>(null);

  // Alturas de las barras del visualizador de espectro (20 canales)
  public visualizerBars = signal<number[]>(new Array(20).fill(6));
  private visualizerInterval: any = null;

  constructor() {
    // Efecto reactivo que prende/apaga el visualizador según el estado de reproducción
    effect(() => {
      const playing = this.mixer.isPlaying();
      if (playing) {
        this.startVisualizer();
      } else {
        this.stopVisualizer();
      }
    });

    // Detener grabación si la reproducción se detiene de forma natural (se acaba el setlist)
    effect(() => {
      const playing = this.mixer.isPlaying();
      const recording = this.recorder.isRecording();
      
      // Si terminó de reproducirse el set y estábamos grabando
      if (!playing && recording) {
        this.stopAndSaveRecording();
      }
    });
  }

  ngOnDestroy(): void {
    this.stopVisualizer();
  }

  /**
   * Formatea un tiempo en segundos a formato MM:SS
   */
  public formatTime(sec: number): string {
    if (isNaN(sec) || sec < 0) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  /**
   * Obtiene la duración total recortada del track actual en formato MM:SS
   */
  public getCutDurationFormatted(): string {
    const track = this.mixer.currentTrack();
    if (!track) return '00:00';
    const start = track.startMinutes * 60 + track.startSeconds;
    const end = track.endMinutes * 60 + track.endSeconds;
    return this.formatTime(Math.max(0, end - start));
  }

  /**
   * Obtiene el tiempo relativo actual de reproducción desde el punto de inicio del recorte
   */
  public getRelativeTimeFormatted(): string {
    const track = this.mixer.currentTrack();
    if (!track) return '00:00';
    const start = track.startMinutes * 60 + track.startSeconds;
    const current = this.mixer.currentPlaybackTime();
    return this.formatTime(Math.max(0, current - start));
  }

  /**
   * Controla el volumen mediante el slider principal (0 a 100)
   */
  public onVolumeChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    const value = parseInt(target.value, 10);
    this.mixer.setMasterVolume(value);
  }

  /**
   * Controla el valor del crossfader (-100 a 100)
   */
  public onCrossfaderChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    const value = parseInt(target.value, 10);
    this.mixer.setCrossfaderManual(value);
  }

  /**
   * Permite adelantar o retrasar la canción pulsando en la barra de progreso
   */
  public onProgressBarClick(event: MouseEvent): void {
    const track = this.mixer.currentTrack();
    if (!track) return;

    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const width = rect.width;
    const percentage = clickX / width;

    const start = track.startMinutes * 60 + track.startSeconds;
    const end = track.endMinutes * 60 + track.endSeconds;
    const targetSeconds = start + (end - start) * percentage;
    
    this.mixer.seekTo(targetSeconds);
  }

  /**
   * Inicia la grabación del audio de la pestaña y arranca la reproducción del mix
   */
  public async startRecordingMix(): Promise<void> {
    if (this.mixer.queue().length === 0) {
      this.recordingError.set('Añade al menos una canción a la cola para poder grabar.');
      return;
    }

    this.recordingError.set(null);

    try {
      // 1. Iniciar grabadora (solicitar compartir pestaña)
      await this.recorder.startRecording();
      
      // 2. Si se obtuvo el stream, comenzar a reproducir el setlist
      this.mixer.stop(); // Resetear al inicio del primer track
      
      // Pequeño delay para asegurar que el grabador está capturando antes del audio
      setTimeout(() => {
        this.mixer.play();
      }, 500);

    } catch (e) {
      console.error(e);
      this.recordingError.set(e instanceof Error ? e.message : 'Error al iniciar la grabación.');
    }
  }

  /**
   * Detiene la grabación y descarga el archivo procesado automáticamente
   */
  public async stopAndSaveRecording(): Promise<void> {
    this.mixer.pause();
    
    const webmBlob = await this.recorder.stopRecording();
    if (!webmBlob) return;

    const format = this.selectedFormat();
    
    try {
      // Convertir al formato deseado (MP3, WAV o WebM nativo)
      const finalBlob = await this.recorder.convertToFormat(webmBlob, format);
      
      // Generar nombre de archivo
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const filename = `beatblender-mix-${timestamp}.${format}`;
      
      // Descargar archivo en el navegador
      this.triggerFileDownload(finalBlob, filename);

    } catch (e) {
      console.error(e);
      this.recordingError.set(e instanceof Error ? e.message : 'Error al procesar el archivo de audio.');
    }
  }

  /**
   * Comprueba si la cola contiene únicamente archivos locales
   */
  public isQueueOnlyLocal(): boolean {
    const q = this.mixer.queue();
    return q.length > 0 && q.every(t => t.source === 'local');
  }

  /**
   * Ejecuta la mezcla y descarga offline (instantánea) de los archivos locales en 3s
   */
  public async downloadInstantMix(): Promise<void> {
    this.recordingError.set(null);
    const format = this.selectedFormat() === 'webm' ? 'mp3' : this.selectedFormat();
    
    try {
      const finalBlob = await this.mixer.renderOfflineMix(format as any);
      
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const filename = `beatblender-instant-mix-${timestamp}.${format}`;
      
      this.triggerFileDownload(finalBlob, filename);
    } catch (e) {
      console.error(e);
      this.recordingError.set(e instanceof Error ? e.message : 'Error al generar la mezcla offline.');
    }
  }

  /**
   * Cambia el formato seleccionado de descarga
   */
  public changeFormat(format: 'mp3' | 'wav' | 'webm'): void {
    this.selectedFormat.set(format);
  }

  /**
   * Lanza la descarga del archivo en el navegador del cliente
   */
  private triggerFileDownload(blob: Blob, fileName: string): void {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  /**
   * Simulación interactiva de ondas de audio
   */
  private startVisualizer(): void {
    if (this.visualizerInterval) clearInterval(this.visualizerInterval);

    this.visualizerInterval = setInterval(() => {
      const newBars = Array.from({ length: 20 }, () => Math.floor(Math.random() * 85) + 15);
      this.visualizerBars.set(newBars);
    }, 90);
  }

  private stopVisualizer(): void {
    if (this.visualizerInterval) {
      clearInterval(this.visualizerInterval);
      this.visualizerInterval = null;
    }
    this.visualizerBars.set(new Array(20).fill(6));
  }

  // --- Drag & Drop de Tracks en Decks ---
  public onDragOverDeck(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  public onDropDeck(event: DragEvent, deck: 'A' | 'B'): void {
    event.preventDefault();
    if (!event.dataTransfer) return;
    
    const indexStr = event.dataTransfer.getData('text/plain');
    if (!indexStr) return;
    
    const sourceIdx = parseInt(indexStr, 10);
    if (isNaN(sourceIdx)) return;

    // Determinar a qué índice debe ir según si el deck está activo o no
    const isActiveA = this.mixer.activePlayer() === 'A';
    
    let targetIdx: number;
    if (deck === 'A') {
      targetIdx = isActiveA ? this.mixer.currentIndex() : this.mixer.currentIndex() + 1;
    } else {
      targetIdx = isActiveA ? this.mixer.currentIndex() + 1 : this.mixer.currentIndex();
    }
    
    if (this.mixer.currentIndex() === -1) {
      targetIdx = 0;
    }
    
    if (sourceIdx !== targetIdx) {
      this.mixer.swapTrack(sourceIdx, targetIdx);
    }
  }
}
