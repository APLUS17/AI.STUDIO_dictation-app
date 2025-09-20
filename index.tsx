/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/* tslint:disable */

import {GoogleGenAI, Type} from '@google/genai';
import {marked} from 'marked';

const MODEL_NAME = 'gemini-2.5-flash';

// Interfaces for data structures
interface NoteSection {
  type: string;
  content: string;
}

interface Note {
  id: string;
  title: string;
  rawTranscription: string;
  polishedNote: string; // Used for 'open' format content and list view snippets
  sections: NoteSection[]; // Used for 'structured' format
  editorFormat: 'structured' | 'open';
  timestamp: number;
  projectId: string | null;
  audioUrl: string | null;
  audioDuration: number | null; // in milliseconds
  audioData: string | null;
  audioMimeType: string | null;
}

// State snapshot for undo/redo history
interface NoteState {
  title: string;
  sections: NoteSection[];
  polishedNote: string;
  editorFormat: 'structured' | 'open';
}

interface Project {
  id: string;
  name: string;
}

type AppView = 'editor' | 'list' | 'lyriq';
type MixerTrack = 'beat' | 'vocal';


class VoiceNotesApp {
  // AI and Media Recording properties
  private genAI: GoogleGenAI;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private isRecording = false;
  private stream: MediaStream | null = null;

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
  
  // Undo/Redo History
  private noteHistories: Map<string, { undo: NoteState[], redo: NoteState[] }> = new Map();
  private debounceTimer: number | null = null;
  
  // DOM Elements
  private appContainer: HTMLDivElement;
  private recordButton: HTMLButtonElement;
  private recordingStatus: HTMLDivElement;
  private newButton: HTMLButtonElement;
  private themeToggleButton: HTMLButtonElement;
  private themeToggleIcon: HTMLElement;
  private editorTitle: HTMLDivElement;
  private sidebar: HTMLElement;
  private sidebarToggleButton: HTMLButtonElement;
  private sidebarNewNoteButton: HTMLButtonElement;
  private allNotesButton: HTMLAnchorElement;
  private projectsList: HTMLUListElement;
  private recentNotesList: HTMLUListElement;
  private contextMenu: HTMLDivElement;
  private noteArea: HTMLDivElement;

  // Song Structure Editor Elements
  private songStructureEditor: HTMLDivElement;
  private openFormatEditor: HTMLDivElement;
  private openFormatContent: HTMLDivElement;
  private addSectionBtn: HTMLButtonElement;
  private formatToggleButton: HTMLButtonElement;
  private formatToggleIcon: HTMLElement;
  private sendToLyriqButton: HTMLButtonElement;
  private undoButton: HTMLButtonElement;
  private redoButton: HTMLButtonElement;

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

  // Note Audio Playback elements
  private audioPlaybackContainer: HTMLDivElement;
  private playbackTitle: HTMLDivElement;
  private playbackPlayButton: HTMLButtonElement;
  private playbackPlayIcon: HTMLElement;
  private playbackPauseIcon: HTMLElement;
  private playbackRewindButton: HTMLButtonElement;
  private playbackForwardButton: HTMLButtonElement;
  private playbackDate: HTMLDivElement;
  private playbackDurationDisplay: HTMLSpanElement;
  private playbackTimeDisplay: HTMLSpanElement;
  private noteAudioPlayer: HTMLAudioElement;
  private isPlaybackUiActive = false;

  // Lyriq Player elements and state
  private lyriqPlayerView: HTMLDivElement;
  private lyriqPlayerButton: HTMLAnchorElement;
  private audioUploadInput: HTMLInputElement;
  private lyriqAudioPlayer: HTMLAudioElement;
  private lyriqVocalAudioPlayer: HTMLAudioElement;
  private lyricsContainer: HTMLDivElement;
  private lyriqSongTitle: HTMLHeadingElement;
  private lyriqSongSubtitle: HTMLHeadingElement;
  private lyriqAddBeatBtn: HTMLButtonElement;
  private lyriqVocalIndicator: HTMLButtonElement;
  private lyriqModalTime: HTMLSpanElement;
  private lyriqVolumeBtn: HTMLButtonElement;
  private lyriqVolumeSlider: HTMLInputElement;
  private lyriqModalRecordBtn: HTMLButtonElement;
  private lyriqModalPlayBtn: HTMLButtonElement;
  private lyriqUploadBtnHeader: HTMLButtonElement;
  private lyriqControlsModal: HTMLDivElement;
  private lyriqModalHandle: HTMLDivElement;
  private lyriqCloseBtn: HTMLButtonElement;
  private lyriqWaveforms: HTMLDivElement;
  private beatWaveformCanvas: HTMLCanvasElement;
  private vocalWaveformCanvas: HTMLCanvasElement;
  private lyriqPlayhead: HTMLDivElement;
  private beatWaveformCtx: CanvasRenderingContext2D | null;
  private vocalWaveformCtx: CanvasRenderingContext2D | null;

  private beatAudioBuffer: AudioBuffer | null = null;
  private vocalAudioBuffer: AudioBuffer | null = null;
  private isDraggingModal = false;
  private modalDragStartY = 0;
  private modalDragStartTranslateY = 0;
  private isScrubbing = false;

  private lyriqIsPlaying = false;
  private lyriqCurrentLineIndex = -1;
  private lyricsData: { time: number; line: string }[] = [];
  private activeMixerTrack: MixerTrack = 'beat';
  
  private lyriqAnimationId: number | null = null;
  private readonly PIXELS_PER_SECOND = 100;
  
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
    this.newButton = document.getElementById('newButton') as HTMLButtonElement;
    this.themeToggleButton = document.getElementById('themeToggleButton') as HTMLButtonElement;
    this.themeToggleIcon = this.themeToggleButton.querySelector('i') as HTMLElement;
    this.editorTitle = document.querySelector('.editor-title') as HTMLDivElement;
    this.sidebar = document.querySelector('.sidebar') as HTMLElement;
    this.sidebarToggleButton = document.getElementById('sidebarToggleButton') as HTMLButtonElement;
    this.sidebarNewNoteButton = document.getElementById('sidebarNewNoteButton') as HTMLButtonElement;
    this.allNotesButton = document.getElementById('allNotesButton') as HTMLAnchorElement;
    this.projectsList = document.getElementById('projectsList') as HTMLUListElement;
    this.recentNotesList = document.getElementById('recentNotesList') as HTMLUListElement;
    this.contextMenu = document.getElementById('contextMenu') as HTMLDivElement;
    this.noteArea = document.querySelector('.note-area') as HTMLDivElement;
    
    // Song Structure Editor Elements
    this.songStructureEditor = document.getElementById('songStructureEditor') as HTMLDivElement;
    this.openFormatEditor = document.getElementById('openFormatEditor') as HTMLDivElement;
    this.openFormatContent = document.getElementById('openFormatContent') as HTMLDivElement;
    this.addSectionBtn = document.getElementById('addSectionBtn') as HTMLButtonElement;
    this.formatToggleButton = document.getElementById('formatToggleButton') as HTMLButtonElement;
    this.formatToggleIcon = this.formatToggleButton.querySelector('i') as HTMLElement;
    this.sendToLyriqButton = document.getElementById('sendToLyriqButton') as HTMLButtonElement;
    this.undoButton = document.getElementById('undoButton') as HTMLButtonElement;
    this.redoButton = document.getElementById('redoButton') as HTMLButtonElement;
    
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

    // Note Audio Playback elements
    this.audioPlaybackContainer = document.getElementById('audioPlaybackContainer') as HTMLDivElement;
    this.playbackTitle = this.audioPlaybackContainer.querySelector('.playback-title') as HTMLDivElement;
    this.playbackPlayButton = document.getElementById('playbackPlayButton') as HTMLButtonElement;
    this.playbackPlayIcon = this.playbackPlayButton.querySelector('.play-icon') as HTMLElement;
    this.playbackPauseIcon = this.playbackPlayButton.querySelector('.pause-icon') as HTMLElement;
    this.playbackRewindButton = document.getElementById('playbackRewindButton') as HTMLButtonElement;
    this.playbackForwardButton = document.getElementById('playbackForwardButton') as HTMLButtonElement;
    this.playbackDate = this.audioPlaybackContainer.querySelector('.playback-date') as HTMLDivElement;
    this.playbackDurationDisplay = document.getElementById('playbackDurationDisplay') as HTMLSpanElement;
    this.playbackTimeDisplay = document.getElementById('playbackTimeDisplay') as HTMLSpanElement;
    this.noteAudioPlayer = document.getElementById('noteAudioPlayer') as HTMLAudioElement;
    
