import { Injectable, signal } from '@angular/core';
// @ts-ignore
import * as lamejsModule from '@breezystack/lamejs';

// Resolver la exportación CommonJS de lamejs
const lamejs = (lamejsModule as any).default || lamejsModule;

// Solucionar de forma definitiva los problemas de namespaces y variables globales de lamejs
if (typeof window !== 'undefined') {
  // Expone las clases del módulo lamejs en el objeto global window usando el objeto resuelto 'lamejs'
  (window as any).Lame = lamejs.Lame || (window as any).Lame || {};
  (window as any).MPEGMode = lamejs.MPEGMode || (window as any).MPEGMode || {};
  (window as any).BitStream = lamejs.BitStream || (window as any).BitStream || {};
  (window as any).Mp3Encoder = lamejs.Mp3Encoder || (window as any).Mp3Encoder || {};
}

@Injectable({
  providedIn: 'root',
})
export class AudioRecorderService {
  public isRecording = signal<boolean>(false);
  public recordingDuration = signal<number>(0);
  public isProcessing = signal<boolean>(false);
  public processingProgress = signal<number>(0);

  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private durationInterval: any = null;
  private startTime = 0;

  /**
   * Inicia la captura del audio del navegador en vivo
   */
  public async startRecording(): Promise<void> {
    try {
      // Capturar la pantalla/pestaña actual con audio
      // Chrome requiere video: true para poder habilitar la casilla de compartir audio de la pestaña
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 10 },
          height: { ideal: 10 },
          frameRate: { ideal: 1 }
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      } as any);

      const audioTracks = displayStream.getAudioTracks();
      if (audioTracks.length === 0) {
        // Detener pistas de video abiertas antes de lanzar error
        displayStream.getTracks().forEach(t => t.stop());
        throw new Error(
          'No se detectó audio del sistema. Asegúrate de marcar la casilla "Compartir audio de la pestaña" al seleccionar la pantalla.'
        );
      }

      this.mediaStream = displayStream;
      this.audioChunks = [];
      
      // Detener visualización de video de la pestaña capturada para ahorrar recursos
      // Manteniendo el stream vivo y capturando solo el audio track
      const audioStream = new MediaStream([audioTracks[0]]);

      // Detectar si el usuario detiene la compartición de pantalla desde el banner flotante de Chrome
      displayStream.getVideoTracks()[0].onended = () => {
        if (this.isRecording()) {
          this.stopRecording();
        }
      };

      // Crear MediaRecorder
      // Usar audio/webm como contenedor por defecto de Chrome
      this.mediaRecorder = new MediaRecorder(audioStream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.start(1000); // Guardar chunk cada segundo
      this.isRecording.set(true);
      this.startTime = Date.now();
      this.recordingDuration.set(0);

      // Iniciar contador
      this.durationInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
        this.recordingDuration.set(elapsed);
      }, 1000);

    } catch (e) {
      console.error('Error al iniciar la grabación:', e);
      throw e;
    }
  }

  /**
   * Detiene la grabación y devuelve el blob de audio nativo WebM
   */
  public stopRecording(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || !this.isRecording()) {
        resolve(null);
        return;
      }

      if (this.durationInterval) {
        clearInterval(this.durationInterval);
        this.durationInterval = null;
      }

      this.mediaRecorder.onstop = () => {
        const webmBlob = new Blob(this.audioChunks, { type: 'audio/webm;codecs=opus' });
        
        // Detener todas las pistas de captura abiertas
        if (this.mediaStream) {
          this.mediaStream.getTracks().forEach(track => track.stop());
          this.mediaStream = null;
        }

        this.mediaRecorder = null;
        this.isRecording.set(false);
        resolve(webmBlob);
      };

      this.mediaRecorder.stop();
    });
  }

  /**
   * Decodifica el WebM grabado y lo exporta al formato deseado (MP3, WAV o WebM)
   */
  public async convertToFormat(webmBlob: Blob, format: 'webm' | 'wav' | 'mp3'): Promise<Blob> {
    if (format === 'webm') {
      return webmBlob;
    }

    this.isProcessing.set(true);
    this.processingProgress.set(5);

    try {
      // 1. Convertir Blob a ArrayBuffer
      const arrayBuffer = await webmBlob.arrayBuffer();
      this.processingProgress.set(20);

      // 2. Decodificar audio de forma offline con AudioContext
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      this.processingProgress.set(50);

      let resultBlob: Blob;

      if (format === 'wav') {
        resultBlob = this.bufferToWav(audioBuffer);
      } else {
        resultBlob = this.bufferToMp3(audioBuffer);
      }

      this.processingProgress.set(100);
      return resultBlob;

    } catch (e) {
      console.error(`Error al convertir a ${format}:`, e);
      throw new Error(`Error en la transcodificación de audio: ${e instanceof Error ? e.message : 'Error desconocido'}`);
    } finally {
      this.isProcessing.set(false);
    }
  }

  /**
   * Codifica un AudioBuffer a WAV (PCM de 16 bits sin pérdidas)
   */
  public bufferToWav(buffer: AudioBuffer): Blob {
    const numOfChan = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // 1 = PCM raw
    const bitDepth = 16;
    
    const resultLength = buffer.length * numOfChan * 2 + 44; // 44 bytes de cabecera
    const bufferArr = new ArrayBuffer(resultLength);
    const view = new DataView(bufferArr);
    
    let pos = 0;

    // Escribir cabecera WAV RIFF
    writeString('RIFF'); pos += 4;
    view.setUint32(pos, resultLength - 8, true); pos += 4;
    writeString('WAVE'); pos += 4;
    
    // Chunk "fmt "
    writeString('fmt '); pos += 4;
    view.setUint32(pos, 16, true); pos += 4;
    view.setUint16(pos, format, true); pos += 2;
    view.setUint16(pos, numOfChan, true); pos += 2;
    view.setUint32(pos, sampleRate, true); pos += 4;
    view.setUint32(pos, sampleRate * numOfChan * (bitDepth / 8), true); pos += 4;
    view.setUint16(pos, numOfChan * (bitDepth / 8), true); pos += 2;
    view.setUint16(pos, bitDepth, true); pos += 2;

    // Chunk "data"
    writeString('data'); pos += 4;
    view.setUint32(pos, resultLength - pos - 4, true); pos += 4;

    // Intercalar y normalizar canales de Float32 a Int16
    const channels = [];
    for (let i = 0; i < numOfChan; i++) {
      channels.push(buffer.getChannelData(i));
    }

    const len = buffer.length;
    for (let offset = 0; offset < len; offset++) {
      for (let c = 0; c < numOfChan; c++) {
        let sample = channels[c][offset];
        // Clip
        sample = Math.max(-1, Math.min(1, sample));
        // Escalar a entero de 16 bits
        const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(pos, intSample, true);
        pos += 2;
      }
    }

    return new Blob([bufferArr], { type: 'audio/wav' });

    function writeString(str: string) {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(pos + i, str.charCodeAt(i));
      }
    }
  }

  /**
   * Codifica un AudioBuffer a MP3 usando lamejs
   */
  public bufferToMp3(buffer: AudioBuffer): Blob {
    const channels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    
    // lamejs requiere la clase Mp3Encoder
    const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, 128); // 128kbps constante
    const mp3Data: any[] = [];
    
    const sampleBlockSize = 1152; // tamaño óptimo para lame
    
    const leftData = buffer.getChannelData(0);
    const rightData = channels > 1 ? buffer.getChannelData(1) : null;
    
    // ConvertirFloat32Array a Int16Array
    const convertFloat32ToInt16 = (f32: Float32Array) => {
      const int16 = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i++) {
        const s = Math.max(-1, Math.min(1, f32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      return int16;
    };

    const leftInt16 = convertFloat32ToInt16(leftData);
    const rightInt16 = rightData ? convertFloat32ToInt16(rightData) : null;

    const len = leftInt16.length;
    for (let i = 0; i < len; i += sampleBlockSize) {
      const leftBlock = leftInt16.subarray(i, i + sampleBlockSize);
      let mp3buf;
      
      if (rightInt16) {
        const rightBlock = rightInt16.subarray(i, i + sampleBlockSize);
        mp3buf = mp3encoder.encodeBuffer(leftBlock, rightBlock);
      } else {
        mp3buf = mp3encoder.encodeBuffer(leftBlock);
      }

      if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
      }

      // Actualizar progreso
      const progress = 50 + Math.round((i / len) * 45);
      this.processingProgress.set(progress);
    }

    const mp3buf = mp3encoder.flush();
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }

    return new Blob(mp3Data, { type: 'audio/mp3' });
  }
}
