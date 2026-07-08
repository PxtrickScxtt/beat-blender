import { Component, inject, signal, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MixerService, Track } from '../../services/mixer';

@Component({
  selector: 'app-track-queue',
  imports: [CommonModule],
  templateUrl: './track-queue.html',
  styleUrl: './track-queue.scss',
})
export class TrackQueue {
  public mixer = inject(MixerService);
  
  // Emite evento para abrir el buscador
  public onAddClick = output<void>();

  // ID del track que se está editando actualmente (acordeón abierto)
  public editingTrackId = signal<string | null>(null);

  // Estado del arrastre (dragover class visual)
  public isDragging = signal<boolean>(false);

  /**
   * Alterna la visualización del panel de edición de tiempos para una canción
   */
  public toggleEdit(trackId: string): void {
    if (this.editingTrackId() === trackId) {
      this.editingTrackId.set(null);
    } else {
      this.editingTrackId.set(trackId);
    }
  }

  /**
   * Formatea minutos/segundos a cadena MM:SS
   */
  public formatTime(m: number, s: number): string {
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  /**
   * Elimina todas las pistas del setlist
   */
  public clearQueue(): void {
    this.mixer.stop();
    this.mixer.queue.set([]);
    this.mixer.currentIndex.set(-1);
    this.editingTrackId.set(null);
    localStorage.removeItem('beat_blender_queue');
  }

  /**
   * Manejador de selección de archivos locales desde botón
   */
  public async onFileSelected(event: Event): Promise<void> {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      await this.processFiles(target.files);
    }
  }

  /**
   * Eventos Drag & Drop (Archivos locales)
   */
  public onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  public onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
  }

  public async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);

    if (event.dataTransfer && event.dataTransfer.files.length > 0) {
      await this.processFiles(event.dataTransfer.files);
    }
  }

  // --- Reordering Tracks Drag & Drop ---
  public dragSourceIndex = signal<number | null>(null);

  public onTrackDragStart(event: DragEvent, index: number): void {
    this.dragSourceIndex.set(index);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', index.toString());
      
      // Intentar establecer una imagen de drag invisible o genérica (opcional)
      // const img = new Image();
      // img.src = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
      // event.dataTransfer.setDragImage(img, 0, 0);
    }
  }

  public onTrackDragOver(event: DragEvent): void {
    // Solo permitir el drop si estamos arrastrando una pista (tenemos un source index)
    if (this.dragSourceIndex() !== null) {
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
    }
  }

  public onTrackDrop(event: DragEvent, dropIndex: number): void {
    event.preventDefault();
    event.stopPropagation();
    const sourceIdx = this.dragSourceIndex();
    if (sourceIdx !== null && sourceIdx !== dropIndex) {
      this.mixer.reorderTrack(sourceIdx, dropIndex);
    }
    this.dragSourceIndex.set(null);
  }
  
  public onTrackDragEnd(): void {
    this.dragSourceIndex.set(null);
  }

  /**
   * Procesa los archivos de audio seleccionados
   */
  private async processFiles(files: FileList): Promise<void> {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      // Validar tipo de archivo
      if (!file.type.startsWith('audio/')) {
        alert(`El archivo "${file.name}" no es un archivo de audio válido.`);
        continue;
      }

      try {
        const duration = await this.getAudioDuration(file);
        this.mixer.addLocalTrack(file, duration);
      } catch (e) {
        console.error('Error al procesar archivo local:', e);
        alert(`No se pudo cargar la duración de: ${file.name}`);
      }
    }
  }

  /**
   * Obtiene la duración del archivo local cargándolo en un Audio temporal
   */
  private getAudioDuration(file: File): Promise<number> {
    return new Promise((resolve, reject) => {
      const audio = new Audio();
      const url = URL.createObjectURL(file);
      
      audio.src = url;
      audio.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(audio.duration);
      };
      
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('No se pudo decodificar el archivo de audio'));
      };
    });
  }

  /**
   * Carga el setlist de ejemplo de Aaron (YouTube)
   */
  public loadAaronExample(): void {
    this.clearQueue();

    const tracks: Track[] = [
      {
        id: 'aaron-1',
        videoId: 'CAYOb9MDixo',
        title: 'Ojitos Lindos (Official Video)',
        artist: 'Bad Bunny ft. Bomba Estéreo',
        thumbnail: 'https://img.youtube.com/vi/CAYOb9MDixo/mqdefault.jpg',
        startMinutes: 0,
        startSeconds: 0,
        endMinutes: 1,
        endSeconds: 20,
        duration: 258,
        crossfadeTime: 5,
        source: 'youtube'
      },
      {
        id: 'aaron-2',
        videoId: '5sPXvXuJ_8Q',
        title: 'Tití Me Preguntó (Official Video)',
        artist: 'Bad Bunny',
        thumbnail: 'https://img.youtube.com/vi/5sPXvXuJ_8Q/mqdefault.jpg',
        startMinutes: 3,
        startSeconds: 43,
        endMinutes: 4,
        endSeconds: 31,
        duration: 283,
        crossfadeTime: 5,
        source: 'youtube'
      },
      {
        id: 'aaron-3',
        videoId: '-rtO90pJ54w',
        title: 'Moscow Mule (Official Video)',
        artist: 'Bad Bunny',
        thumbnail: 'https://img.youtube.com/vi/-rtO90pJ54w/mqdefault.jpg',
        startMinutes: 0,
        startSeconds: 0,
        endMinutes: 1,
        endSeconds: 1,
        duration: 240,
        crossfadeTime: 5,
        source: 'youtube'
      }
    ];

    this.mixer.queue.set(tracks);
    this.mixer.currentIndex.set(0);
    
    try {
      localStorage.setItem('beat_blender_queue', JSON.stringify(tracks));
    } catch (e) {
      console.error(e);
    }

    setTimeout(() => {
      this.mixer.stop();
    }, 100);
  }

  /**
   * Guarda los cambios de tiempo del track
   */
  public saveTrackTimes(
    track: Track, 
    startMinVal: string, 
    startSecVal: string, 
    endMinVal: string, 
    endSecVal: string,
    fadeVal: string
  ): void {
    const sMin = Math.max(0, parseInt(startMinVal, 10) || 0);
    const sSec = Math.max(0, Math.min(59, parseInt(startSecVal, 10) || 0));
    const eMin = Math.max(0, parseInt(endMinVal, 10) || 0);
    const eSec = Math.max(0, Math.min(59, parseInt(endSecVal, 10) || 0));
    const fade = Math.max(1, parseInt(fadeVal, 10) || 1);

    const startTotal = sMin * 60 + sSec;
    const endTotal = eMin * 60 + eSec;

    if (endTotal <= startTotal) {
      alert('El tiempo de fin debe ser mayor al tiempo de inicio.');
      return;
    }

    if (endTotal > track.duration && track.duration > 0) {
      alert(`El tiempo de fin no puede superar la duración original de la canción (${this.formatTime(Math.floor(track.duration / 60), Math.floor(track.duration % 60))}).`);
      return;
    }

    this.mixer.updateTrackTimes(track.id, sMin, sSec, eMin, eSec, fade);
    this.editingTrackId.set(null); // Cerrar panel de edición
  }
}