    // Lyriq Player elements
    this.lyriqPlayerView = document.querySelector('.lyriq-player-view') as HTMLDivElement;
    this.lyriqPlayerButton = document.getElementById('lyriqPlayerButton') as HTMLAnchorElement;
    this.audioUploadInput = document.getElementById('audioUpload') as HTMLInputElement;
    this.lyriqAudioPlayer = document.getElementById('lyriqAudio') as HTMLAudioElement;
    this.lyriqVocalAudioPlayer = document.getElementById('lyriqVocalAudio') as HTMLAudioElement;
    this.lyricsContainer = document.getElementById('lyricsContainer') as HTMLDivElement;
    this.lyriqSongTitle = document.getElementById('lyriqSongTitle') as HTMLHeadingElement;
    this.lyriqSongSubtitle = document.getElementById('lyriqSongSubtitle') as HTMLHeadingElement;
    this.lyriqAddBeatBtn = document.getElementById('lyriqAddBeatBtn') as HTMLButtonElement;
    this.lyriqVocalIndicator = document.getElementById('lyriqVocalIndicator') as HTMLButtonElement;
    this.lyriqModalTime = document.getElementById('lyriqModalTime') as HTMLSpanElement;
    this.lyriqVolumeBtn = document.getElementById('lyriqVolumeBtn') as HTMLButtonElement;
    this.lyriqVolumeSlider = document.getElementById('lyriqVolumeSlider') as HTMLInputElement;
    this.lyriqModalRecordBtn = document.getElementById('lyriqModalRecordBtn') as HTMLButtonElement;
    this.lyriqModalPlayBtn = document.getElementById('lyriqModalPlayBtn') as HTMLButtonElement;
    this.lyriqUploadBtnHeader = document.getElementById('lyriqUploadBtnHeader') as HTMLButtonElement;
    this.lyriqControlsModal = document.getElementById('lyriqControlsModal') as HTMLDivElement;
    this.lyriqModalHandle = document.getElementById('lyriqModalHandle') as HTMLDivElement;
    this.lyriqCloseBtn = document.getElementById('lyriqCloseBtn') as HTMLButtonElement;
    this.lyriqWaveforms = this.lyriqControlsModal.querySelector('.lyriq-waveforms') as HTMLDivElement;
    this.beatWaveformCanvas = document.getElementById('beatWaveformCanvas') as HTMLCanvasElement;
    this.vocalWaveformCanvas = document.getElementById('vocalWaveformCanvas') as HTMLCanvasElement;
    this.lyriqPlayhead = document.getElementById('lyriqPlayhead') as HTMLDivElement;
    this.beatWaveformCtx = this.beatWaveformCanvas.getContext('2d');
    this.vocalWaveformCtx = this.vocalWaveformCanvas.getContext('2d');

