
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/* tslint:disable */

import {GoogleGenAI, Type} from '@google/genai';
import {marked} from 'marked';

const MODEL_NAME = 'gemini-2.5-flash';

// Interfaces for data structures
interface Note {
  id: string;
  title: string;
  rawTranscription: string;
  polishedNote: string;
  timestamp: number;
  projectId: string | null;
}

interface Project {
  id: string;
  name: string;
}

type AppView = 'editor' | 'list' | 'lyriq';

class VoiceNotesApp {
  // AI and Media Recording properties
  private genAI: GoogleGenAI;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private isRecording = false;
  private stream: MediaStream | null = null;
  private hasAttemptedPermission = false;

  // Live recording UI properties
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private waveformDataArray: Uint8Array | null = null;
  private waveformDrawingId: number | null = null;
  private timerIntervalId: number | null = null;
  private recordingStartTime: number = 0;

  // Data management properties
  private notes: Map<string, Note> = new Map();
  private projects: Map<string, Project> = new Map();
  private currentNoteId: string | null = null;
  private currentFilter: { type: 'all' | 'project'; id: string | null } = { type: 'all', id: null };
  private activeIdeaTab: string = 'songs';
  private activeView: AppView = 'editor';
  
  // DOM Elements
  private appContainer: HTMLDivElement;
  private recordButton: HTMLButtonElement;
  private recordingStatus: HTMLDivElement;
  private rawTranscription: HTMLDivElement;
  private polishedNote: HTMLDivElement;
  private newButton: HTMLButtonElement;
  private themeToggleButton: HTMLButtonElement;
  private themeToggleIcon: HTMLElement;
  private editorTitle: HTMLDivElement;
  private sidebarToggleButton: HTMLButtonElement;
  private sidebarNewNoteButton: HTMLButtonElement;
  private allNotesButton: HTMLAnchorElement;
  private projectsList: HTMLUListElement;
  private recentNotesList: HTMLUListElement;
  private contextMenu: HTMLDivElement;
  
  // Recording interface elements
  private recordingInterface: HTMLDivElement;
  private liveRecordingTitle: HTMLDivElement;
  private liveWaveformCanvas: HTMLCanvasElement;
  private liveWaveformCtx: CanvasRenderingContext2D | null;
  private liveRecordingTimerDisplay: HTMLDivElement;
  private statusIndicatorDiv: HTMLDivElement;
  
  // Notes List View elements
  private notesListView: HTMLDivElement;
  private notesListContent: HTMLDivElement;
  private ideasTabsContainer: HTMLDivElement;
  private listViewNewNoteFab: HTMLButtonElement;

  // Lyriq Player elements and state
  private lyriqPlayerView: HTMLDivElement;
  private lyriqPlayerButton: HTMLAnchorElement;
  private audioUploadInput: HTMLInputElement;
  private lyriqAudioPlayer: HTMLAudioElement;
  private lyriqPlayBtn: HTMLButtonElement;
  private lyriqPlayIcon: HTMLElement;
  private lyriqPrevBtn: HTMLButtonElement;
  private lyriqNextBtn: HTMLButtonElement;
  private lyriqRecordBtn: HTMLButtonElement;
  private lyriqShuffleBtn: HTMLButtonElement;
  private lyriqRepeatBtn: HTMLButtonElement;
  private lyricsContainer: HTMLDivElement;
  private songTitleEl: HTMLHeadingElement;
  private lyriqProgressBar: HTMLInputElement;
  private lyriqVolumeSlider: HTMLInputElement;
  private lyriqCurrentTime: HTMLSpanElement;
  private lyriqRemainingTime: HTMLSpanElement;

  private lyriqIsPlaying = false;
  private lyriqCurrentLineIndex = -1;
  private lyricsData: { time: number; line: string }[] = [];
  
  private isMobile: boolean = window.innerWidth <= 1024;
  
  // Long press properties
  private longPressTimer: number | null = null;
  private readonly LONG_PRESS_DURATION = 500; // 500ms for long press


