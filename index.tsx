/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, Type } from '@google/genai';

// --- Types & Interfaces ---
interface TimedWord { word: string; start: number; end: number; }
interface TimedLine { text: string; start: number; end: number; }
interface AudioTake { id: string; url: string; timestamp: number; }
interface NoteSection { type: string; content: string; takes: AudioTake[]; }
interface Note {
  id: string;
  title: string;
  sections: NoteSection[];
  polishedNote: string;
  editorFormat: 'structured' | 'open';
  timestamp: number;
  syncedWords: TimedWord[] | null;
  syncedLines: TimedLine[] | null;
}

// --- Utilities ---
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function groupWordsIntoLines(words: TimedWord[]): TimedLine[] {
  if (!words || words.length === 0) return [];
  const lines: TimedLine[] = [];
  let current: TimedWord[] = [];
  words.forEach(w => {
    if (current.length && w.start - current[current.length - 1].end > 0.6) {
      lines.push({ text: current.map(x => x.word).join(' '), start: current[0].start, end: current[current.length - 1].end });
      current = [w];
    } else current.push(w);
  });
  if (current.length) lines.push({ text: current.map(x => x.word).join(' '), start: current[0].start, end: current[current.length - 1].end });
  return lines;
}

// --- AI Engine ---
const AI_MODEL = 'gemini-3-pro-preview';
class AIHelper {
  private ai: GoogleGenAI;
  constructor() { this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY }); }

  async processAudio(blob: Blob, mode: 'structure' | 'sync'): Promise<any> {
    const data = await blobToBase64(blob);
    const prompt = mode === 'structure' 
      ? `Transcribe and structure this songwriting memo into sections (Verse, Chorus, etc.). JSON array of {type, content}.`
      : `Transcribe this singing precisely. JSON array of {word, start, end}.`;

    const schema = mode === 'structure' ? {
      type: Type.ARRAY,
      items: { type: Type.OBJECT, properties: { type: { type: Type.STRING }, content: { type: Type.STRING } }, required: ["type", "content"] }
    } : {
      type: Type.ARRAY,
      items: { type: Type.OBJECT, properties: { word: { type: Type.STRING }, start: { type: Type.NUMBER }, end: { type: Type.NUMBER } }, required: ["word", "start", "end"] }
    };

    const res = await this.ai.models.generateContent({
      model: AI_MODEL,
      contents: [{ parts: [{ inlineData: { mimeType: blob.type, data } }, { text: prompt }] }],
      config: { responseMimeType: "application/json", responseSchema: schema }
    });
    return JSON.parse(res.text);
  }
}

// --- App Class ---
class VoiceNotesApp {
  private ai = new AIHelper();
  private notes = new Map<string, Note>();
  private currentNoteId: string | null = null;
  private isRecording = false;
  private isPaused = false;
  private isProcessing = false;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private startTime = 0;
  private totalPaused = 0;
  private pauseStart = 0;
  private timerInt: number | null = null;
  private waveformId: number | null = null;

  // Lyriq Logic Variables
  private beatVolume = 1.0;
  private vocalVolume = 1.0;
  private isScrubbing = false;
  private isVolumeDragging = false;
  private activeMixerTrack: 'beat' | 'vocal' | null = null;

  // UI elements
  private el: Record<string, HTMLElement> = {};

  constructor() {
    this.cacheElements();
    this.bindEvents();
    this.load();
    this.init();
  }

  private cacheElements() {
    [
     'appContainer', 'sidebar', 'sidebarBackdrop', 'editorTitle', 'lyricsContainer', 
     'lyriqAudio', 'lyriqVocalAudio', 'recordingInterface', 'liveRecordingTimerDisplay',
     'recordButton', 'recordButtonText', 'audioUpload', 
     // Lyriq Elements
     'lyriqControlsModal', 'lyriqModalHandle', 'lyriqModalPeekPlayBtn', 
     'lyriqExpandedPlayBtn', 'lyriqExpandedRecordBtn', 'lyriqExpandedVolumeBtn',
     'liveWaveformCanvas', 'lyriqPlayhead', 'lyriqModalTime', 'lyriqExpandedTime', 
     'lyriqTimelineContainer', 'lyriqWaveforms', 'beatWaveformCanvas', 'vocalWaveformCanvas',
     'lyriqVolumeMixer', 'beatVolumeSliderContainer', 'vocalVolumeSliderContainer',
     'beatVolumeFill', 'vocalVolumeFill', 'beatVolumePercentage', 'vocalVolumePercentage'
    ].forEach(id => {
      this.el[id] = document.getElementById(id)!;
    });
  }

