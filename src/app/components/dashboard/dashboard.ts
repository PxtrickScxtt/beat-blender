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

  private loadAdInIframe(containerId: string, key: string, width: number, height: number): void {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Crear iframe
    const iframe = document.createElement('iframe');
    iframe.style.width = `${width}px`;
    iframe.style.height = `${height}px`;
    iframe.style.border = 'none';
    iframe.style.overflow = 'hidden';
    iframe.setAttribute('scrolling', 'no');
    
    container.innerHTML = ''; // Limpiar contenedor
    container.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            html, body { margin: 0; padding: 0; overflow: hidden; width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; }
          </style>
        </head>
        <body>
          <script type="text/javascript">
            window.atOptions = {
              'key' : '${key}',
              'format' : 'iframe',
              'height' : ${height},
              'width' : ${width},
              'params' : {}
            };
          </script>
          <script type="text/javascript" src="https://www.highperformanceformat.com/${key}/invoke.js"></script>
        </body>
        </html>
      `);
      doc.close();
    }
  }

  ngAfterViewInit(): void {
    // Inicializar los reproductores IFrame de YouTube con las IDs de los contenedores
    this.mixer.initPlayers('yt-player-a', 'yt-player-b').then(() => {
      console.log('Reproductores de YouTube inicializados con éxito');
      // Cargar cola guardada de LocalStorage
      this.mixer.loadQueueFromLocalStorage();
    });

    // Cargar anuncios en iframes aislados para evitar colisiones del global window.atOptions
    setTimeout(() => this.loadAdInIframe('adsterra-160-600', '3a25a23666a8ab082a9008ac3cde70b2', 160, 600), 200);
    setTimeout(() => this.loadAdInIframe('adsterra-160-300', '6a052c49293c9bf18ba26cfe0c5f51c8', 160, 300), 400);
    setTimeout(() => this.loadAdInIframe('adsterra-728-90', '5f028d9dd838a0b3fafdcca3fc9475bb', 728, 90), 600);
    setTimeout(() => this.loadAdInIframe('adsterra-468-60', 'ceebb9f9fe88a8b5306516ff05055fc1', 468, 60), 800);
    setTimeout(() => this.loadAdInIframe('adsterra-320-50', '0a9d3fddb865b80d0c700316f014bdee', 320, 50), 1000);
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
