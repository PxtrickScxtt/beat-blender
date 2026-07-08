import { Component, inject, signal, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SpotifyYoutubeService, SearchResult } from '../../services/spotify-youtube';
import { MixerService } from '../../services/mixer';

@Component({
  selector: 'app-track-search',
  imports: [CommonModule],
  templateUrl: './track-search.html',
  styleUrl: './track-search.scss',
})
export class TrackSearch {
  private spotifyYoutube = inject(SpotifyYoutubeService);
  private mixer = inject(MixerService);

  // Emite evento cuando se añade una pista con éxito para cerrar la ventana modal
  public onTrackAdded = output<void>();

  // Estado reactivo
  public searchQuery = signal<string>('');
  public isLoading = signal<boolean>(false);
  public searchResults = signal<SearchResult[]>([]);
  public errorMessage = signal<string | null>(null);

  /**
   * Actualiza el valor del input de búsqueda
   */
  public onQueryInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.searchQuery.set(target.value);
  }

  /**
   * Ejecuta la búsqueda de pistas
   */
  public async performSearch(): Promise<void> {
    const query = this.searchQuery().trim();
    if (!query) return;

    this.isLoading.set(true);
    this.errorMessage.set(null);
    this.searchResults.set([]);

    try {
      const results = await this.spotifyYoutube.search(query);
      this.searchResults.set(results);
      if (results.length === 0) {
        this.errorMessage.set('No se encontraron canciones. Intenta buscar por título y artista o pega un enlace directo de YouTube o Spotify.');
      }
    } catch (e) {
      this.errorMessage.set('Hubo un problema al buscar la música. Intenta escribir el nombre de nuevo.');
      console.error('Error al realizar búsqueda:', e);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Maneja el evento de tecla "Enter" en la barra de búsqueda
   */
  public onKeyUp(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this.performSearch();
    }
  }

  /**
   * Agrega el track seleccionado a la cola del mezclador
   */
  public addTrack(result: SearchResult): void {
    this.mixer.addTrack({
      id: result.id,
      title: result.title,
      artist: result.artist,
      thumbnail: result.thumbnail,
      duration: result.duration,
      source: result.source
    });
    
    this.onTrackAdded.emit();
  }

  /**
   * Formatea segundos a MM:SS
   */
  public formatDuration(sec: number): string {
    if (!sec || isNaN(sec)) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
}