  private bindEvents() {
    document.getElementById('sidebarToggleButton')?.addEventListener('click', () => this.toggleSidebar(true));
    document.getElementById('sidebarCloseButton')?.addEventListener('click', () => this.toggleSidebar(false));
    this.el.sidebarBackdrop.addEventListener('click', () => this.toggleSidebar(false));
    
    this.el.recordButton.addEventListener('click', () => this.handleRecordClick());
    document.getElementById('finishRecordingButton')?.addEventListener('click', () => this.stopRecording());
    
    document.getElementById('viewToggleButton')?.addEventListener('click', () => this.toggleView());
    document.getElementById('lyriqViewToggleButton')?.addEventListener('click', () => this.toggleView());

    this.el.audioUpload.addEventListener('change', (e) => this.handleUpload(e));
    document.getElementById('lyriqInitialAddBeatBtn')?.addEventListener('click', () => (this.el.audioUpload as HTMLInputElement).click());
    document.getElementById('lyriqInitialRecordBtn')?.addEventListener('click', () => this.startLyriqRecording());
    
    // Lyriq Modal Interaction
    this.el.lyriqModalHandle.addEventListener('click', () => {
      const isVisible = this.el.lyriqControlsModal.classList.contains('visible');
      this.setLyriqModalState(isVisible ? 'peeking' : 'visible');
    });

    this.el.lyriqModalPeekPlayBtn.addEventListener('click', () => this.togglePlayback());
    this.el.lyriqExpandedPlayBtn.addEventListener('click', () => this.togglePlayback());
    this.el.lyriqExpandedRecordBtn.addEventListener('click', () => this.startLyriqRecording());
    
    this.el.lyriqExpandedVolumeBtn.addEventListener('click', () => this.toggleVolumeView());

    // Scrubbing
    this.el.lyriqTimelineContainer.addEventListener('mousedown', (e) => this.handleScrubStart(e));
    document.addEventListener('mousemove', (e) => this.handleScrubMove(e));
    document.addEventListener('mouseup', () => this.handleScrubEnd());

    // Volume Mixer
    this.el.beatVolumeSliderContainer.addEventListener('mousedown', (e) => this.handleVolumeDragStart(e, 'beat'));
    this.el.vocalVolumeSliderContainer.addEventListener('mousedown', (e) => this.handleVolumeDragStart(e, 'vocal'));
    document.addEventListener('mousemove', (e) => this.handleVolumeDragMove(e));
    document.addEventListener('mouseup', () => this.handleVolumeDragEnd());
  }

  private async init() {
    if (this.notes.size === 0) {
      const note: Note = { id: `n_${Date.now()}`, title: 'New Song', sections: [], polishedNote: '', editorFormat: 'open', timestamp: Date.now(), syncedWords: null, syncedLines: null };
      this.notes.set(note.id, note);
      this.setActiveNote(note.id);
    } else {
      const first = Array.from(this.notes.values()).sort((a,b) => b.timestamp - a.timestamp)[0];
      this.setActiveNote(first.id);
    }
  }

  private toggleSidebar(show: boolean) {
    this.el.appContainer.classList.toggle('sidebar-collapsed', !show);
  }

  private toggleView() {
    const isLyriq = this.el.appContainer.classList.toggle('lyriq-player-active');
    if (isLyriq) this.renderLyriq();
  }

  private setActiveNote(id: string) {
    this.currentNoteId = id;
    const note = this.notes.get(id)!;
    this.el.editorTitle.textContent = note.title;
    this.renderRecent();
  }

  private renderLyriq() {
    const note = this.notes.get(this.currentNoteId!)!;
    document.getElementById('lyriqSongTitle')!.textContent = note.title;
    document.getElementById('lyriqModalPeekTitle')!.textContent = note.title;
    this.el.lyricsContainer.innerHTML = '';
    
    const lines = note.syncedLines || note.polishedNote.split('\n').filter(l => l.trim()).map(l => ({ text: l, start: 0, end: 0 }));
    lines.forEach(l => {
      const p = document.createElement('p');
      p.className = 'lyriq-line';
      p.textContent = (l as any).text;
      this.el.lyricsContainer.appendChild(p);
    });

    const hasBeat = !!(this.el.lyriqAudio as HTMLAudioElement).src;
    document.querySelector('.lyriq-player-view')!.classList.toggle('empty-state', !hasBeat);
    
    if (hasBeat) {
        this.setLyriqModalState('peeking');
        this.el.lyriqControlsModal.classList.add('has-beat');
        this.renderBeatWaveform();
        this.renderVocalWaveform();
    } else {
        this.setLyriqModalState('hidden');
        this.el.lyriqControlsModal.classList.remove('has-beat');
    }
  }