  constructor() {
    // Initialize AI
    this.genAI = new GoogleGenAI({apiKey: process.env.API_KEY!});

    // Get all necessary DOM elements
    this.appContainer = document.getElementById('appContainer') as HTMLDivElement;
    this.recordButton = document.getElementById('recordButton') as HTMLButtonElement;
    this.recordingStatus = document.getElementById('recordingStatus') as HTMLDivElement;
    this.rawTranscription = document.getElementById('rawTranscription') as HTMLDivElement;
    this.polishedNote = document.getElementById('polishedNote') as HTMLDivElement;
    this.newButton = document.getElementById('newButton') as HTMLButtonElement;
    this.themeToggleButton = document.getElementById('themeToggleButton') as HTMLButtonElement;
    this.themeToggleIcon = this.themeToggleButton.querySelector('i') as HTMLElement;
    this.editorTitle = document.querySelector('.editor-title') as HTMLDivElement;
    this.sidebarToggleButton = document.getElementById('sidebarToggleButton') as HTMLButtonElement;
    this.sidebarNewNoteButton = document.getElementById('sidebarNewNoteButton') as HTMLButtonElement;
    this.allNotesButton = document.getElementById('allNotesButton') as HTMLAnchorElement;
    this.projectsList = document.getElementById('projectsList') as HTMLUListElement;
    this.recentNotesList = document.getElementById('recentNotesList') as HTMLUListElement;
    this.contextMenu = document.getElementById('contextMenu') as HTMLDivElement;
    
    // Recording UI elements
    this.recordingInterface = document.querySelector('.recording-interface') as HTMLDivElement;
    this.liveRecordingTitle = document.getElementById('liveRecordingTitle') as HTMLDivElement;
    this.liveWaveformCanvas = document.getElementById('liveWaveformCanvas') as HTMLCanvasElement;
    this.liveRecordingTimerDisplay = document.getElementById('liveRecordingTimerDisplay') as HTMLDivElement;
    this.statusIndicatorDiv = this.recordingInterface.querySelector('.status-indicator') as HTMLDivElement;
    this.liveWaveformCtx = this.liveWaveformCanvas.getContext('2d');
    
    // Notes List View elements
    this.notesListView = document.querySelector('.notes-list-view') as HTMLDivElement;
    this.notesListContent = document.querySelector('.notes-list-content') as HTMLDivElement;
    this.ideasTabsContainer = document.querySelector('.ideas-tabs') as HTMLDivElement;
    this.listViewNewNoteFab = document.querySelector('.list-view-new-note-fab') as HTMLButtonElement;
    
    // Lyriq Player elements
    this.lyriqPlayerView = document.querySelector('.lyriq-player-view') as HTMLDivElement;
    this.lyriqPlayerButton = document.getElementById('lyriqPlayerButton') as HTMLAnchorElement;
    this.audioUploadInput = document.getElementById('audioUpload') as HTMLInputElement;
    this.lyriqAudioPlayer = document.getElementById('lyriqAudio') as HTMLAudioElement;
    this.lyriqPlayBtn = document.getElementById('playBtn') as HTMLButtonElement;
    this.lyriqPlayIcon = this.lyriqPlayBtn.querySelector('i') as HTMLElement;
    this.lyriqPrevBtn = document.getElementById('prevBtn') as HTMLButtonElement;
    this.lyriqNextBtn = document.getElementById('nextBtn') as HTMLButtonElement;
    this.lyriqRecordBtn = document.getElementById('recordBtn') as HTMLButtonElement;
    this.lyriqShuffleBtn = document.getElementById('shuffleBtn') as HTMLButtonElement;
    this.lyriqRepeatBtn = document.getElementById('repeatBtn') as HTMLButtonElement;
    this.lyricsContainer = document.getElementById('lyricsContainer') as HTMLDivElement;
    this.songTitleEl = document.querySelector('.lyriq-toolbar .lyriq-upload-btn') as HTMLHeadingElement; // Updated selector
    this.lyriqProgressBar = document.getElementById('progressBar') as HTMLInputElement;
    this.lyriqVolumeSlider = document.getElementById('volumeSlider') as HTMLInputElement;
    this.lyriqCurrentTime = document.getElementById('currentTime') as HTMLSpanElement;
    this.lyriqRemainingTime = document.getElementById('remainingTime') as HTMLSpanElement;

    // Initial setup
    this.bindEventListeners();
    this.initTheme();
    this.loadDataFromStorage();

    // Initialize app state
    (async () => {
      if (this.notes.size === 0) {
          await this.createNewNote();
      } else {
          const sortedNotes = [...this.notes.values()].sort((a, b) => b.timestamp - a.timestamp);
          this.setActiveNote(sortedNotes[0].id);
      }
      this.setActiveView('editor');
      this.renderSidebar();
      this.updatePlaceholderVisibility(this.polishedNote);
      this.updatePlaceholderVisibility(this.rawTranscription);
    })();
  }