    // Initial setup
    this.bindEventListeners();
    this.initTheme();
    this.loadDataFromStorage();
    this.updateVolumeUI();
    this.setActiveMixerTrack('beat');

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
    })();
  }

  private bindEventListeners(): void {
    // Core controls
    this.recordButton.addEventListener('click', () => this.toggleRecording());
    this.newButton.addEventListener('click', () => this.createNewNote());
    this.themeToggleButton.addEventListener('click', () => this.toggleTheme());
    this.formatToggleButton.addEventListener('click', () => this.handleFormatToggle());
    this.sendToLyriqButton.addEventListener('click', () => this.setActiveView('lyriq'));
    this.undoButton.addEventListener('click', () => this.undo());
    this.redoButton.addEventListener('click', () => this.redo());

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
    this.editorTitle.addEventListener('blur', () => { this.updateCurrentNoteContent(); this.saveNoteState(); });
    this.editorTitle.addEventListener('input', () => {
        this.updatePlaceholderVisibility(this.editorTitle);
        this.debouncedSaveState();
    });
    this.openFormatContent.addEventListener('blur', () => { this.updateCurrentNoteContent(); this.saveNoteState(); });
    this.openFormatContent.addEventListener('input', () => this.debouncedSaveState());


    // Generic handler for all contenteditable placeholders
    this.noteArea.addEventListener('input', (e) => {
        const target = e.target as HTMLElement;
        if (target.isContentEditable) {
            this.updatePlaceholderVisibility(target);
        }
    });

    // Song Structure Editor Controls (Event Delegation)
    this.songStructureEditor.addEventListener('click', (e) => this.handleSectionEditorClick(e));
    this.songStructureEditor.addEventListener('blur', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('section-content')) {
        this.updateCurrentNoteContent();
        this.saveNoteState();
      }
    }, true); // Use capture phase for blur
    this.songStructureEditor.addEventListener('input', (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('section-content')) {
            this.debouncedSaveState();
        }
    });
    this.addSectionBtn.addEventListener('click', () => this.addSection());
    
    // Notes list view controls
    this.ideasTabsContainer.addEventListener('click', (e) => this.handleIdeaTabClick(e as MouseEvent));
    this.listViewNewNoteFab.addEventListener('click', async () => {
        await this.createNewNote();
        this.setActiveView('editor');
    });

    // Audio Playback Controls
    this.playbackPlayButton.addEventListener('click', () => this.toggleNotePlayback());
    this.playbackRewindButton.addEventListener('click', () => this.seekNotePlayback(-15));
    this.playbackForwardButton.addEventListener('click', () => this.seekNotePlayback(15));
    this.noteAudioPlayer.addEventListener('timeupdate', () => this.updatePlaybackTime());
    this.noteAudioPlayer.addEventListener('loadedmetadata', () => this.updatePlaybackTime());
    this.noteAudioPlayer.addEventListener('ended', () => this.handleNotePlaybackEnded());
    this.noteAudioPlayer.addEventListener('play', () => this.updatePlaybackButton(true));
    this.noteAudioPlayer.addEventListener('pause', () => this.updatePlaybackButton(false));

    // Lyriq Player controls
    this.lyriqPlayerButton.addEventListener('click', (e) => {
        e.preventDefault();
        this.setActiveView('lyriq');
    });
    this.audioUploadInput.addEventListener('change', (e) => this.handleLyriqFileUpload(e as Event));
    this.lyriqAddBeatBtn.addEventListener('click', () => this.audioUploadInput.click());
    this.lyriqUploadBtnHeader.addEventListener('click', () => this.audioUploadInput.click());
    this.lyriqModalPlayBtn.addEventListener('click', () => this.toggleLyriqPlayback());
    this.lyriqModalRecordBtn.addEventListener('click', () => this.toggleRecording());
    this.lyriqVolumeBtn.addEventListener('click', () => this.toggleLyriqMute());
    this.lyriqVolumeSlider.addEventListener('input', () => this.handleVolumeChange());
    
    this.lyriqAudioPlayer.addEventListener('loadedmetadata', () => this.handleLyriqMetadataLoaded());
    this.lyriqAudioPlayer.addEventListener('timeupdate', () => this.syncLyrics());
    this.lyriqAudioPlayer.addEventListener('ended', () => this.handleLyriqEnded());
    
    // Lyriq Mixer Controls
    this.lyriqAddBeatBtn.addEventListener('click', () => this.setActiveMixerTrack('beat'));
    this.lyriqVocalIndicator.addEventListener('click', () => this.setActiveMixerTrack('vocal'));

    // Lyriq Modal Drag Controls
    this.lyriqControlsModal.addEventListener('touchstart', (e) => this.handleModalDragStart(e), { passive: true });
    document.addEventListener('touchmove', (e) => this.handleModalDragMove(e), { passive: false });
    document.addEventListener('touchend', (e) => this.handleModalDragEnd(e));
    this.lyriqControlsModal.addEventListener('mousedown', (e) => this.handleModalDragStart(e));
    document.addEventListener('mousemove', (e) => this.handleModalDragMove(e));
    document.addEventListener('mouseup', (e) => this.handleModalDragEnd(e));
    
    // Lyriq Waveform Scrubbing
    this.lyriqWaveforms.addEventListener('mousedown', (e) => this.handleScrubStart(e));
    this.lyriqWaveforms.addEventListener('touchstart', (e) => this.handleScrubStart(e), { passive: true });
    document.addEventListener('mousemove', (e) => this.handleScrubMove(e));
    document.addEventListener('touchmove', (e) => this.handleScrubMove(e), { passive: false });
    document.addEventListener('mouseup', () => this.handleScrubEnd());
    document.addEventListener('touchend', () => this.handleScrubEnd());


    // Window and global listeners
    window.addEventListener('resize', () => { this.isMobile = window.innerWidth <= 1024; });
    window.addEventListener('keydown', (e) => this.handleKeyDown(e));
    document.addEventListener('click', (e) => {
      this.hideContextMenu();
      document.querySelectorAll('.section-type-dropdown.open').forEach(dropdown => {
        if (!dropdown.contains(e.target as Node)) {
          dropdown.classList.remove('open');
        }
      });
      this.handleOutsideClick(e);
    });
    
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
              this.loadNoteIntoLyriqPlayer();
              if (this.lyriqAudioPlayer.src) {
                this.setLyriqModalState('peeking');
              } else {
                this.setLyriqModalState('hidden');
              }
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
        const parsedNotes: [string, Note][] = JSON.parse(notesData);
        parsedNotes.forEach(([id, note]) => {
            // Revoke any old blob URLs as they are invalid on page load
            if (note.audioUrl && note.audioUrl.startsWith('blob:')) {
                note.audioUrl = null;
            }
            this.notes.set(id, note);
        });
    }
    const projectsData = localStorage.getItem('voiceProjects');
    if (projectsData) {
        this.projects = new Map(JSON.parse(projectsData));
    }
  }

  private saveDataToStorage(): void {
    // Create a deep copy to avoid modifying the original notes map
    const notesToStore = new Map<string, Note>();
    this.notes.forEach((note, id) => {
        const noteCopy = { ...note };
        // Don't store blob URLs in localStorage
        if (noteCopy.audioUrl && noteCopy.audioUrl.startsWith('blob:')) {
            noteCopy.audioUrl = null;
        }
        notesToStore.set(id, noteCopy);
    });
    localStorage.setItem('voiceNotes', JSON.stringify(Array.from(notesToStore.entries())));
    localStorage.setItem('voiceProjects', JSON.stringify(Array.from(this.projects.entries())));
  }

  // --- Note Management ---
  private async createNewNote(): Promise<void> {
    const newNote: Note = {
      id: `note_${Date.now()}`,
      title: 'Untitled Note',
      rawTranscription: '',
      polishedNote: '',
      sections: [{ type: 'Verse', content: '' }],
      editorFormat: 'structured',
      timestamp: Date.now(),
      projectId: null,
      audioUrl: null,
      audioDuration: null,
      audioData: null,
      audioMimeType: null,
    };
    this.notes.set(newNote.id, newNote);
    
    // Initialize history for the new note
    this.noteHistories.set(newNote.id, {
        undo: [this.getNoteState(newNote)],
        redo: [],
    });

    this.setActiveNote(newNote.id);
    this.setActiveView('editor');
    this.saveDataToStorage();
    this.renderSidebar();
  }
  
  private setActiveNote(noteId: string | null): void {
      if (!noteId || !this.notes.has(noteId)) {
        this.currentNoteId = null;
        this.editorTitle.textContent = '';
        this.renderNoteContent(null);
        return;
      }

      this.currentNoteId = noteId;
      const note = this.notes.get(noteId)!;

      // Backwards compatibility for notes saved before format toggle
      if (!note.editorFormat) {
          note.editorFormat = 'structured';
          note.sections = [{ type: 'Verse', content: note.polishedNote }];
      }
      
      // Initialize history for the note if it doesn't exist (e.g., from a previous session)
      if (!this.noteHistories.has(noteId)) {
        this.noteHistories.set(noteId, {
            undo: [this.getNoteState(note)],
            redo: [],
        });
      }

      this.editorTitle.textContent = note.title;
      this.updatePlaceholderVisibility(this.editorTitle);
      this.renderNoteContent(note);
      this.renderSidebar();
      this.updateUndoRedoButtons();
  }
  
  private updateCurrentNoteContent(): void {
      if (!this.currentNoteId) return;
      const note = this.notes.get(this.currentNoteId);
      if (note) {
          const newTitle = this.editorTitle.textContent?.trim() || 'Untitled Note';
          note.title = newTitle;

          if (note.editorFormat === 'structured') {
            const newSections: NoteSection[] = [];
            const cards = this.songStructureEditor.querySelectorAll('.song-section-card');
            cards.forEach(card => {
              const type = card.querySelector('.section-type-btn span')?.textContent || 'Verse';
              const content = (card.querySelector('.section-content') as HTMLDivElement).innerText;
              newSections.push({ type, content });
            });
            note.sections = newSections;
            note.polishedNote = this.flattenSections(newSections); // Update snippet
          } else {
            note.polishedNote = this.openFormatContent.innerText;
          }
          
          note.timestamp = Date.now();
          this.saveDataToStorage();
          this.renderSidebar(); // Re-render to update titles and order
      }
  }

  private deleteNote(noteId: string): void {
    if (!this.notes.has(noteId)) return;
    
    // Clean up blob URL and history from memory
    const noteToDelete = this.notes.get(noteId);
    if (noteToDelete && noteToDelete.audioUrl) {
        URL.revokeObjectURL(noteToDelete.audioUrl);
    }
    this.notes.delete(noteId);
    this.noteHistories.delete(noteId);

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
        this.updateCurrentNoteContent(); // Save current state before renaming
        this.saveNoteState();
        note.title = newTitle.trim();
        note.timestamp = Date.now(); // Bump timestamp to bring to top
        this.saveDataToStorage();
        this.saveNoteState(); // Save new state after renaming
        this.renderSidebar();
        if (this.currentNoteId === noteId) {
            this.editorTitle.textContent = note.title;
        }
        if (this.appContainer.classList.contains('list-view-active')) {
            this.renderNotesList();
        }
    }
  }
  
  private flattenSections(sections: NoteSection[]): string {
    return sections.map(s => `[${s.type}]\n${s.content}`).join('\n\n');
  }

  // --- Editor and Content Rendering ---
  private renderNoteContent(note: Note | null): void {
    if (!note) {
      this.songStructureEditor.innerHTML = '';
      this.openFormatContent.innerHTML = '';
      this.noteArea.classList.remove('format-open');
      this.formatToggleIcon.classList.replace('fa-list-alt', 'fa-file-alt');
      this.renderAudioPlaybackUI(null);
      return;
    }
    
    this.renderAudioPlaybackUI(note);

    if (note.editorFormat === 'structured') {
      this.noteArea.classList.remove('format-open');
      this.formatToggleIcon.classList.replace('fa-list-alt', 'fa-file-alt');
      this.songStructureEditor.innerHTML = ''; // Clear previous content
      note.sections.forEach((section, index) => {
        const card = this.createSectionCard(section, index);
        this.songStructureEditor.appendChild(card);
      });
    } else {
      this.noteArea.classList.add('format-open');
      this.formatToggleIcon.classList.replace('fa-file-alt', 'fa-list-alt');
      this.openFormatContent.innerText = note.polishedNote;
      this.updatePlaceholderVisibility(this.openFormatContent);
    }
  }
  
  private handleFormatToggle(): void {
      if (!this.currentNoteId) return;
      const note = this.notes.get(this.currentNoteId);
      if (!note) return;

      this.updateCurrentNoteContent(); // Save current state before switching
      this.saveNoteState();

      if (note.editorFormat === 'structured') {
          note.editorFormat = 'open';
          // Convert sections to a single string for the open editor
          note.polishedNote = this.flattenSections(note.sections);
      } else {
          note.editorFormat = 'structured';
          // This is a destructive conversion - we can't perfectly parse back.
          // For now, we'll create a single section. A more advanced implementation
          // could try to parse [Verse] tags.
          if (note.polishedNote && note.sections.length === 0) {
            note.sections = [{ type: 'Verse', content: note.polishedNote }];
          } else if (note.sections.length === 0) {
            note.sections = [{ type: 'Verse', content: '' }];
          }
      }

      this.saveDataToStorage();
      this.saveNoteState(); // Save new state
      this.renderNoteContent(note);
  }

  // --- Song Structure Editor ---
  private createSectionCard(section: NoteSection, index: number): HTMLDivElement {
    const card = document.createElement('div');
    card.className = 'song-section-card';
    card.dataset.index = index.toString();
    
    card.innerHTML = `
      <div class="section-card-header">
        <div class="section-type-dropdown">
          <button class="section-type-btn" aria-haspopup="true">
            <span>${section.type}</span>
            <i class="fas fa-chevron-down"></i>
          </button>
          <ul class="section-type-menu" role="menu">
            ${['Verse', 'Chorus', 'Bridge', 'Intro', 'Outro', 'Pre-Chorus', 'Hook', 'Solo'].map(type => `<li><button role="menuitem">${type}</button></li>`).join('')}
          </ul>
        </div>
        <button class="delete-section-btn" title="Delete Section" aria-label="Delete Section">
          <i class="fas fa-trash-alt"></i>
        </button>
      </div>
      <div class="section-content" contenteditable="true" placeholder="Start writing..."></div>
    `;

    const contentDiv = card.querySelector('.section-content') as HTMLDivElement;
    contentDiv.innerText = section.content;
    this.updatePlaceholderVisibility(contentDiv);

    return card;
  }
  
  private addSection(type = 'Verse', content = ''): void {
      if (!this.currentNoteId) return;
      const note = this.notes.get(this.currentNoteId);
      if (!note || note.editorFormat !== 'structured') return;

      this.updateCurrentNoteContent();
      this.saveNoteState();

      const newSection: NoteSection = { type, content };
      note.sections.push(newSection);
      
      const newCard = this.createSectionCard(newSection, note.sections.length - 1);
      this.songStructureEditor.appendChild(newCard);
      
      this.updateCurrentNoteContent();
      this.saveNoteState();
  }

  private handleSectionEditorClick(e: Event): void {
    const target = e.target as HTMLElement;
    const card = target.closest<HTMLElement>('.song-section-card');
    if (!card) return;
    
    const index = parseInt(card.dataset.index!, 10);

    // Toggle dropdown
    if (target.closest('.section-type-btn')) {
      target.closest('.section-type-dropdown')?.classList.toggle('open');
    }
    
    // Handle dropdown item selection
    if (target.matches('.section-type-menu button')) {
      this.updateCurrentNoteContent();
      this.saveNoteState();
      const newType = target.textContent!;
      const note = this.notes.get(this.currentNoteId!);
      if (note && note.sections[index]) {
        note.sections[index].type = newType;
        card.querySelector('.section-type-btn span')!.textContent = newType;
        this.updateCurrentNoteContent();
        this.saveNoteState();
      }
      target.closest('.section-type-dropdown')?.classList.remove('open');
    }

    // Handle delete button
    if (target.closest('.delete-section-btn')) {
      this.updateCurrentNoteContent();
      this.saveNoteState();
      const note = this.notes.get(this.currentNoteId!);
      if (note && note.sections[index]) {
        note.sections.splice(index, 1);
        card.remove();
        // Re-index remaining cards
        this.songStructureEditor.querySelectorAll<HTMLDivElement>('.song-section-card').forEach((c, i) => c.dataset.index = i.toString());
        this.updateCurrentNoteContent();
        this.saveNoteState();
      }
    }
  }
  
  // --- Notes List View ---
  private renderNotesList(): void {
      this.notesListContent.innerHTML = '';
      const notesArray = [...this.notes.values()].sort((a,b) => b.timestamp - a.timestamp);

      if (notesArray.length === 0) {
        this.notesListContent.innerHTML = `
          <div class="placeholder-content">
              <p>No Ideas Yet</p>
              <span>Click the button in the bottom right to create a new note.</span>
          </div>`;
        return;
      }
      
      // For now, just one group. Can expand later with date grouping.
      const group = document.createElement('div');
      group.className = 'notes-group';
      group.innerHTML = `<h2 class="notes-group-title">All Ideas</h2>`;
      const grid = document.createElement('div');
      grid.className = 'notes-grid';

      notesArray.forEach(note => {
          const card = document.createElement('div');
          card.className = 'note-card';
          card.dataset.noteId = note.id;
          
          const snippet = note.editorFormat === 'open' ? note.polishedNote : this.flattenSections(note.sections);

          card.innerHTML = `
            <div class="note-card-content">
              <div class="note-card-title">${note.title}</div>
              <div class="note-card-snippet">${snippet.replace(/\n/g, ' ')}</div>
            </div>
          `;
          
          card.addEventListener('click', () => {
              this.setActiveNote(note.id);
              this.setActiveView('editor');
          });

          // Long-press and context menu for list view cards
          card.addEventListener('contextmenu', (e) => this.showNoteContextMenu(e as MouseEvent, note.id));
          card.addEventListener('touchstart', (e) => this.handleNoteTouchStart(e as TouchEvent, note.id), { passive: false });
          card.addEventListener('touchend', () => this.handleNoteTouchEnd());
          card.addEventListener('touchmove', () => this.handleNoteTouchEnd());

          grid.appendChild(card);
      });
      
      group.appendChild(grid);
      this.notesListContent.appendChild(group);
  }

  private handleIdeaTabClick(e: MouseEvent): void {
      const target = e.target as HTMLElement;
      const button = target.closest<HTMLButtonElement>('.idea-tab-btn');
      if (button && !button.classList.contains('active')) {
          this.ideasTabsContainer.querySelector('.active')?.classList.remove('active');
          button.classList.add('active');
          this.activeIdeaTab = button.dataset.tab!;
          // TODO: Implement filtering based on tab
          this.renderNotesList();
      }
  }


  // --- Audio Recording & Processing ---
  private async requestMicrophoneAndStart(): Promise<void> {
    try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.startRecording();
    } catch (err) {
        console.error('Error accessing microphone:', err);
        const errName = (err as Error).name;
        if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
            this.recordingStatus.innerHTML = 'Microphone access denied. <br> Please enable it in your browser settings to record.';
        } else {
            this.recordingStatus.textContent = 'Could not access microphone.';
        }
    }
  }

  private async toggleRecording(): Promise<void> {
    if (this.isRecording) {
      // Stop logic
      if (this.mediaRecorder) {
        this.mediaRecorder.stop();
      }
      this.isRecording = false;
      this.updateRecordingUI(false);
      
      if (this.activeView === 'lyriq') {
        // this.stopLyriqWaveformAnimation(); // Removed to fix crash
      } else {
        this.stopLiveWaveform();
        this.stopTimer();
      }

    } else {
      // Start logic
      if (navigator.permissions?.query) { // Optional chaining for safety
        try {
            const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
            if (permissionStatus.state === 'denied') {
                this.recordingStatus.innerHTML = 'Microphone access is blocked. <br> Please enable it in your browser settings to record.';
                return; 
            }
            await this.requestMicrophoneAndStart();
        } catch(e) {
            console.error("Permissions API error, falling back:", e);
            await this.requestMicrophoneAndStart();
        }
      } else {
          await this.requestMicrophoneAndStart();
      }
    }
  }

  private async startRecording(): Promise<void> {
    if (!this.stream) {
        console.error("No audio stream available.");
        this.recordingStatus.textContent = 'Could not start recording.';
        return;
    }
    
    this.audioChunks = [];
    try {
        this.mediaRecorder = new MediaRecorder(this.stream);
        this.mediaRecorder.ondataavailable = (event) => {
          this.audioChunks.push(event.data);
        };
    
        this.mediaRecorder.onstop = async () => {
          // Clean up stream tracks
          this.stream?.getTracks().forEach(track => track.stop());
          this.stream = null;
          
          const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
          this.audioChunks = [];

          if (audioBlob.size < 1000) { // Guard against empty recordings
            if (this.activeView !== 'lyriq') {
              this.setFinalStatus('Recording too short.', true);
            }
            return;
          }

          if (this.activeView === 'lyriq') {
              const vocalUrl = URL.createObjectURL(audioBlob);
              if (this.lyriqVocalAudioPlayer.src) {
                URL.revokeObjectURL(this.lyriqVocalAudioPlayer.src);
              }
              this.lyriqVocalAudioPlayer.src = vocalUrl;
              this.processAndRenderVocalWaveform(audioBlob);
              this.lyriqVocalIndicator.classList.add('has-recording');
              return;
          }


          if (!this.currentNoteId) {
              await this.createNewNote();
          }

          const note = this.notes.get(this.currentNoteId!);
          if (note) {
              // Revoke old URL if it exists to free memory
              if (note.audioUrl) {
                  URL.revokeObjectURL(note.audioUrl);
              }
              note.audioUrl = URL.createObjectURL(audioBlob);
              note.audioMimeType = audioBlob.type;
              note.audioData = await this.blobToBase64(audioBlob);
              
              try {
                  note.audioDuration = await this.getAudioDuration(note.audioUrl);
                  this.saveDataToStorage();
                  this.renderAudioPlaybackUI(note); // Render immediately with audio present
              } catch (error) {
                  console.error("Failed to get audio duration:", error);
                  // Don't show the player if we can't get duration, but proceed with transcription
              }
          }
          
          await this.transcribeAndProcess(audioBlob);
        };
    
        this.mediaRecorder.start();
        this.isRecording = true;
        this.updateRecordingUI(true);

        if (this.activeView === 'lyriq') {
            this.vocalWaveformCtx?.clearRect(0,0, this.vocalWaveformCanvas.width, this.vocalWaveformCanvas.height);
            this.updatePlayheadPosition(0);
            if (this.lyriqAudioPlayer.paused) {
                this.toggleLyriqPlayback();
            }
        } else {
            this.startLiveWaveform();
            this.startTimer();
        }

    } catch (error) {
        console.error("Error creating MediaRecorder:", error);
        this.recordingStatus.textContent = 'Recording failed to start.';
        this.isRecording = false;
        this.updateRecordingUI(false);
    }
  }

  private async transcribeAndProcess(audioBlob: Blob): Promise<void> {
    if (!this.currentNoteId) return;

    document.body.classList.add('is-processing');
    this.recordingStatus.textContent = 'Transcribing...';
    
    try {
      const base64Audio = await this.blobToBase64(audioBlob);
      const audioPart = {
        inlineData: {
          mimeType: audioBlob.type,
          data: base64Audio,
        },
      };

      const response = await this.genAI.models.generateContent({
        model: MODEL_NAME,
        contents: {
          parts: [
            audioPart,
            { text: `
              Transcribe the following audio recording of a musician thinking out loud.
              The audio may contain singing, humming, speech, and musical instruments.
              Provide a raw, literal transcription.
            `},
          ]
        },
      });

      const rawTranscription = response.text;
      
      const note = this.notes.get(this.currentNoteId)!;
      note.rawTranscription = rawTranscription;
      this.recordingStatus.textContent = 'Polishing note...';

      await this.polishNoteWithAI(note);

    } catch (error) {
      console.error('Error during transcription/processing:', error);
      this.setFinalStatus('Error processing audio.', true);
    }
  }

  private async polishNoteWithAI(note: Note): Promise<void> {
      try {
          const response = await this.genAI.models.generateContent({
              model: MODEL_NAME,
              // FIX: Changed contents to be a single string to align with Gemini API guidelines for text-only prompts.
              contents: `
                    You are an expert musical assistant. A songwriter has provided a raw transcription from a voice memo.
                    Your task is to analyze the transcription and structure it into a clear, organized format for songwriting.
                    
                    Follow these rules:
                    1.  Identify distinct sections (e.g., Verse, Chorus, Bridge, etc.). If the structure isn't clear, use logical groupings like "Idea 1", "Idea 2".
                    2.  Format the output as a JSON object that is an array of "NoteSection" objects.
                    3.  Each NoteSection object must have two properties: "type" (a string, e.g., "Verse") and "content" (a string with the lyrics/notes for that section).
                    4.  Clean up the content: remove filler words (um, uh), correct obvious transcription errors, and format lyrics cleanly. Preserve the core creative ideas.
                    5.  Do NOT add any new lyrics or ideas. Stick to the source material.
                    6.  If the transcription is very short or simple, you can create a single section (e.g., "Verse" or "Lyric Idea").
                    
                    RAW TRANSCRIPTION:
                    "${note.rawTranscription}"
                `,
              config: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      type: { type: Type.STRING },
                      content: { type: Type.STRING }
                    },
                    required: ["type", "content"]
                  }
                }
              }
          });

          const jsonString = response.text;
          const structuredResult = JSON.parse(jsonString);
          
          this.updateCurrentNoteContent();
          this.saveNoteState(); // Save state before AI polish

          note.sections = structuredResult;
          note.polishedNote = this.flattenSections(note.sections);
          note.timestamp = Date.now();
          
          this.saveDataToStorage();
          this.saveNoteState(); // Save state after AI polish
          this.setActiveNote(note.id); // Re-render the editor with new content
          this.renderSidebar(); // Update sidebar with new timestamp
          this.setFinalStatus('Note polished successfully!');

      } catch (error) {
          console.error('Error polishing note:', error);
          this.setFinalStatus('Could not polish note.', true);
          // Fallback to raw transcription
          note.polishedNote = note.rawTranscription;
          note.sections = [{ type: 'Verse', content: note.rawTranscription }];
          this.saveDataToStorage();
          this.saveNoteState(); // Save fallback state
          this.setActiveNote(note.id);
      }
  }
  
  private updateRecordingUI(isRecording: boolean): void {
    document.body.classList.toggle('is-recording', isRecording);
    this.recordButton.classList.toggle('recording', isRecording);
    this.lyriqModalRecordBtn.classList.toggle('recording', isRecording);
    this.lyriqVocalIndicator.classList.toggle('recording', isRecording);
    
    const recordIcon = this.recordButton.querySelector('.fa-microphone') as HTMLElement;
    const stopIcon = this.recordButton.querySelector('.fa-stop') as HTMLElement;
    
    if (isRecording) {
      recordIcon.style.display = 'none';
      stopIcon.style.display = 'inline-block';
      this.recordingStatus.textContent = 'Recording...';
    } else {
      recordIcon.style.display = 'inline-block';
      stopIcon.style.display = 'none';
      this.recordingStatus.textContent = 'Processing...';
    }
  }

  // --- Live Waveform ---
  private startLiveWaveform(): void {
    if (!this.stream) return;

    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 2048;
    source.connect(this.analyserNode);

    this.waveformDataArray = new Uint8Array(this.analyserNode.frequencyBinCount);

    const draw = () => {
      if (!this.isRecording || !this.analyserNode || !this.waveformDataArray || !this.liveWaveformCtx) {
        return;
      }
      
      this.analyserNode.getByteTimeDomainData(this.waveformDataArray);
      
      const canvas = this.liveWaveformCtx.canvas;
      this.liveWaveformCtx.clearRect(0, 0, canvas.width, canvas.height);
      
      const isDarkMode = !document.body.classList.contains('light-mode');
      this.liveWaveformCtx.strokeStyle = isDarkMode ? '#82aaff' : '#007AFF';
      this.liveWaveformCtx.lineWidth = 2;

      this.liveWaveformCtx.beginPath();
      const sliceWidth = canvas.width * 1.0 / this.waveformDataArray.length;
      let x = 0;

      for (let i = 0; i < this.waveformDataArray.length; i++) {
        const v = this.waveformDataArray[i] / 128.0;
        const y = v * canvas.height / 2;
        if (i === 0) {
          this.liveWaveformCtx.moveTo(x, y);
        } else {
          this.liveWaveformCtx.lineTo(x, y);
        }
        x += sliceWidth;
      }
      
      this.liveWaveformCtx.lineTo(canvas.width, canvas.height / 2);
      this.liveWaveformCtx.stroke();
      
      this.waveformDrawingId = requestAnimationFrame(draw);
    };

    draw();
  }

  private stopLiveWaveform(): void {
    if (this.waveformDrawingId) {
      cancelAnimationFrame(this.waveformDrawingId);
      this.waveformDrawingId = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    if (this.liveWaveformCtx) {
        setTimeout(() => {
            this.liveWaveformCtx?.clearRect(0, 0, this.liveWaveformCanvas.width, this.liveWaveformCanvas.height);
        }, 100);
    }
  }
  
  // --- Timers ---
  private startTimer(): void {
    this.recordingStartTime = Date.now();
    this.stopTimer(); // Clear any existing timer

    this.timerIntervalId = window.setInterval(() => {
      const elapsedTime = Date.now() - this.recordingStartTime;
      const formattedTimeMs = this.formatTime(elapsedTime, true);
      this.liveRecordingTimerDisplay.textContent = formattedTimeMs;
    }, 20); // Update frequently for smooth ms display
  }

  private stopTimer(): void {
    if (this.timerIntervalId) {
      clearInterval(this.timerIntervalId);
      this.timerIntervalId = null;
    }
  }

  // --- Audio Playback (in Editor) ---
  private renderAudioPlaybackUI(note: Note | null): void {
      if (note && (note.audioUrl || note.audioData) && note.audioDuration) {
          this.audioPlaybackContainer.style.display = 'flex';
          this.playbackTitle.textContent = note.title;
          this.playbackDate.textContent = new Date(note.timestamp).toLocaleDateString(undefined, {
              month: 'long', day: 'numeric', year: 'numeric'
          });
          this.playbackDurationDisplay.textContent = this.formatTime(note.audioDuration);

          // If URL doesn't exist (e.g., from page load), create it from base64 data
          if (!note.audioUrl && note.audioData && note.audioMimeType) {
              const audioBlob = this.base64ToBlob(note.audioData, note.audioMimeType);
              note.audioUrl = URL.createObjectURL(audioBlob);
          }
          
          if (this.noteAudioPlayer.src !== note.audioUrl) {
            this.noteAudioPlayer.src = note.audioUrl!;
          }

          this.isPlaybackUiActive = true;
          this.handleNotePlaybackEnded();

      } else {
          this.audioPlaybackContainer.style.display = 'none';
          this.isPlaybackUiActive = false;
          if (this.noteAudioPlayer.src) {
            this.noteAudioPlayer.pause();
            this.noteAudioPlayer.src = '';
          }
      }
  }

  private toggleNotePlayback(): void {
    if (this.noteAudioPlayer.paused) {
        this.noteAudioPlayer.play();
    } else {
        this.noteAudioPlayer.pause();
    }
  }

  private seekNotePlayback(seconds: number): void {
      this.noteAudioPlayer.currentTime = Math.max(0, this.noteAudioPlayer.currentTime + seconds);
  }

  private updatePlaybackTime(): void {
      if (!this.isPlaybackUiActive || !isFinite(this.noteAudioPlayer.duration)) return;
      this.playbackTimeDisplay.textContent = `${this.formatTime(this.noteAudioPlayer.currentTime * 1000)} / ${this.formatTime(this.noteAudioPlayer.duration * 1000)}`;
  }
  
  private handleNotePlaybackEnded(): void {
    this.updatePlaybackButton(false);
    this.audioPlaybackContainer.classList.remove('state-playing');
    this.audioPlaybackContainer.classList.add('state-pre-play');
  }

  private updatePlaybackButton(isPlaying: boolean): void {
    if (!this.isPlaybackUiActive) return;
    this.playbackPlayIcon.style.display = isPlaying ? 'none' : 'inline-block';
    this.playbackPauseIcon.style.display = isPlaying ? 'inline-block' : 'none';
    if(isPlaying) {
        this.audioPlaybackContainer.classList.remove('state-pre-play');
        this.audioPlaybackContainer.classList.add('state-playing');
    }
  }


  // --- Lyriq Player ---
  private loadNoteIntoLyriqPlayer(): void {
      if (!this.currentNoteId) {
          // If no note is active, find the most recent one
          const sortedNotes = [...this.notes.values()].sort((a,b) => b.timestamp - a.timestamp);
          if (sortedNotes.length > 0) {
              this.currentNoteId = sortedNotes[0].id;
          } else {
              // Handle case with no notes at all
              this.lyriqSongTitle.textContent = 'No Note Selected';
              this.lyricsContainer.innerHTML = '<p class="lyriq-line placeholder">Create or select a note to see lyrics here.</p>';
              return;
          }
      }

      const note = this.notes.get(this.currentNoteId);
      if (!note) return;

      this.lyriqSongTitle.textContent = note.title;
      this.lyriqSongSubtitle.textContent = new Date(note.timestamp).toLocaleDateString();

      const lyricsText = note.editorFormat === 'open' ? note.polishedNote : this.flattenSections(note.sections);

      if (!lyricsText.trim()) {
        this.lyricsContainer.innerHTML = '<p class="lyriq-line placeholder">This note is empty. Add some lyrics or record audio to get started.</p>';
        this.lyricsData = [];
        return;
      }
      
      // A simple placeholder for lyrics display. A real implementation would parse LRC or similar.
      this.lyricsData = lyricsText.split('\n').map((line, index) => ({
        time: index * 5, // Dummy timing
        line: line.trim()
      })).filter(l => l.line);

      this.lyricsContainer.innerHTML = this.lyricsData
        .map(l => `<p class="lyriq-line">${l.line}</p>`)
        .join('');
  }

  private async handleLyriqFileUpload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const url = URL.createObjectURL(file);
      this.lyriqAudioPlayer.src = url;
      
      const trackButton = this.lyriqAddBeatBtn;
      const icon = trackButton.querySelector('i');
      
      if(icon) icon.className = 'fas fa-check-circle';
      trackButton.classList.add('active');

      this.setLyriqModalState('visible');

      // Process and draw waveform
      try {
        const arrayBuffer = await file.arrayBuffer();
        const audioContext = new AudioContext();
        this.beatAudioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        // Resize canvas based on audio duration for scrolling effect
        const canvasWidth = this.beatAudioBuffer.duration * this.PIXELS_PER_SECOND;
        this.beatWaveformCanvas.width = canvasWidth;
        this.vocalWaveformCanvas.width = canvasWidth;

        this.renderBeatWaveform();
      } catch (e) {
        console.error("Error processing audio file:", e);
      }
    }
  }

  private toggleLyriqPlayback(): void {
      if (!this.lyriqAudioPlayer.src) return;
  
      const icon = this.lyriqModalPlayBtn.querySelector('i');
      if (this.lyriqIsPlaying) {
          this.lyriqAudioPlayer.pause();
          if (this.lyriqVocalAudioPlayer.src) this.lyriqVocalAudioPlayer.pause();
          if(icon) icon.className = 'fas fa-play';
          this.stopLyriqAnimation();
      } else {
          this.lyriqAudioPlayer.play();
          if (this.lyriqVocalAudioPlayer.src) this.lyriqVocalAudioPlayer.play();
          if(icon) icon.className = 'fas fa-pause';
          this.startLyriqAnimation();
      }
      this.lyriqIsPlaying = !this.lyriqIsPlaying;
  }
  
  private handleLyriqMetadataLoaded(): void {
    this.syncLyrics();
  }

  private syncLyrics(): void {
    if (!this.lyriqAudioPlayer.duration) return;

    const currentTime = this.lyriqAudioPlayer.currentTime;

    // Find the current lyric line
    let currentLine = -1;
    for (let i = this.lyricsData.length - 1; i >= 0; i--) {
        if (currentTime >= this.lyricsData[i].time) {
            currentLine = i;
            break;
        }
    }

    if (currentLine !== this.lyriqCurrentLineIndex) {
        this.lyriqCurrentLineIndex = currentLine;
        const lines = this.lyricsContainer.querySelectorAll('.lyriq-line');
        lines.forEach((line, index) => {
            if (index === currentLine) {
                line.classList.add('active');
                line.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
                line.classList.remove('active');
            }
        });
    }
  }

  private handleLyriqEnded(): void {
    this.lyriqIsPlaying = false;
    if (this.isRecording) {
      this.toggleRecording();
    }
    this.stopLyriqAnimation();
    const icon = this.lyriqModalPlayBtn.querySelector('i');
    if (icon) icon.className = 'fas fa-play';
    this.updatePlayheadPosition(0);
  }
  
  private setActiveMixerTrack(track: MixerTrack): void {
      this.activeMixerTrack = track;
      this.lyriqAddBeatBtn.classList.toggle('active', track === 'beat');
      this.lyriqVocalIndicator.classList.toggle('active', track === 'vocal');

      // Update slider to reflect the active track's volume
      if (track === 'beat') {
          this.lyriqVolumeSlider.value = this.lyriqAudioPlayer.volume.toString();
      } else if (track === 'vocal') {
          this.lyriqVolumeSlider.value = this.lyriqVocalAudioPlayer.volume.toString();
      }
      this.updateVolumeUI();
  }

  private toggleLyriqMute(): void {
      const activePlayer = this.activeMixerTrack === 'beat' ? this.lyriqAudioPlayer : this.lyriqVocalAudioPlayer;
      activePlayer.muted = !activePlayer.muted;
      this.updateVolumeUI();
  }

  private handleVolumeChange(): void {
      const newVolume = parseFloat(this.lyriqVolumeSlider.value);
      if (this.activeMixerTrack === 'beat') {
          this.lyriqAudioPlayer.volume = newVolume;
          this.lyriqAudioPlayer.muted = false;
      } else {
          this.lyriqVocalAudioPlayer.volume = newVolume;
          this.lyriqVocalAudioPlayer.muted = false;
      }
      this.updateVolumeUI();
  }

  private updateVolumeUI(): void {
      if (!this.lyriqVolumeSlider) return;
      const activePlayer = this.activeMixerTrack === 'beat' ? this.lyriqAudioPlayer : this.lyriqVocalAudioPlayer;
      const volume = activePlayer.muted ? 0 : activePlayer.volume;
      
      this.lyriqVolumeSlider.value = volume.toString();
      
      const icon = this.lyriqVolumeBtn.querySelector('i')!;
      if (volume === 0) {
          icon.className = 'fas fa-volume-mute';
      } else if (volume <= 0.5) {
          icon.className = 'fas fa-volume-down';
      } else {
          icon.className = 'fas fa-volume-up';
      }
  }

  // --- Context Menu ---
  private showNoteContextMenu(e: MouseEvent, explicitNoteId?: string): void {
      e.preventDefault();
      e.stopPropagation();

      const target = e.target as HTMLElement;
      const noteItem = target.closest<HTMLElement>('.sidebar-note-item, .note-card');

      const noteId = explicitNoteId || noteItem?.dataset.noteId;
      if (!noteId) return;

      this.contextMenu.style.top = `${e.clientY}px`;
      this.contextMenu.style.left = `${e.clientX}px`;
      this.contextMenu.style.display = 'block';

      this.contextMenu.innerHTML = `
        <ul class="context-menu-list">
          <li><button class="context-menu-item" data-action="rename"><i class="fas fa-pencil-alt"></i>Rename</button></li>
          <li class="context-menu-separator"></li>
          <li><button class="context-menu-item delete" data-action="delete"><i class="fas fa-trash-alt"></i>Delete Note</button></li>
        </ul>
      `;

      this.contextMenu.onclick = (event) => {
          const actionTarget = (event.target as HTMLElement).closest<HTMLButtonElement>('.context-menu-item');
          if (actionTarget) {
              const action = actionTarget.dataset.action;
              if (action === 'delete') {
                  if (confirm('Are you sure you want to delete this note?')) {
                      if (noteItem && noteItem.classList.contains('note-card')) {
                          noteItem.classList.add('deleting');
                          setTimeout(() => this.deleteNote(noteId), 400);
                      } else {
                          this.deleteNote(noteId);
                      }
                  }
              } else if (action === 'rename') {
                  this.renameNote(noteId);
              }
              this.hideContextMenu();
          }
      };
  }

  private hideContextMenu(): void {
      if (this.contextMenu) {
          this.contextMenu.style.display = 'none';
      }
  }

  private handleNoteTouchStart(e: TouchEvent, explicitNoteId?: string): void {
      this.handleNoteTouchEnd(); // Clear any existing timer
      const target = e.target as HTMLElement;
      const noteItem = target.closest<HTMLElement>('.sidebar-note-item, .note-card');
      const noteId = explicitNoteId || noteItem?.dataset.noteId;
      
      if (!noteId) return;
      
      this.longPressTimer = window.setTimeout(() => {
          e.preventDefault(); // Prevent scrolling and other default actions
          const touch = e.touches[0];
          this.showNoteContextMenu({
              preventDefault: () => {},
              stopPropagation: () => {},
              target: touch.target,
              clientX: touch.clientX,
              clientY: touch.clientY,
          } as any, noteId);
          this.longPressTimer = null;
      }, this.LONG_PRESS_DURATION);
  }

  private handleNoteTouchEnd(): void {
      if (this.longPressTimer) {
          clearTimeout(this.longPressTimer);
          this.longPressTimer = null;
      }
  }

  // --- Lyriq Modal & Waveform ---

  private setLyriqModalState(state: 'visible' | 'peeking' | 'hidden'): void {
    this.lyriqControlsModal.classList.remove('visible', 'peeking');
    this.lyriqControlsModal.style.transform = ''; // Reset any inline styles from dragging
    if (state === 'visible' || state === 'peeking') {
        this.lyriqControlsModal.classList.add(state);

        if (state === 'visible' && this.beatAudioBuffer) {
            // Recalculate canvas size if it becomes fully visible
            setTimeout(() => {
              this.renderBeatWaveform();
              this.renderVocalWaveform();
            }, 50); // allow transition to start
        }
    }
  }

  private getPointerY(e: MouseEvent | TouchEvent): number {
    return e.type.startsWith('touch') ? (e as TouchEvent).touches[0].clientY : (e as MouseEvent).clientY;
  }
  
  private getPointerX(e: MouseEvent | TouchEvent): number {
    const target = e.target as HTMLElement;
    const rect = target.getBoundingClientRect();
    const x = e.type.startsWith('touch') ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX;
    return x - rect.left;
  }

  private handleModalDragStart(e: MouseEvent | TouchEvent): void {
      if (e instanceof MouseEvent && e.button !== 0) return; // Only drag with left mouse button

      const isVisible = this.lyriqControlsModal.classList.contains('visible');
      const isPeeking = this.lyriqControlsModal.classList.contains('peeking');
      const targetOnHandle = (e.target as HTMLElement).closest('.lyriq-modal-handle-container');

      // Allow dragging from the handle when visible, or anywhere on the modal when peeking.
      if ((isVisible && targetOnHandle) || isPeeking) {
          this.isDraggingModal = true;
          this.modalDragStartY = this.getPointerY(e);
          const style = window.getComputedStyle(this.lyriqControlsModal);
          const matrix = new DOMMatrix(style.transform);
          this.modalDragStartTranslateY = matrix.m42;
          this.lyriqControlsModal.style.transition = 'none';
      }
  }

  private handleModalDragMove(e: MouseEvent | TouchEvent): void {
      if (!this.isDraggingModal) return;
      e.preventDefault();
      const currentY = this.getPointerY(e);
      const deltaY = currentY - this.modalDragStartY;
      let newTranslateY = this.modalDragStartTranslateY + deltaY;
      if (newTranslateY < 0) newTranslateY = 0; // Prevent dragging above the top
      this.lyriqControlsModal.style.transform = `translateY(${newTranslateY}px)`;
  }

  private handleModalDragEnd(e: MouseEvent | TouchEvent): void {
      if (!this.isDraggingModal) return;
      this.isDraggingModal = false;

      const wasPeeking = this.modalDragStartTranslateY > 0;
      const style = window.getComputedStyle(this.lyriqControlsModal);
      const matrix = new DOMMatrix(style.transform);
      const currentTranslateY = matrix.m42;
      const deltaY = currentTranslateY - this.modalDragStartTranslateY;

      // A small delta shouldn't change state (it's a tap, not a drag)
      if (Math.abs(deltaY) < 10) {
          if (wasPeeking) this.setLyriqModalState('visible'); // Tap on peeking modal makes it visible
          else this.setLyriqModalState('visible'); // On desktop, a simple click might register as a small drag
          return;
      }

      if (wasPeeking) {
          // If dragging up (negative delta), become visible
          if (deltaY < -50) { // Dragged up more than 50px
              this.setLyriqModalState('visible');
          } else {
              this.setLyriqModalState('peeking');
          }
      } else { // Was visible
          // If dragging down (positive delta), become peeking
          if (deltaY > 50) { // Dragged down more than 50px
              this.setLyriqModalState('peeking');
          } else {
              this.setLyriqModalState('visible');
          }
      }
  }

  private handleScrubStart(e: MouseEvent | TouchEvent): void {
    if (!this.beatAudioBuffer) return;
    this.isScrubbing = true;
    this.handleScrubMove(e); // Seek immediately on click
  }

  private handleScrubMove(e: MouseEvent | TouchEvent): void {
    if (!this.isScrubbing || !this.beatAudioBuffer) return;

    // Prevent text selection during drag on desktop and default scroll on mobile.
    e.preventDefault();
    
    const waveformRect = this.lyriqWaveforms.getBoundingClientRect();
    const x = e.type.startsWith('touch') ? (e as TouchEvent).touches[0].clientX - waveformRect.left : (e as MouseEvent).clientX - waveformRect.left;
    const viewWidth = waveformRect.width;

    // Calculate time based on the current scroll position (derived from currentTime)
    // and the click offset from the center playhead.
    const currentPixelOffset = this.lyriqAudioPlayer.currentTime * this.PIXELS_PER_SECOND;

    // The pixel offset of the click from the center playhead
    const pixelOffsetFromPlayhead = x - (viewWidth / 2);
    
    // The target pixel position on the entire timeline
    const targetPixel = currentPixelOffset + pixelOffsetFromPlayhead;

    // Convert target pixel back to time
    const targetTime = targetPixel / this.PIXELS_PER_SECOND;

    this.updatePlayheadPosition(targetTime);
  }
  
  private handleScrubEnd(): void {
    this.isScrubbing = false;
  }

  private updatePlayheadPosition(timeInSeconds: number): void {
    if (!this.lyriqAudioPlayer.duration || !isFinite(this.lyriqAudioPlayer.duration)) return;

    // Clamp the time to valid bounds
    const newTime = Math.max(0, Math.min(timeInSeconds, this.lyriqAudioPlayer.duration));

    // Only update if the change is significant to avoid stuttering on small drags.
    if (Math.abs(newTime - this.lyriqAudioPlayer.currentTime) > 0.01) {
      this.lyriqAudioPlayer.currentTime = newTime;
      if (this.lyriqVocalAudioPlayer.src) {
          this.lyriqVocalAudioPlayer.currentTime = newTime;
      }
    }
    
    // Update visual transform of waveforms
    const currentPixelOffset = newTime * this.PIXELS_PER_SECOND;
    const viewWidth = this.lyriqWaveforms.getBoundingClientRect().width;
    const translateX = (viewWidth / 2) - currentPixelOffset;

    this.beatWaveformCanvas.style.transform = `translateX(${translateX}px)`;
    this.vocalWaveformCanvas.style.transform = `translateX(${translateX}px)`;
    
    // Update time display
    this.lyriqModalTime.textContent = this.formatTime(newTime * 1000).split('.')[0];
  }

  private renderBeatWaveform(): void {
    this.renderWaveform(this.beatAudioBuffer, this.beatWaveformCtx, '#A880F7');
  }

  private renderVocalWaveform(): void {
    this.renderWaveform(this.vocalAudioBuffer, this.vocalWaveformCtx, '#ff453a');
  }

  private renderWaveform(buffer: AudioBuffer | null, ctx: CanvasRenderingContext2D | null, color: string): void {
    if (!buffer || !ctx) return;
    const canvas = ctx.canvas;
    
    const { height } = canvas.getBoundingClientRect();
    if (canvas.height !== height) {
        canvas.height = height;
    }
    
    const data = buffer.getChannelData(0);
    const step = Math.ceil(data.length / canvas.width);
    const amp = canvas.height / 2;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < canvas.width; i++) {
        let min = 1.0;
        let max = -1.0;
        for (let j = 0; j < step; j++) {
            const datum = data[(i * step) + j];
            if (datum < min) min = datum;
            if (datum > max) max = datum;
        }
        ctx.moveTo(i, (1 + min) * amp);
        ctx.lineTo(i, (1 + max) * amp);
    }
    ctx.stroke();
  }
  
  private async processAndRenderVocalWaveform(blob: Blob): Promise<void> {
    try {
      const arrayBuffer = await blob.arrayBuffer();
      // Use a temporary AudioContext to avoid conflicts
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.vocalAudioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      audioContext.close(); // Clean up immediately
      this.renderVocalWaveform();
    } catch (e) {
      console.error("Error processing vocal audio file:", e);
      this.vocalAudioBuffer = null;
    }
  }


  private startLyriqAnimation(): void {
      if (this.lyriqAnimationId) {
          cancelAnimationFrame(this.lyriqAnimationId);
      }

      const animate = () => {
          if (!this.lyriqIsPlaying && !this.isRecording) {
              this.stopLyriqAnimation();
              return;
          }
          
          // If the user is actively scrubbing, let handleScrubMove take over position updates
          // to avoid conflicting state changes.
          if (this.isScrubbing) {
              this.lyriqAnimationId = requestAnimationFrame(animate); // Keep the loop alive
              return;
          }

          this.updatePlayheadPosition(this.lyriqAudioPlayer.currentTime);
          this.lyriqAnimationId = requestAnimationFrame(animate);
      };

      this.lyriqAnimationId = requestAnimationFrame(animate);
  }

  private stopLyriqAnimation(): void {
      if (this.lyriqAnimationId) {
          cancelAnimationFrame(this.lyriqAnimationId);
          this.lyriqAnimationId = null;
      }
  }

  // --- Undo/Redo History Management ---
  private getNoteState(note: Note): NoteState {
    return {
      title: note.title,
      // Deep copy of sections array to prevent mutation issues
      sections: JSON.parse(JSON.stringify(note.sections)),
      polishedNote: note.polishedNote,
      editorFormat: note.editorFormat,
    };
  }
  
  private applyNoteState(noteId: string, state: NoteState): void {
    const note = this.notes.get(noteId);
    if (!note) return;

    note.title = state.title;
    note.sections = JSON.parse(JSON.stringify(state.sections));
    note.polishedNote = state.polishedNote;
    note.editorFormat = state.editorFormat;

    // If the currently active note is the one we're updating, re-render its content.
    if (this.currentNoteId === noteId) {
        this.editorTitle.textContent = note.title;
        this.renderNoteContent(note);
    }
    
    this.saveDataToStorage();
    this.renderSidebar(); // Update title in sidebar
  }

  private saveNoteState(): void {
    if (!this.currentNoteId) return;
    
    this.updateCurrentNoteContent(); // Ensure latest content from DOM is in the note object
    const note = this.notes.get(this.currentNoteId);
    const history = this.noteHistories.get(this.currentNoteId);

    if (!note || !history) return;
    
    const newState = this.getNoteState(note);
    const lastState = history.undo[history.undo.length - 1];

    // Avoid saving identical subsequent states
    if (lastState && JSON.stringify(newState) === JSON.stringify(lastState)) {
      return;
    }
    
    history.undo.push(newState);
    history.redo = []; // Clear redo stack on new action
    this.updateUndoRedoButtons();
  }

  private debouncedSaveState = () => {
      if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = window.setTimeout(() => {
          this.saveNoteState();
      }, 1000);
  }

  private undo(): void {
    if (!this.currentNoteId) return;
    const history = this.noteHistories.get(this.currentNoteId);
    if (!history || history.undo.length <= 1) return; // Keep the initial state

    const currentState = history.undo.pop()!;
    history.redo.push(currentState);
    
    const previousState = history.undo[history.undo.length - 1];
    this.applyNoteState(this.currentNoteId, previousState);
    this.updateUndoRedoButtons();
  }

  private redo(): void {
    if (!this.currentNoteId) return;
    const history = this.noteHistories.get(this.currentNoteId);
    if (!history || history.redo.length === 0) return;

    const nextState = history.redo.pop()!;
    history.undo.push(nextState);
    
    this.applyNoteState(this.currentNoteId, nextState);
    this.updateUndoRedoButtons();
  }
  
  private updateUndoRedoButtons(): void {
      if (!this.currentNoteId) {
          this.undoButton.disabled = true;
          this.redoButton.disabled = true;
          return;
      }
      const history = this.noteHistories.get(this.currentNoteId);
      this.undoButton.disabled = !history || history.undo.length <= 1;
      this.redoButton.disabled = !history || history.redo.length === 0;
  }
  
  private handleKeyDown(e: KeyboardEvent): void {
    const isModKey = e.metaKey || e.ctrlKey;
    if (!isModKey || this.activeView !== 'editor') return;

    if (e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
            this.redo();
        } else {
            this.undo();
        }
    } else if (e.key === 'y') {
        e.preventDefault();
        this.redo();
    }
  }


  // --- Utility functions ---
  private getAudioDuration(url: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const audio = new Audio();
        audio.addEventListener('loadedmetadata', () => {
            resolve(audio.duration * 1000); // return duration in milliseconds
        });
        audio.addEventListener('error', (e) => {
            console.error("Error loading audio metadata:", e);
            reject(new Error("Could not load audio metadata."));
        });
        audio.src = url; // Set src last to ensure listeners are attached
    });
  }

  private async blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  
  private base64ToBlob(base64: string, mimeType: string): Blob {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  }

  private formatTime(ms: number, includeMilliseconds: boolean = false): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60).toString();
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    if (includeMilliseconds) {
      const milliseconds = Math.floor((ms % 1000) / 10).toString().padStart(2, '0');
      return `${minutes.padStart(2, '0')}:${seconds}.${milliseconds}`;
    }
    return `${minutes.padStart(2, '0')}:${seconds}`;
  }

  private updatePlaceholderVisibility(element: HTMLElement) {
    if (element.textContent?.trim()) {
      element.classList.remove('placeholder-active');
    } else {
      element.classList.add('placeholder-active');
    }
  }

  private setFinalStatus(message: string, isError: boolean = false): void {
    document.body.classList.remove('is-processing');
    this.recordingStatus.textContent = message;
    setTimeout(() => {
        if (!this.isRecording) {
            this.recordingStatus.textContent = 'Ready to record';
        }
    }, 4000);
  }

  private handleOutsideClick(e: MouseEvent): void {
    if (this.isMobile && !this.appContainer.classList.contains('sidebar-collapsed')) {
        const target = e.target as HTMLElement;
        // If the click is not on the sidebar or the toggle button that opens it, then close it.
        if (!this.sidebar.contains(target) && !this.sidebarToggleButton.contains(target)) {
            this.appContainer.classList.add('sidebar-collapsed');
        }
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new VoiceNotesApp();
});