  private setLyriqModalState(state: 'hidden' | 'peeking' | 'visible') {
    const modal = this.el.lyriqControlsModal;
    modal.classList.remove('hidden', 'peeking', 'visible');
    modal.classList.add(state);
    
    // Reset volume view when closing
    if (state !== 'visible') {
        modal.classList.remove('volume-view-active');
    }
  }

  private handleUpload(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      (this.el.lyriqAudio as HTMLAudioElement).src = URL.createObjectURL(file);
      this.renderLyriq();
    }
  }

  private async handleRecordClick() {
    if (this.isRecording) {
      if (this.isPaused) { this.isPaused = false; this.mediaRecorder?.resume(); this.totalPaused += (Date.now() - this.pauseStart); }
      else { this.isPaused = true; this.mediaRecorder?.pause(); this.pauseStart = Date.now(); }
    } else await this.startRecording();
    this.updateUI();
  }

  private async startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(stream);
      this.audioChunks = [];
      this.mediaRecorder.ondataavailable = (e) => this.audioChunks.push(e.data);
      this.mediaRecorder.onstop = () => this.onStop();
      this.mediaRecorder.start();
      
      this.isRecording = true;
      this.isPaused = false;
      this.startTime = Date.now();
      this.totalPaused = 0;
      this.el.recordingInterface.classList.add('visible');
      this.startWaveform(stream);
      this.startTimer();
      this.updateUI();
    } catch (e) { console.error(e); }
  }

  private startLyriqRecording() {
    const audio = this.el.lyriqAudio as HTMLAudioElement;
    if (audio.src) { audio.currentTime = 0; audio.play(); }
    this.startRecording();
  }

  private stopRecording() {
    this.mediaRecorder?.stop();
    (this.el.lyriqAudio as HTMLAudioElement).pause();
    this.isRecording = false;
    this.el.recordingInterface.classList.remove('visible');
    this.stopTimer();
    if (this.waveformId) cancelAnimationFrame(this.waveformId);
  }

  private async onStop() {
    this.isProcessing = true;
    this.updateUI();
    const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
    try {
      const mode = this.el.appContainer.classList.contains('lyriq-player-active') ? 'sync' : 'structure';
      const result = await this.ai.processAudio(blob, mode);
      const note = this.notes.get(this.currentNoteId!)!;
      if (mode === 'sync') { note.syncedWords = result; note.syncedLines = groupWordsIntoLines(result); this.renderLyriq(); }
      else { note.sections = result; note.polishedNote = result.map((s:any) => s.content).join('\n'); }
      this.save();
    } catch (e) { console.error(e); }
    finally { this.isProcessing = false; this.updateUI(); }
  }

  private togglePlayback() {
    const b = this.el.lyriqAudio as HTMLAudioElement;
    const v = this.el.lyriqVocalAudio as HTMLAudioElement;
    if (b.paused) { 
        b.play(); 
        if (v.src) v.play(); 
        this.startTimer();
    } else { 
        b.pause(); 
        v.pause(); 
        this.stopTimer();
    }
    const icon = b.paused ? 'fas fa-play' : 'fas fa-pause';
    this.el.lyriqModalPeekPlayBtn.querySelector('i')!.className = icon;
    this.el.lyriqExpandedPlayBtn.querySelector('i')!.className = icon;
  }

  private stopTimer() {
    if (this.timerInt) {
        clearInterval(this.timerInt);
        this.timerInt = null;
    }
  }

  private startTimer() {
    this.stopTimer();
    this.timerInt = window.setInterval(() => {
      // Logic for Recording View
      if (this.isRecording && !this.isPaused) {
        const elapsed = Date.now() - this.startTime - this.totalPaused;
        const timeStr = new Date(elapsed).toISOString().substr(14, 5);
        this.el.liveRecordingTimerDisplay.textContent = timeStr + "." + Math.floor((elapsed % 1000) / 10).toString().padStart(2, '0');
      }
      
      // Logic for Lyriq View
      if (this.el.appContainer.classList.contains('lyriq-player-active')) {
          const audio = this.el.lyriqAudio as HTMLAudioElement;
          if (!audio.paused || this.isScrubbing) {
              const seconds = audio.currentTime;
              const timeStr = new Date(seconds * 1000).toISOString().substr(14, 5);
              this.el.lyriqModalTime.textContent = `${timeStr} / ${new Date((audio.duration || 0) * 1000).toISOString().substr(14, 5)}`;
              this.el.lyriqExpandedTime.textContent = timeStr;
              
              if (!this.isScrubbing) {
                this.syncLyrics(seconds);
                this.updatePlayheadVisuals(seconds);
              }
          }
      }
    }, 16); // 60fps
  }

  private updatePlayheadVisuals(seconds: number) {
    const audio = this.el.lyriqAudio as HTMLAudioElement;
    const duration = audio.duration || 1; 
    const container = this.el.lyriqTimelineContainer;
    const width = container.clientWidth;
    
    // Fit to width: calculate position based on percentage
    const px = (seconds / duration) * width;
    
    this.el.lyriqPlayhead.style.transform = `translateX(${px}px)`;
  }

  private syncLyrics(time: number) {
    const note = this.notes.get(this.currentNoteId!)!;
    if (!note.syncedLines) return;
    const els = this.el.lyricsContainer.querySelectorAll('.lyriq-line');
    note.syncedLines.forEach((l, i) => {
      const e = els[i] as HTMLElement;
      if (!e) return;
      const active = time >= l.start && time <= l.end;
      e.classList.toggle('highlighted-line', active);
      e.classList.toggle('past-line', time > l.end);
      if (active) e.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  // --- Waveform Rendering ---
  private startWaveform(stream: MediaStream) {
    this.audioContext = new AudioContext();
    const source = this.audioContext.createMediaStreamSource(stream);
    this.analyser = this.audioContext.createAnalyser();
    source.connect(this.analyser);
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    const canvas = this.el.liveWaveformCanvas as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    
    const draw = () => {
      this.waveformId = requestAnimationFrame(draw);
      this.analyser!.getByteTimeDomainData(data);
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.lineWidth = 3; ctx.strokeStyle = '#82aaff'; ctx.lineCap = 'round'; ctx.beginPath();
      const sliceWidth = canvas.width / data.length; let x = 0;
      for (let i = 0; i < data.length; i++) {
        const v = data[i] / 128.0; const y = v * (canvas.height / 2);
        if (i === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
        x += sliceWidth;
      }
      ctx.stroke();
    };
    draw();
  }

  private renderBeatWaveform() {
      const audio = this.el.lyriqAudio as HTMLAudioElement;
      
      const render = () => {
          const canvas = this.el.beatWaveformCanvas as HTMLCanvasElement;
          const container = this.el.lyriqTimelineContainer;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          
          const duration = audio.duration;
          if (!duration || !isFinite(duration)) return;

          // FIT TO SCREEN LOGIC: Use container width
          const width = container.clientWidth;
          
          // Force waveform container and canvas to match visible width
          this.el.lyriqWaveforms.style.width = `${width}px`;
          canvas.width = width;
          canvas.height = 60; 
          
          ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.clearRect(0, 0, width, canvas.height);
          ctx.beginPath();
          
          // Draw dummy visual bars scaled to the full width
          const barCount = 100;
          const barWidth = width / barCount;
          for(let i = 0; i < barCount; i++) {
              const h = Math.random() * 40 + 5;
              const x = i * barWidth;
              ctx.fillRect(x, 30 - h/2, barWidth - 1, h);
          }
          ctx.fill();
      };

      if (audio.readyState >= 1) {
          render();
      } else {
          audio.onloadedmetadata = () => render();
      }
  }

  private renderVocalWaveform() {
       // Placeholder
       const canvas = this.el.vocalWaveformCanvas as HTMLCanvasElement;
       const ctx = canvas.getContext('2d');
       if (!ctx) return;
       ctx.clearRect(0,0, canvas.width, canvas.height);
  }

  // --- Interaction Logic ---

  private handleScrubStart(e: MouseEvent) {
      this.isScrubbing = true;
      this.handleScrubMove(e);
  }

  private handleScrubMove(e: MouseEvent) {
      if (!this.isScrubbing) return;
      const container = this.el.lyriqTimelineContainer;
      const rect = container.getBoundingClientRect();
      const offsetX = e.clientX - rect.left; // No scrollX needed for fit-to-screen
      
      const width = rect.width;
      const clampedX = Math.max(0, Math.min(offsetX, width));
      
      const audio = this.el.lyriqAudio as HTMLAudioElement;
      const duration = audio.duration || 0;
      
      // Calculate time based on percentage of width
      const time = (clampedX / width) * duration;
      
      this.updatePlayheadVisuals(time);
      
      const timeStr = new Date(time * 1000).toISOString().substr(14, 5);
      this.el.lyriqExpandedTime.textContent = timeStr;
  }

  private handleScrubEnd() {
      if (!this.isScrubbing) return;
      this.isScrubbing = false;
      
      const transform = this.el.lyriqPlayhead.style.transform;
      const match = transform.match(/translateX\(([\d.]+)px\)/);
      if (match) {
          const px = parseFloat(match[1]);
          const container = this.el.lyriqTimelineContainer;
          const width = container.clientWidth;
          const audio = this.el.lyriqAudio as HTMLAudioElement;
          const duration = audio.duration || 0;
          
          if (width > 0) {
            const time = (px / width) * duration;
            if (isFinite(time)) {
                audio.currentTime = time;
                (this.el.lyriqVocalAudio as HTMLAudioElement).currentTime = time;
            }
          }
      }
  }

  private toggleVolumeView() {
      this.el.lyriqControlsModal.classList.toggle('volume-view-active');
  }

  private handleVolumeDragStart(e: MouseEvent, track: 'beat' | 'vocal') {
      this.isVolumeDragging = true;
      this.activeMixerTrack = track;
      this.handleVolumeDragMove(e);
  }

  private handleVolumeDragMove(e: MouseEvent) {
      if (!this.isVolumeDragging || !this.activeMixerTrack) return;
      
      const container = this.activeMixerTrack === 'beat' 
        ? this.el.beatVolumeSliderContainer 
        : this.el.vocalVolumeSliderContainer;
        
      const rect = container.getBoundingClientRect();
      // Calculate percentage from bottom
      const y = Math.max(0, Math.min(1, (rect.bottom - e.clientY) / rect.height));
      
      this.setVolume(this.activeMixerTrack, y);
  }

  private handleVolumeDragEnd() {
      this.isVolumeDragging = false;
      this.activeMixerTrack = null;
  }

  private setVolume(track: 'beat' | 'vocal', level: number) {
      const percentage = Math.round(level * 100);
      
      if (track === 'beat') {
          this.beatVolume = level;
          this.el.beatVolumeFill.style.height = `${percentage}%`;
          this.el.beatVolumePercentage.textContent = `${percentage}%`;
          (this.el.lyriqAudio as HTMLAudioElement).volume = level;
      } else {
          this.vocalVolume = level;
          this.el.vocalVolumeFill.style.height = `${percentage}%`;
          this.el.vocalVolumePercentage.textContent = `${percentage}%`;
          (this.el.lyriqVocalAudio as HTMLAudioElement).volume = level;
      }
  }

  private updateUI() {
    this.el.recordButton.classList.toggle('recording', this.isRecording && !this.isPaused);
    this.el.recordButton.classList.toggle('paused', this.isPaused);
    this.el.recordButtonText.textContent = this.isProcessing ? '...' : '';
    this.el.lyriqExpandedRecordBtn.classList.toggle('recording', this.isRecording);
  }

  private renderRecent() {
    const list = document.getElementById('recentNotesList')!; list.innerHTML = '';
    Array.from(this.notes.values()).sort((a,b) => b.timestamp - a.timestamp).forEach(n => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = `sidebar-note-item ${n.id === this.currentNoteId ? 'active' : ''}`;
      btn.textContent = n.title;
      btn.onclick = () => { this.setActiveNote(n.id); if (this.el.appContainer.classList.contains('lyriq-player-active')) this.renderLyriq(); };
      li.appendChild(btn); list.appendChild(li);
    });
  }

  private save() { localStorage.setItem('lyriq_db', JSON.stringify(Array.from(this.notes.entries()))); }
  private load() { const d = localStorage.getItem('lyriq_db'); if (d) this.notes = new Map(JSON.parse(d)); }
}

document.addEventListener('DOMContentLoaded', () => new VoiceNotesApp());