  private bindEventListeners(): void {
    // Core controls
    this.recordButton.addEventListener('click', () => this.toggleRecording());
    this.newButton.addEventListener('click', () => this.createNewNote());
    this.themeToggleButton.addEventListener('click', () => this.toggleTheme());

    // Sidebar controls
    this.sidebarToggleButton.addEventListener('click', () => this.toggleSidebar());
    this.sidebarNewNoteButton.addEventListener('click', async () => {
        await this.createNewNote();
        this.setActiveView('editor');
    });
    this.allNotesButton.addEventListener('click', (e) => {
        e.preventDefault();
        this.setActiveView('list');
    });

    // Editor controls
    this.editorTitle.addEventListener('blur', () => this.updateCurrentNoteContent());
    this.polishedNote.addEventListener('blur', () => this.updateCurrentNoteContent());
    this.rawTranscription.addEventListener('blur', () => this.updateCurrentNoteContent());

    this.polishedNote.addEventListener('input', () => this.updatePlaceholderVisibility(this.polishedNote));
    this.rawTranscription.addEventListener('input', () => this.updatePlaceholderVisibility(this.rawTranscription));
    this.editorTitle.addEventListener('input', () => this.updatePlaceholderVisibility(this.editorTitle));
    
    // Notes list view controls
    this.ideasTabsContainer.addEventListener('click', (e) => this.handleIdeaTabClick(e as MouseEvent));
    this.listViewNewNoteFab.addEventListener('click', async () => {
        await this.createNewNote();
        this.setActiveView('editor');
    });

    // Lyriq Player controls
    this.lyriqPlayerButton.addEventListener('click', (e) => {
        e.preventDefault();
        this.setActiveView('lyriq');
    });
    this.audioUploadInput.addEventListener('change', (e) => this.handleLyriqFileUpload(e as Event));
    this.lyriqPlayBtn.addEventListener('click', () => this.toggleLyriqPlayback());
    this.lyriqPrevBtn.addEventListener('click', () => this.jumpToLyric('prev'));
    this.lyriqNextBtn.addEventListener('click', () => this.jumpToLyric('next'));
    this.lyriqRecordBtn.addEventListener('click', () => this.toggleRecording());
    this.lyriqProgressBar.addEventListener('input', (e) => this.handleLyriqProgressScrub(e));
    this.lyriqVolumeSlider.addEventListener('input', () => this.handleVolumeChange());
    this.lyriqShuffleBtn.addEventListener('click', (e) => (e.currentTarget as HTMLElement).classList.toggle('active'));
    this.lyriqRepeatBtn.addEventListener('click', (e) => (e.currentTarget as HTMLElement).classList.toggle('active'));

    this.lyriqAudioPlayer.addEventListener('loadedmetadata', () => this.handleLyriqMetadataLoaded());
    this.lyriqAudioPlayer.addEventListener('timeupdate', () => this.syncLyrics());
    this.lyriqAudioPlayer.addEventListener('ended', () => this.handleLyriqEnded());


    // Window and global listeners
    window.addEventListener('resize', () => { this.isMobile = window.innerWidth <= 1024; });
    document.addEventListener('click', () => this.hideContextMenu());
    
    // Context Menu Listeners (Desktop Right-Click + Mobile Long-Press)
    this.recentNotesList.addEventListener('contextmenu', (e) => this.showNoteContextMenu(e as MouseEvent));
    this.recentNotesList.addEventListener('touchstart', (e) => this.handleNoteTouchStart(e as TouchEvent), { passive: false });
    this.recentNotesList.addEventListener('touchend', () => this.handleNoteTouchEnd());
    this.recentNotesList.addEventListener('touchmove', () => this.handleNoteTouchEnd());
  }

  // --- View Management ---
  private setActiveView(view: AppView): void {
      this.activeView = view;

      // Pause audio if navigating away from player
      if (view !== 'lyriq' && this.lyriqIsPlaying) {
          this.toggleLyriqPlayback();
      }

      this.appContainer.classList.remove('list-view-active', 'lyriq-player-active');
      document.querySelectorAll('.sidebar-link, .sidebar-note-item').forEach(el => el.classList.remove('active'));

      switch (view) {
          case 'list':
              this.appContainer.classList.add('list-view-active');
              this.allNotesButton.classList.add('active');
              this.renderNotesList();
              break;
          case 'lyriq':
              this.appContainer.classList.add('lyriq-player-active');
              this.lyriqPlayerButton.classList.add('active');
              break;
          case 'editor':
              // Default state, no extra class needed
              document.querySelector(`.sidebar-note-item[data-note-id="${this.currentNoteId}"]`)?.classList.add('active');
              break;
      }
      
      if (this.isMobile) {
          this.appContainer.classList.add('sidebar-collapsed');
      }
  }

  // --- Theme Management ---
  private initTheme(): void {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    if (savedTheme === 'light') {
      document.body.classList.add('light-mode');
      this.themeToggleIcon.classList.replace('fa-sun', 'fa-moon');
    }
  }

  private toggleTheme(): void {
    document.body.classList.toggle('light-mode');
    const isLight = document.body.classList.contains('light-mode');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    this.themeToggleIcon.classList.replace(isLight ? 'fa-sun' : 'fa-moon', isLight ? 'fa-moon' : 'fa-sun');
  }

  // --- Sidebar Management ---
  private toggleSidebar(): void {
    this.appContainer.classList.toggle('sidebar-collapsed');
  }
  
  private renderSidebar(): void {
    // Render recent notes
    this.recentNotesList.innerHTML = '';
    const sortedNotes = [...this.notes.values()].sort((a,b) => b.timestamp - a.timestamp);
    sortedNotes.forEach(note => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.className = `sidebar-note-item ${note.id === this.currentNoteId && this.activeView === 'editor' ? 'active' : ''}`;
        button.textContent = note.title;
        button.dataset.noteId = note.id;
        button.addEventListener('click', () => {
            this.setActiveNote(note.id);
            this.setActiveView('editor');
        });
        li.appendChild(button);
        this.recentNotesList.appendChild(li);
    });

