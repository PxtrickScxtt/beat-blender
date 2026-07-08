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

    // 1. Cargar Adsterra Banner 160x600 (Izquierdo)
    setTimeout(() => {
      const container = document.getElementById('adsterra-160-600');
      if (container) {
        (window as any).atOptions = {
          'key' : '3a25a23666a8ab082a9008ac3cde70b2',
          'format' : 'iframe',
          'height' : 600,
          'width' : 160,
          'params' : {}
        };
        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.src = 'https://www.highperformanceformat.com/3a25a23666a8ab082a9008ac3cde70b2/invoke.js';
        container.appendChild(script);
      }
    }, 400);

    // 2. Cargar Adsterra Banner 160x300 (Derecho)
    setTimeout(() => {
      const container = document.getElementById('adsterra-160-300');
      if (container) {
        (window as any).atOptions = {
          'key' : '6a052c49293c9bf18ba26cfe0c5f51c8',
          'format' : 'iframe',
          'height' : 300,
          'width' : 160,
          'params' : {}
        };
        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.src = 'https://www.highperformanceformat.com/6a052c49293c9bf18ba26cfe0c5f51c8/invoke.js';
        container.appendChild(script);
      }
    }, 800);

    // 3. Cargar Adsterra Banner 728x90 (Desktop Horizontal)
    setTimeout(() => {
      const container = document.getElementById('adsterra-728-90');
      if (container) {
        (window as any).atOptions = {
          'key' : '5f028d9dd838a0b3fafdcca3fc9475bb',
          'format' : 'iframe',
          'height' : 90,
          'width' : 728,
          'params' : {}
        };
        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.src = 'https://www.highperformanceformat.com/5f028d9dd838a0b3fafdcca3fc9475bb/invoke.js';
        container.appendChild(script);
      }
    }, 1200);

    // 4. Cargar Adsterra Banner 468x60 (Tablet Horizontal)
    setTimeout(() => {
      const container = document.getElementById('adsterra-468-60');
      if (container) {
        (window as any).atOptions = {
          'key' : 'ceebb9f9fe88a8b5306516ff05055fc1',
          'format' : 'iframe',
          'height' : 60,
          'width' : 468,
          'params' : {}
        };
        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.src = 'https://www.highperformanceformat.com/ceebb9f9fe88a8b5306516ff05055fc1/invoke.js';
        container.appendChild(script);
      }
    }, 1600);

    // 5. Cargar Adsterra Banner 320x50 (Mobile Horizontal)
    setTimeout(() => {
      const container = document.getElementById('adsterra-320-50');
      if (container) {
        (window as any).atOptions = {
          'key' : '0a9d3fddb865b80d0c700316f014bdee',
          'format' : 'iframe',
          'height' : 50,
          'width' : 320,
          'params' : {}
        };
        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.src = 'https://www.highperformanceformat.com/0a9d3fddb865b80d0c700316f014bdee/invoke.js';
        container.appendChild(script);
      }
    }, 2000);
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
