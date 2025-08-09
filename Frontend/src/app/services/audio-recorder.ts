import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AudioRecorderService {
  private mediaRecorder?: MediaRecorder;
  private chunks: BlobPart[] = [];
  private startedAt = 0;

  get isRecording(): boolean {
    return !!this.mediaRecorder && this.mediaRecorder.state === 'recording';
  }

  async start(): Promise<void> {
    if (this.isRecording) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    const mime = this.pickMimeType();
    this.mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
    this.mediaRecorder.ondataavailable = (e) => this.chunks.push(e.data);
    this.mediaRecorder.start(100); // small chunks for smoothness
    this.startedAt = Date.now();
  }

  stop(): Promise<{ blob: Blob; durationMs: number; mime: string }> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) return reject(new Error('Not recording'));
      const rec = this.mediaRecorder;
      rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: rec.mimeType });
        const durationMs = Date.now() - this.startedAt;
        (rec.stream.getTracks() || []).forEach((t) => t.stop());
        this.mediaRecorder = undefined;
        this.chunks = [];
        resolve({ blob, durationMs, mime: rec.mimeType });
      };
      try { rec.stop(); } catch (e) { reject(e); }
    });
  }

  cancel(): void {
    if (!this.mediaRecorder) return;
    (this.mediaRecorder.stream.getTracks() || []).forEach((t) => t.stop());
    this.mediaRecorder = undefined;
    this.chunks = [];
  }

  private pickMimeType(): string {
    if ((window as any).MediaRecorder?.isTypeSupported?.('audio/webm')) return 'audio/webm';
    if ((window as any).MediaRecorder?.isTypeSupported?.('audio/ogg'))  return 'audio/ogg';
    if ((window as any).MediaRecorder?.isTypeSupported?.('audio/mpeg')) return 'audio/mpeg';
    return 'audio/webm';
  }
}