    // Render projects
    this.projectsList.innerHTML = '';
    const sortedProjects = [...this.projects.values()].sort((a, b) => a.name.localeCompare(b.name));
    sortedProjects.forEach(project => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.className = 'sidebar-link';
        button.dataset.projectId = project.id;
        button.innerHTML = `<i class="fas fa-folder"></i><span>${project.name}</span>`;
        // TODO: Add project filtering logic
        // button.addEventListener('click', () => this.filterByProject(project.id));
        li.appendChild(button);
        this.projectsList.appendChild(li);
    });

    // Update main nav active state
    this.allNotesButton.classList.toggle('active', this.activeView === 'list');
    this.lyriqPlayerButton.classList.toggle('active', this.activeView === 'lyriq');
  }

  // --- Data Persistence ---
  private loadDataFromStorage(): void {
    const notesData = localStorage.getItem('voiceNotes');
    if (notesData) {
        this.notes = new Map(JSON.parse(notesData));
    }
    const projectsData = localStorage.getItem('voiceProjects');
    if (projectsData) {
        this.projects = new Map(JSON.parse(projectsData));
    }
  }

  private saveDataToStorage(): void {
    localStorage.setItem('voiceNotes', JSON.stringify(Array.from(this.notes.entries())));
    localStorage.setItem('voiceProjects', JSON.stringify(Array.from(this.projects.entries())));
  }

  // --- Note Management ---
  private async createNewNote(): Promise<void> {
    const newNote: Note = {
      id: `note_${Date.now()}`,
      title: 'Untitled Note',
      rawTranscription: '',
      polishedNote: '',
      timestamp: Date.now(),
      projectId: null,
    };
    this.notes.set(newNote.id, newNote);
    this.setActiveNote(newNote.id);
    this.setActiveView('editor');
    this.saveDataToStorage();
    this.renderSidebar();
  }
  
  private setActiveNote(noteId: string | null): void {
      if (!noteId || !this.notes.has(noteId)) {
        this.currentNoteId = null;
        this.editorTitle.textContent = '';
        this.rawTranscription.innerHTML = '';
        this.polishedNote.innerHTML = '';
        return;
      }

      this.currentNoteId = noteId;
      const note = this.notes.get(noteId)!;

      this.editorTitle.textContent = note.title;
      this.rawTranscription.innerHTML = marked.parse(note.rawTranscription) as string;
      this.polishedNote.innerHTML = marked.parse(note.polishedNote) as string;

      this.updatePlaceholderVisibility(this.editorTitle);
      this.updatePlaceholderVisibility(this.rawTranscription);
      this.updatePlaceholderVisibility(this.polishedNote);
      this.renderSidebar();
  }
  
  private updateCurrentNoteContent(): void {
      if (!this.currentNoteId) return;
      const note = this.notes.get(this.currentNoteId);
      if (note) {
          const newTitle = this.editorTitle.textContent?.trim() || 'Untitled Note';
          note.title = newTitle;
          note.polishedNote = this.polishedNote.innerText; // Use innerText to get raw text
          note.rawTranscription = this.rawTranscription.innerText;
          note.timestamp = Date.now();
          this.saveDataToStorage();
          this.renderSidebar(); // Re-render to update titles and order
      }
  }

  private deleteNote(noteId: string): void {
    if (!this.notes.has(noteId)) return;
    
    this.notes.delete(noteId);

    if (this.currentNoteId === noteId) {
        const sortedNotes = [...this.notes.values()].sort((a,b) => b.timestamp - a.timestamp);
        if (sortedNotes.length > 0) {
            this.setActiveNote(sortedNotes[0].id);
        } else {
            this.createNewNote();
        }
    }
    
    this.saveDataToStorage();
    this.renderSidebar();
    if(this.appContainer.classList.contains('list-view-active')) {
      this.renderNotesList();
    }
  }

  private renameNote(noteId: string): void {
    const note = this.notes.get(noteId);
    if (!note) return;

    const newTitle = prompt("Enter new note title:", note.title);
    if (newTitle && newTitle.trim() !== '') {
        note.title = newTitle.trim();
        note.timestamp = Date.now(); // Bump timestamp to bring to top
        this.saveDataToStorage();
        this.renderSidebar();
        if (this.currentNoteId === noteId) {
            this.editorTitle.textContent = note.title;
        }
    }
  }

  private addNoteToProject(noteId: string, projectId: string): void {
      const note = this.notes.get(noteId);
      if (!note || !this.projects.has(projectId)) return;

      note.projectId = projectId;
      note.timestamp = Date.now();
      this.saveDataToStorage();
      this.renderSidebar();
  }
  
  private createNewProjectFromContext(noteId: string): void {
      const projectName = prompt("Enter new project name:");
      if (projectName && projectName.trim() !== '') {
          const newProject: Project = {
              id: `proj_${Date.now()}`,
              name: projectName.trim()
          };
          this.projects.set(newProject.id, newProject);
          this.addNoteToProject(noteId, newProject.id);
      }
  }

  private updatePlaceholderVisibility(element: HTMLElement): void {
    const placeholder = element.getAttribute('placeholder');
    if (!placeholder) return;
    if (element.textContent?.trim() === '') {
      element.classList.add('placeholder-active');
    } else {
      element.classList.remove('placeholder-active');
    }
  }

  // --- Recording Logic ---
  private async toggleRecording(): Promise<void> {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      await this.startRecording();
    }
  }

  private async startRecording(): Promise<void> {
    if (!this.hasAttemptedPermission) {
      this.hasAttemptedPermission = true;
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        console.error('Microphone access denied:', err);
        this.recordingStatus.textContent = 'Microphone access denied.';
        return;
      }
    }

    if (!this.stream) {
        this.recordingStatus.textContent = 'Could not start recording.';
        return;
    }

    this.isRecording = true;
    this.recordButton.classList.add('recording');
    this.lyriqRecordBtn.classList.add('recording');
    this.recordButton.title = 'Stop Recording';
    this.lyriqRecordBtn.title = 'Stop Recording';
    this.recordingInterface.classList.add('is-live');
    this.liveRecordingTitle.style.display = 'block';
    this.liveWaveformCanvas.style.display = 'block';
    this.liveRecordingTimerDisplay.style.display = 'block';
    
    this.audioChunks = [];
    this.mediaRecorder = new MediaRecorder(this.stream);
    this.mediaRecorder.ondataavailable = (event) => this.handleAudioData(event);
    this.mediaRecorder.onstop = () => this.processAudio();
    this.mediaRecorder.start();

    // Start live visualization
    this.startLiveVisualization();
  }

  private stopRecording(): void {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
      this.recordButton.classList.remove('recording');
      this.lyriqRecordBtn.classList.remove('recording');
      this.recordButton.title = 'Start Recording';
      this.lyriqRecordBtn.title = 'Start Recording';
      this.recordingInterface.classList.remove('is-live');
      this.liveRecordingTitle.style.display = 'none';
      this.liveWaveformCanvas.style.display = 'none';
      this.liveRecordingTimerDisplay.style.display = 'none';
      
      // Stop live visualization
      this.stopLiveVisualization();
      this.stream?.getTracks().forEach((track) => track.stop());
      this.stream = null;
      this.hasAttemptedPermission = false;
    }
  }

  private handleAudioData(event: BlobEvent): void {
    if (event.data.size > 0) {
      this.audioChunks.push(event.data);
    }
  }

  private async processAudio(): Promise<void> {
    if (this.audioChunks.length === 0) {
        this.recordingStatus.textContent = "No audio recorded.";
        return;
    }

    this.recordingStatus.textContent = 'Processing...';
    const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
    const reader = new FileReader();
    reader.readAsDataURL(audioBlob);
    reader.onloadend = async () => {
        const base64Audio = (reader.result as string).split(',')[1];
        
        try {
            this.recordingStatus.textContent = 'Transcribing...';
            const audioPart = { inlineData: { mimeType: 'audio/webm', data: base64Audio } };
            const prompt = `Transcribe the following audio recording. The transcription should be as accurate as possible, preserving the speaker's original words and phrasing.`;
            
            const response = await this.genAI.models.generateContent({
              model: MODEL_NAME,
              contents: { parts: [audioPart, { text: prompt }] },
            });
            const transcription = response.text;
            this.rawTranscription.innerHTML = marked.parse(transcription) as string;
            this.updateCurrentNoteContent();

            this.recordingStatus.textContent = 'Polishing note...';
            const polishPrompt = `Take the following raw transcription and turn it into a well-structured, polished note. Correct any grammatical errors, improve sentence flow, and organize the content into a clear and concise format. Use markdown for formatting (headings, lists, bold text, etc.) where appropriate. Here is the transcription:\n\n${transcription}`;
            
            const polishedResponse = await this.genAI.models.generateContent({
              model: MODEL_NAME,
              contents: polishPrompt
            });
            const polishedNoteText = polishedResponse.text;

            this.polishedNote.innerHTML = marked.parse(polishedNoteText) as string;
            this.updateCurrentNoteContent();
            this.recordingStatus.textContent = 'Ready to record';

        } catch (error) {
            console.error('Error with Generative AI:', error);
            this.recordingStatus.textContent = 'Error processing audio. Please try again.';
        }
    };
  }

  // --- Live Recording Visualization ---
  private startLiveVisualization(): void {
    if (!this.stream) return;
    this.audioContext = new AudioContext();
    this.analyserNode = this.audioContext.createAnalyser();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    source.connect(this.analyserNode);
    this.analyserNode.fftSize = 256;
    const bufferLength = this.analyserNode.frequencyBinCount;
    this.waveformDataArray = new Uint8Array(bufferLength);
    
    this.recordingStartTime = Date.now();
    this.timerIntervalId = window.setInterval(() => this.updateTimer(), 10);
    this.drawWaveform();
  }
  
  private stopLiveVisualization(): void {
      if (this.waveformDrawingId) {
        cancelAnimationFrame(this.waveformDrawingId);
        this.waveformDrawingId = null;
      }
      if (this.timerIntervalId) {
        clearInterval(this.timerIntervalId);
        this.timerIntervalId = null;
      }
      this.audioContext?.close();
  }
  
  private drawWaveform(): void {
    if (!this.isRecording || !this.liveWaveformCtx || !this.analyserNode || !this.waveformDataArray) return;

    this.waveformDrawingId = requestAnimationFrame(() => this.drawWaveform());
    this.analyserNode.getByteTimeDomainData(this.waveformDataArray);

    const { width, height } = this.liveWaveformCanvas;
    this.liveWaveformCtx.clearRect(0, 0, width, height);
    
    const isDarkMode = !document.body.classList.contains('light-mode');
    this.liveWaveformCtx.strokeStyle = isDarkMode ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.6)';
    this.liveWaveformCtx.lineWidth = 2;

    this.liveWaveformCtx.beginPath();
    const sliceWidth = width * 1.0 / this.waveformDataArray.length;
    let x = 0;

    for (let i = 0; i < this.waveformDataArray.length; i++) {
        const v = this.waveformDataArray[i] / 128.0;
        const y = v * height / 2;
        if (i === 0) {
            this.liveWaveformCtx.moveTo(x, y);
        } else {
            this.liveWaveformCtx.lineTo(x, y);
        }
        x += sliceWidth;
    }
    this.liveWaveformCtx.lineTo(this.liveWaveformCanvas.width, this.liveWaveformCanvas.height / 2);
    this.liveWaveformCtx.stroke();
  }

  private updateTimer(): void {
    if (!this.isRecording) return;
    const elapsedTime = Date.now() - this.recordingStartTime;
    const minutes = Math.floor(elapsedTime / 60000);
    const seconds = Math.floor((elapsedTime % 60000) / 1000);
    const milliseconds = Math.floor((elapsedTime % 1000) / 10);
    this.liveRecordingTimerDisplay.textContent = 
        `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(2, '0')}`;
  }

  // --- Notes List View ---
  private handleIdeaTabClick(event: MouseEvent): void {
      const target = (event.target as HTMLElement).closest('.idea-tab-btn');
      if (!target) return;

      const tabName = target.getAttribute('data-tab');
      if (tabName) {
          this.activeIdeaTab = tabName;
          this.ideasTabsContainer.querySelectorAll('.idea-tab-btn').forEach(btn => btn.classList.remove('active'));
          target.classList.add('active');
          this.renderNotesList(); // Re-render the list based on the new tab
      }
  }

  private renderNotesList(): void {
    this.notesListContent.innerHTML = '';
    const notesArray = [...this.notes.values()].sort((a,b) => b.timestamp - a.timestamp);

    if (notesArray.length === 0) {
        this.notesListContent.innerHTML = `
            <div class="placeholder-content">
                <p>No Ideas Yet</p>
                <span>Click the record button to start your first voice note.</span>
            </div>`;
        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const startOfWeek = new Date(today);
    startOfWeek.setDate(startOfWeek.getDate() - today.getDay());

    const groups = {
        today: [] as Note[],
        yesterday: [] as Note[],
        thisWeek: [] as Note[],
        older: [] as Note[],
    };

    notesArray.forEach(note => {
        const noteDate = new Date(note.timestamp);
        noteDate.setHours(0, 0, 0, 0);

        if (noteDate.getTime() === today.getTime()) {
            groups.today.push(note);
        } else if (noteDate.getTime() === yesterday.getTime()) {
            groups.yesterday.push(note);
        } else if (noteDate >= startOfWeek) {
            groups.thisWeek.push(note);
        } else {
            groups.older.push(note);
        }
    });

    const createGroupHtml = (title: string, notes: Note[]) => {
        if (notes.length === 0) return '';
        return `
            <div class="notes-group">
                <h2 class="notes-group-title">${title}</h2>
                <div class="notes-grid">
                    ${notes.map(note => `
                        <div class="note-card" data-note-id="${note.id}">
                            <div class="note-card-title">${note.title}</div>
                            <div class="note-card-snippet">${note.polishedNote.substring(0, 100) || 'No content'}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    };

    let html = createGroupHtml('Today', groups.today);
    html += createGroupHtml('Yesterday', groups.yesterday);
    html += createGroupHtml('This Week', groups.thisWeek);
    html += createGroupHtml('Older', groups.older);

    this.notesListContent.innerHTML = html;

    // Add event listeners to new cards
    this.notesListContent.querySelectorAll('.note-card').forEach(card => {
        card.addEventListener('click', () => {
            const noteId = (card as HTMLElement).dataset.noteId;
            if (noteId) {
                this.setActiveNote(noteId);
                this.setActiveView('editor');
            }
        });
    });
  }

  // --- Context Menu ---
  private handleNoteTouchStart(event: TouchEvent): void {
      this.handleNoteTouchEnd(); // Clear any existing timers
      const target = (event.target as HTMLElement).closest('.sidebar-note-item');
      if (target) {
          this.longPressTimer = window.setTimeout(() => {
              this.showNoteContextMenu(event);
              this.longPressTimer = null;
          }, this.LONG_PRESS_DURATION);
      }
  }

  private handleNoteTouchEnd(): void {
      if (this.longPressTimer) {
          clearTimeout(this.longPressTimer);
          this.longPressTimer = null;
      }
  }

  private showNoteContextMenu(event: MouseEvent | TouchEvent): void {
      event.preventDefault();
      event.stopPropagation();
      this.hideContextMenu();

      const target = (event.target as HTMLElement).closest('.sidebar-note-item');
      if (!target) return;
      
      const noteId = (target as HTMLElement).dataset.noteId;
      if (!noteId) return;

      this.contextMenu.innerHTML = this.createContextMenu(noteId);
      
      const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
      const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;

      this.contextMenu.style.display = 'block';
      const { innerWidth, innerHeight } = window;
      const { offsetWidth, offsetHeight } = this.contextMenu;

      this.contextMenu.style.left = `${Math.min(clientX, innerWidth - offsetWidth - 10)}px`;
      this.contextMenu.style.top = `${Math.min(clientY, innerHeight - offsetHeight - 10)}px`;
      
      // Add event listeners for the new menu items
      this.contextMenu.querySelector('[data-action="rename"]')?.addEventListener('click', () => this.renameNote(noteId));
      this.contextMenu.querySelector('[data-action="new-project"]')?.addEventListener('click', () => this.createNewProjectFromContext(noteId));
      this.contextMenu.querySelector('[data-action="delete"]')?.addEventListener('click', () => this.deleteNote(noteId));
      this.projects.forEach(project => {
          this.contextMenu.querySelector(`[data-project-id="${project.id}"]`)?.addEventListener('click', () => this.addNoteToProject(noteId, project.id));
      });
  }

  private hideContextMenu(): void {
      this.contextMenu.style.display = 'none';
      this.contextMenu.innerHTML = '';
  }

  private createContextMenu(noteId: string): string {
    const projectsHtml = [...this.projects.values()].map(p => `
      <li><button class="context-menu-item" data-project-id="${p.id}">${p.name}</button></li>
    `).join('');

    return `
      <ul class="context-menu-list">
        <li><button class="context-menu-item" data-action="rename"><i class="fas fa-i-cursor"></i>Rename</button></li>
        <li>
          <button class="context-menu-item chevron"><i class="fas fa-folder-plus"></i>Add to Project</button>
          <div class="context-submenu">
              <ul class="context-menu-list">
                  ${projectsHtml}
                  ${projectsHtml ? '<div class="context-menu-separator"></div>' : ''}
                  <li><button class="context-menu-item" data-action="new-project"><i class="fas fa-plus"></i>New Project</button></li>
              </ul>
          </div>
        </li>
        <div class="context-menu-separator"></div>
        <li><button class="context-menu-item delete" data-action="delete"><i class="fas fa-trash-alt"></i>Delete</button></li>
      </ul>`;
  }

  // --- Lyriq Player Logic ---
  private async handleLyriqFileUpload(event: Event): Promise<void> {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    this.resetLyriqPlayer();
    this.lyricsContainer.innerHTML = `<p class="lyriq-line placeholder">Transcribing audio...</p>`;
    this.songTitleEl.textContent = file.name;
    const audioURL = URL.createObjectURL(file);
    this.lyriqAudioPlayer.src = audioURL;

    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      await new Promise<void>((resolve, reject) => {
        reader.onloadend = async () => {
          try {
            const base64Audio = (reader.result as string).split(',')[1];
            const audioPart = { inlineData: { mimeType: file.type, data: base64Audio } };
            
            const response = await this.genAI.models.generateContent({
              model: MODEL_NAME,
              contents: { parts: [audioPart] },
              config: {
                systemInstruction: `You are a music transcription service. Your task is to transcribe the provided audio file into lyrics. Provide the output as a JSON array of objects. Each object should have two keys: "time" (the start time of the line in milliseconds) and "line" (the transcribed text of the lyric line).`,
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            time: { type: Type.NUMBER },
                            line: { type: Type.STRING },
                        }
                    }
                }
              }
            });

            const jsonText = response.text.trim();
            this.lyricsData = JSON.parse(jsonText);
            this.renderLyrics();
            this.setLyriqPlayerState(true);
            resolve();
          } catch (e) {
            reject(e);
          }
        };
        reader.onerror = (error) => reject(error);
      });
    } catch (error) {
        console.error("Transcription failed:", error);
        this.lyricsContainer.innerHTML = `<p class="lyriq-line placeholder">Failed to transcribe audio. Please try another file.</p>`;
        this.resetLyriqPlayer();
    }
  }

  private renderLyrics(): void {
    if (this.lyricsData.length === 0) {
        this.lyricsContainer.innerHTML = `<p class="lyriq-line placeholder">No lyrics found in audio.</p>`;
        return;
    }
    this.lyricsContainer.innerHTML = this.lyricsData.map((lyric, index) => 
        `<p class="lyriq-line" data-line-index="${index}">${lyric.line}</p>`
    ).join('');
  }

  private toggleLyriqPlayback(): void {
    if (!this.lyriqAudioPlayer.src || !this.lyriqAudioPlayer.duration) return;
    if (this.lyriqIsPlaying) {
        this.lyriqAudioPlayer.pause();
    } else {
        this.lyriqAudioPlayer.play();
    }
    this.lyriqIsPlaying = !this.lyriqIsPlaying;
    this.lyriqPlayIcon.classList.toggle('fa-play', !this.lyriqIsPlaying);
    this.lyriqPlayIcon.classList.toggle('fa-pause', this.lyriqIsPlaying);
    this.lyriqPlayBtn.title = this.lyriqIsPlaying ? 'Pause' : 'Play';
  }

  private jumpToLyric(direction: 'prev' | 'next'): void {
      if (this.lyricsData.length === 0) return;

      let targetIndex = this.lyriqCurrentLineIndex;
      if (direction === 'next') {
          targetIndex = Math.min(this.lyriqCurrentLineIndex + 1, this.lyricsData.length - 1);
      } else { // prev
          targetIndex = Math.max(this.lyriqCurrentLineIndex - 1, 0);
      }

      if (targetIndex !== this.lyriqCurrentLineIndex) {
          this.lyriqAudioPlayer.currentTime = this.lyricsData[targetIndex].time / 1000;
      }
  }
  
  private handleLyriqProgressScrub(event: Event): void {
      const target = event.target as HTMLInputElement;
      this.lyriqAudioPlayer.currentTime = parseFloat(target.value);
  }
  
  private handleVolumeChange(): void {
    this.lyriqAudioPlayer.volume = parseFloat(this.lyriqVolumeSlider.value);
  }

  private handleLyriqMetadataLoaded(): void {
      const duration = this.lyriqAudioPlayer.duration;
      this.lyriqProgressBar.max = String(duration);
      const remainingTime = duration - this.lyriqAudioPlayer.currentTime;
      this.lyriqRemainingTime.textContent = `-${this.formatTime(remainingTime)}`;
  }

  private syncLyrics(): void {
    if (!this.lyriqIsPlaying || this.lyricsData.length === 0) return;

    const currentTime = this.lyriqAudioPlayer.currentTime;
    const duration = this.lyriqAudioPlayer.duration;
    
    // Update progress bar and time display
    this.lyriqProgressBar.value = String(currentTime);
    this.lyriqCurrentTime.textContent = this.formatTime(currentTime);
    const remainingTime = duration - currentTime;
    this.lyriqRemainingTime.textContent = `-${this.formatTime(remainingTime)}`;

    const currentTimeMs = currentTime * 1000;
    const newIndex = this.lyricsData.findIndex((lyric, i) => {
        const nextLyric = this.lyricsData[i + 1];
        return currentTimeMs >= lyric.time && (!nextLyric || currentTimeMs < nextLyric.time);
    });

    if (newIndex !== -1 && newIndex !== this.lyriqCurrentLineIndex) {
        this.lyriqCurrentLineIndex = newIndex;

        this.lyricsContainer.querySelectorAll('.lyriq-line').forEach(line => {
            line.classList.remove('active');
        });

        const activeLine = this.lyricsContainer.querySelector(`[data-line-index="${newIndex}"]`);
        if (activeLine) {
            activeLine.classList.add('active');
            activeLine.scrollIntoView({ behavior: "smooth", block: "center" });
        }
    }
  }

  private handleLyriqEnded(): void {
      this.lyriqIsPlaying = false;
      this.lyriqPlayIcon.classList.remove('fa-pause');
      this.lyriqPlayIcon.classList.add('fa-play');
      this.lyriqPlayBtn.title = 'Play';
      this.lyriqCurrentLineIndex = -1;
      this.lyricsContainer.querySelectorAll('.lyriq-line').forEach(line => {
          line.classList.remove('active');
      });
  }

  private formatTime(seconds: number): string {
      const min = Math.floor(seconds / 60);
      const sec = Math.floor(seconds % 60);
      return `${min}:${String(sec).padStart(2, '0')}`;
  }
  
  private resetLyriqPlayer(): void {
    if (this.lyriqIsPlaying) {
        this.toggleLyriqPlayback();
    }
    this.lyriqAudioPlayer.src = '';
    this.lyriqAudioPlayer.removeAttribute('src');
    this.lyricsData = [];
    this.lyriqCurrentLineIndex = -1;
    this.lyricsContainer.innerHTML = '<p class="lyriq-line placeholder">Upload a beat to start.</p>';
    this.songTitleEl.textContent = '⬆ Upload Beat';
    this.lyriqProgressBar.value = '0';
    this.lyriqCurrentTime.textContent = '0:00';
    this.lyriqRemainingTime.textContent = '-:--';
    this.lyriqPlayIcon.classList.remove('fa-pause');
    this.lyriqPlayIcon.classList.add('fa-play');
    this.lyriqPlayBtn.title = 'Play';
    this.lyriqShuffleBtn.classList.remove('active');
    this.lyriqRepeatBtn.classList.remove('active');
    this.lyriqVolumeSlider.value = '1';
    this.lyriqAudioPlayer.volume = 1;
    this.setLyriqPlayerState(false);
  }

  private setLyriqPlayerState(enabled: boolean): void {
      this.lyriqPlayBtn.disabled = !enabled;
      this.lyriqPrevBtn.disabled = !enabled;
      this.lyriqNextBtn.disabled = !enabled;
      this.lyriqRecordBtn.disabled = !enabled;
      this.lyriqShuffleBtn.disabled = !enabled;
      this.lyriqRepeatBtn.disabled = !enabled;
      this.lyriqProgressBar.disabled = !enabled;
      // Volume slider should always be enabled
  }
}

// Initialize the app
new VoiceNotesApp();