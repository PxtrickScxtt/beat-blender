import { Component, AfterViewInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MixerService } from '../../services/mixer';
import { MixDeck } from '../mix-deck/mix-deck';
import { TrackQueue } from '../track-queue/track-queue';
import { TrackSearch } from '../track-search/track-search';

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, MixDeck, TrackQueue, TrackSearch],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard implements AfterViewInit {
  public mixer = inject(MixerService);
  
  // Control de visibilidad del panel de pantallas VJ (Videos)
  public showVideoMonitor = signal<boolean>(true);
  
  // Control de visibilidad del buscador modal
  public showSearchModal = signal<boolean>(false);

  ngAfterViewInit(): void {
    // Inicializar los reproductores IFrame de YouTube con las IDs de los contenedores
    this.mixer.initPlayers('yt-player-a', 'yt-player-b').then(() => {
      console.log('Reproductores de YouTube inicializados con éxito');
      // Cargar cola guardada de LocalStorage
      this.mixer.loadQueueFromLocalStorage();
    });
  }

  public toggleVideoMonitor(): void {
    this.showVideoMonitor.update(v => !v);
  }

  public openSearchModal(): void {
    this.showSearchModal.set(true);
  }

  public closeSearchModal(): void {
    this.showSearchModal.set(false);
  }
}
