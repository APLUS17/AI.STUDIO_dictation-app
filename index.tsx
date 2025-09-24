/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/* tslint:disable */

import {GoogleGenAI, Type} from '@google/genai';
import {marked} from 'marked';

const MODEL_NAME = 'gemini-2.5-flash';

// Interfaces for data structures
interface AudioTake {
  id: string;
  url: string | null;
  data: string | null; // base64
  mimeType: string | null;
  duration: number | null; // ms
  timestamp: number;
}

interface NoteSection {
  type: string;
  content: string;
  takes: AudioTake[];
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
  syncedLyrics: { time: number; line: string }[] | null;
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
  private isPaused = false;
  private isProcessing = false;
  private stream: MediaStream | null = null;
  private recordingTargetSectionIndex: number | null = null;

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
  private recordButtonText: HTMLSpanElement;
  private recordingStatus: HTMLDivElement;
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
  private startRecordingFab: HTMLButtonElement;

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
  
  // Card drag/swipe state
  private draggedElement: HTMLElement | null = null;
  private placeholder: HTMLElement | null = null;
  private isSwiping = false;
  private swipeStartX = 0;
  private swipeCurrentX = 0;
  private swipedCardContainer: HTMLElement | null = null;

  // Recording interface elements
  private recordingInterface: HTMLDivElement;
  private recordingInterfaceHandle: HTMLDivElement;
  private finishRecordingButton: HTMLButtonElement;
  private liveRecordingTitle: HTMLDivElement;
  private liveWaveformCanvas: HTMLCanvasElement;
  private liveWaveformCtx: CanvasRenderingContext2D | null;
  private liveRecordingTimerDisplay: HTMLDivElement;
  private recordingPeekIndicator: HTMLDivElement;
  
  // Notes List View elements
  private notesListView: HTMLDivElement;
  private notesListContent: HTMLDivElement;
  private ideasTabsContainer: HTMLDivElement;
  private listViewNewNoteFab: HTMLButtonElement;

  // Note Audio Playback elements
  private takesAudioPlayer: HTMLAudioElement;

  // Lyriq Player elements and state
  private lyriqPlayerView: HTMLDivElement;
  private lyriqPlayerButton: HTMLAnchorElement;
  private lyriqSidebarToggleButton: HTMLButtonElement;
  private audioUploadInput: HTMLInputElement;
  private lyriqAudioPlayer: HTMLAudioElement;
  private lyriqVocalAudioPlayer: HTMLAudioElement;
  private lyricsContainer: HTMLDivElement;
  private lyriqSongTitle: HTMLHeadingElement;
  private lyriqSongSubtitle: HTMLHeadingElement;
  private lyriqInitialControls: HTMLDivElement;
  private lyriqInitialAddBeatBtn: HTMLButtonElement;
  private lyriqInitialRecordBtn: HTMLButtonElement;
  private lyriqVolumeSlider: HTMLInputElement;
  
  // Lyriq Modal: Peek Header
  private lyriqModalPeekPlayBtn: HTMLButtonElement;
  private lyriqModalRewindBtn: HTMLButtonElement;
  private lyriqModalForwardBtn: HTMLButtonElement;
  private lyriqModalPeekTitle: HTMLHeadingElement;
  private lyriqModalTime: HTMLSpanElement;

  // Lyriq Modal: Expanded View
  private lyriqExpandedTime: HTMLSpanElement;
  private lyriqExpandedAddBeatBtn: HTMLButtonElement;
  private lyriqExpandedVocalBtn: HTMLButtonElement;
  private lyriqExpandedVolumeBtn: HTMLButtonElement;
  private lyriqExpandedRecordBtn: HTMLButtonElement;
  private lyriqExpandedPlayBtn: HTMLButtonElement;

  // Lyriq Modal: Core
  private lyriqControlsModal: HTMLDivElement;
  private lyriqModalHandle: HTMLDivElement;
  private lyriqWaveforms: HTMLDivElement;
  private beatWaveformCanvas: HTMLCanvasElement;
  private vocalWaveformCanvas: HTMLCanvasElement;
  private lyriqPlayhead: HTMLDivElement;
  private beatWaveformCtx: CanvasRenderingContext2D | null;
  private vocalWaveformCtx: CanvasRenderingContext2D | null;

  private beatAudioBuffer: AudioBuffer | null = null;
  private vocalAudioBuffer: AudioBuffer | null = null;
  
  // Scrubbing State
  private isScrubbing = false;
  private scrubStartX = 0;
  private scrubStartScrollLeft = 0;

  private lyriqIsPlaying = false;
  private lyriqCurrentLineIndex = -1;
  private lyricsData: { time: number; line: string }[] = [];
  private activeMixerTrack: MixerTrack = 'beat';
  private vocalBlobForMaster: Blob | null = null;
  
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
    this.recordButtonText = document.getElementById('recordButtonText') as HTMLSpanElement;
    this.recordingStatus = document.getElementById('recordingStatus') as HTMLDivElement;
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
    this.startRecordingFab = document.getElementById('startRecordingFab') as HTMLButtonElement;
    
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
    this.recordingInterface = document.getElementById('recordingInterface') as HTMLDivElement;
    this.recordingInterfaceHandle = document.getElementById('recordingInterfaceHandle') as HTMLDivElement;
    this.finishRecordingButton = document.getElementById('finishRecordingButton') as HTMLButtonElement;
    this.liveRecordingTitle = document.getElementById('liveRecordingTitle') as HTMLDivElement;
    this.liveWaveformCanvas = document.getElementById('liveWaveformCanvas') as HTMLCanvasElement;
    this.liveRecordingTimerDisplay = document.getElementById('liveRecordingTimerDisplay') as HTMLDivElement;
    this.recordingPeekIndicator = this.recordingInterface.querySelector('.recording-peek-indicator') as HTMLDivElement;
    this.liveWaveformCtx = this.liveWaveformCanvas.getContext('2d');
    
    // Notes List View elements
    this.notesListView = document.querySelector('.notes-list-view') as HTMLDivElement;
    this.notesListContent = document.querySelector('.notes-list-content') as HTMLDivElement;
    this.ideasTabsContainer = document.querySelector('.ideas-tabs') as HTMLDivElement;
    this.listViewNewNoteFab = document.querySelector('.list-view-new-note-fab') as HTMLButtonElement;

    // Note Audio Playback elements
    this.takesAudioPlayer = new Audio();
    
    // Lyriq Player elements
    this.lyriqPlayerView = document.querySelector('.lyriq-player-view') as HTMLDivElement;
    this.lyriqPlayerButton = document.getElementById('lyriqPlayerButton') as HTMLAnchorElement;
    this.lyriqSidebarToggleButton = document.getElementById('lyriqSidebarToggleButton') as HTMLButtonElement;
    this.audioUploadInput = document.getElementById('audioUpload') as HTMLInputElement;
    this.lyriqAudioPlayer = document.getElementById('lyriqAudio') as HTMLAudioElement;
    this.lyriqVocalAudioPlayer = document.getElementById('lyriqVocalAudio') as HTMLAudioElement;
    this.lyricsContainer = document.getElementById('lyricsContainer') as HTMLDivElement;
    this.lyriqSongTitle = document.getElementById('lyriqSongTitle') as HTMLHeadingElement;
    this.lyriqSongSubtitle = document.getElementById('lyriqSongSubtitle') as HTMLHeadingElement;
    this.lyriqInitialControls = document.getElementById('lyriqInitialControls') as HTMLDivElement;
    this.lyriqInitialAddBeatBtn = document.getElementById('lyriqInitialAddBeatBtn') as HTMLButtonElement;
    this.lyriqInitialRecordBtn = document.getElementById('lyriqInitialRecordBtn') as HTMLButtonElement;
    this.lyriqVolumeSlider = document.getElementById('lyriqVolumeSlider') as HTMLInputElement;

    // Lyriq Modal: Peek Header
    this.lyriqModalPeekPlayBtn = document.getElementById('lyriqModalPeekPlayBtn') as HTMLButtonElement;
    this.lyriqModalRewindBtn = document.getElementById('lyriqModalRewindBtn') as HTMLButtonElement;
    this.lyriqModalForwardBtn = document.getElementById('lyriqModalForwardBtn') as HTMLButtonElement;
    this.lyriqModalPeekTitle = document.getElementById('lyriqModalPeekTitle') as HTMLHeadingElement;
    this.lyriqModalTime = document.getElementById('lyriqModalTime') as HTMLSpanElement;

    // Lyriq Modal: Expanded View
    this.lyriqExpandedTime = document.getElementById('lyriqExpandedTime') as HTMLSpanElement;
    this.lyriqExpandedAddBeatBtn = document.getElementById('lyriqExpandedAddBeatBtn') as HTMLButtonElement;
    this.lyriqExpandedVocalBtn = document.getElementById('lyriqExpandedVocalBtn') as HTMLButtonElement;
    this.lyriqExpandedVolumeBtn = document.getElementById('lyriqExpandedVolumeBtn') as HTMLButtonElement;
    this.lyriqExpandedRecordBtn = document.getElementById('lyriqExpandedRecordBtn') as HTMLButtonElement;
    this.lyriqExpandedPlayBtn = document.getElementById('lyriqExpandedPlayBtn') as HTMLButtonElement;
    
    // Lyriq Modal: Core
    this.lyriqControlsModal = document.getElementById('lyriqControlsModal') as HTMLDivElement;
    this.lyriqModalHandle = document.getElementById('lyriqModalHandle') as HTMLDivElement;
    this.lyriqWaveforms = this.lyriqControlsModal.querySelector('.lyriq-waveforms') as HTMLDivElement;
    this.beatWaveformCanvas = document.getElementById('beatWaveformCanvas') as HTMLCanvasElement;
    this.vocalWaveformCanvas = document.getElementById('vocalWaveformCanvas') as HTMLCanvasElement;
    this.lyriqPlayhead = document.getElementById('lyriqPlayhead') as HTMLDivElement;
    this.beatWaveformCtx = this.beatWaveformCanvas.getContext('2d');
    this.vocalWaveformCtx = this.vocalWaveformCanvas.getContext('2d');

    // Initial setup
    this.bindEventListeners();
    this.setAppHeight();
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
    this.startRecordingFab.addEventListener('click', () => { this.triggerHapticFeedback(); this.toggleRecording(); });
    this.recordButton.addEventListener('click', () => { this.triggerHapticFeedback(); this.toggleRecording(); });
    this.finishRecordingButton.addEventListener('click', () => { this.triggerHapticFeedback(); this.finishRecording(); });
    this.themeToggleButton.addEventListener('click', () => { this.triggerHapticFeedback(); this.toggleTheme(); });
    this.formatToggleButton.addEventListener('click', () => { this.triggerHapticFeedback(); this.handleFormatToggle(); });
    this.sendToLyriqButton.addEventListener('click', () => { this.triggerHapticFeedback(); this.setActiveView('lyriq'); });
    this.undoButton.addEventListener('click', () => { this.triggerHapticFeedback(); this.undo(); });
    this.redoButton.addEventListener('click', () => { this.triggerHapticFeedback(); this.redo(); });

    // Sidebar controls
    this.sidebarToggleButton.addEventListener('click', () => { this.triggerHapticFeedback(); this.toggleSidebar(); });
    this.sidebarNewNoteButton.addEventListener('click', async () => {
        this.triggerHapticFeedback();
        await this.createNewNote();
        this.setActiveView('editor');
    });
    this.allNotesButton.addEventListener('click', (e) => {
        this.triggerHapticFeedback();
        e.preventDefault();
        this.setActiveView('list');
    });

    // Editor controls
    this.editorTitle.addEventListener('blur', () => { this.updateCurrentNoteContent(); this.saveNoteState(); });
    this.editorTitle.addEventListener('input', () => {
        this.updatePlaceholderVisibility(this.editorTitle);
        this.debouncedSaveState();
    });
    this.liveRecordingTitle.addEventListener('blur', this.saveLiveRecordingTitle);
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
    this.addSectionBtn.addEventListener('click', () => { this.triggerHapticFeedback(); this.addSection(); });
    
    // Drag/Swipe for sections
    this.songStructureEditor.addEventListener('mousedown', (e) => this.handleCardInteractionStart(e));
    this.songStructureEditor.addEventListener('touchstart', (e) => this.handleCardInteractionStart(e), { passive: true });
    document.addEventListener('mousemove', (e) => this.handleCardInteractionMove(e));
    document.addEventListener('touchmove', (e) => this.handleCardInteractionMove(e), { passive: false });
    document.addEventListener('mouseup', (e) => this.handleCardInteractionEnd(e));
    document.addEventListener('touchend', (e) => this.handleCardInteractionEnd(e));

    // Prevent default drag behavior
    this.songStructureEditor.addEventListener('dragstart', (e) => e.preventDefault());


    // Notes list view controls
    this.ideasTabsContainer.addEventListener('click', (e) => this.handleIdeaTabClick(e as MouseEvent));
    this.listViewNewNoteFab.addEventListener('click', async () => {
        this.triggerHapticFeedback();
        await this.createNewNote();
        this.setActiveView('editor');
    });

    // Audio Playback Controls for Takes
    this.takesAudioPlayer.addEventListener('ended', () => this.handleTakePlaybackEnded());
    this.takesAudioPlayer.addEventListener('play', () => this.updateAllTakePlayButtons(true));
    this.takesAudioPlayer.addEventListener('pause', () => this.updateAllTakePlayButtons(false));

    // Recording Modal Interaction
    this.recordingInterfaceHandle.addEventListener('click', () => { this.triggerHapticFeedback(); this.toggleRecordingModalVisibility(); });


    // Lyriq Player controls
    this.lyriqPlayerButton.addEventListener('click', (e) => {
        this.triggerHapticFeedback();
        e.preventDefault();
        this.setActiveView('lyriq');
    });
    this.lyriqSidebarToggleButton.addEventListener('click', () => { this.triggerHapticFeedback(); this.toggleSidebar(); });
    this.audioUploadInput.addEventListener('change', (e) => this.handleLyriqFileUpload(e as Event));
    this.lyriqInitialAddBeatBtn.addEventListener('click', () => { this.triggerHapticFeedback(); this.audioUploadInput.click(); });
    this.lyriqInitialRecordBtn.addEventListener('click', () => { this.triggerHapticFeedback(); this.showLyriqModal(true); });

    // Lyriq Modal: Peek Header
    this.lyriqModalPeekPlayBtn.addEventListener('click', () => { this.triggerHapticFeedback(); this.toggleLyriqPlayback(); });
    this.lyriqModalRewindBtn.addEventListener('click', () => { this.triggerHapticFeedback(20); this.handleRewind(); });
    this.lyriqModalForwardBtn.addEventListener('click', () => { this.triggerHapticFeedback(20); this.handleForward(); });

    // Lyriq Modal: Expanded View
    this.lyriqExpandedPlayBtn.addEventListener('click', () => { this.triggerHapticFeedback(); this.toggleLyriqPlayback(); });
    this.lyriqExpandedRecordBtn.addEventListener('click', () => { this.triggerHapticFeedback(); this.toggleLyriqRecording(); });
    this.lyriqExpandedVolumeBtn.addEventListener('click', () => { this.triggerHapticFeedback(); this.toggleLyriqMute(); });
    this.lyriqVolumeSlider.addEventListener('input', () => this.handleVolumeChange());
    
    this.lyriqAudioPlayer.addEventListener('loadedmetadata', () => this.handleLyriqMetadataLoaded());
    this.lyriqAudioPlayer.addEventListener('timeupdate', () => this.syncLyrics());
    this.lyriqAudioPlayer.addEventListener('ended', () => this.handleLyriqEnded());
    
    // Lyriq Mixer Controls
    this.lyriqExpandedAddBeatBtn.addEventListener('click', () => { this.triggerHapticFeedback(); this.handleBeatButtonClick(); });
    this.lyriqExpandedVocalBtn.addEventListener('click', () => { this.triggerHapticFeedback(); this.setActiveMixerTrack('vocal'); });

    // Lyriq Modal Click Toggle
    this.lyriqModalHandle.addEventListener('click', () => { this.triggerHapticFeedback(); this.toggleLyriqModalVisibility(); });
    
    // Lyriq Waveform Scrubbing
    this.lyriqWaveforms.addEventListener('mousedown', (e) => this.handleScrubStart(e));
    this.lyriqWaveforms.addEventListener('touchstart', (e) => this.handleScrubStart(e), { passive: false });
    document.addEventListener('mousemove', (e) => this.handleScrubMove(e));
    document.addEventListener('touchmove', (e) => this.handleScrubMove(e), { passive: false });
    document.addEventListener('mouseup', () => this.handleScrubEnd());
    document.addEventListener('touchend', () => this.handleScrubEnd());


    // Window and global listeners
    window.addEventListener('resize', () => { 
        this.isMobile = window.innerWidth <= 1024;
        this.setAppHeight();
    });
    window.addEventListener('keydown', (e) => this.handleKeyDown(e));
    document.addEventListener('click', (e) => {
      this.hideContextMenu();
      document.querySelectorAll('.section-type-dropdown.open').forEach(dropdown => {
        if (!dropdown.contains(e.target as Node)) {
          dropdown.classList.remove('open');
        }
      });
      // Hide takes menu on outside click
      const takesMenu = document.querySelector('.takes-context-menu');
      if (takesMenu && !takesMenu.contains(e.target as Node) && !(e.target as HTMLElement).closest('.takes-badge')) {
        this.hideTakesMenu();
      }
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
      if (this.isRecording) {
        this.discardRecording();
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
              if (this.beatAudioBuffer) {
                  this.lyriqPlayerView.classList.remove('empty-state');
                  this.setLyriqModalState('peeking');
              } else {
                  this.lyriqPlayerView.classList.add('empty-state');
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
            this.triggerHapticFeedback();
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
            // Revoke any old blob URLs from sections as they are invalid on page load
            if (note.sections) {
              note.sections.forEach(section => {
                if (section.takes) {
                  section.takes.forEach(take => {
                    if (take.url && take.url.startsWith('blob:')) {
                      take.url = null;
                    }
                  });
                } else {
                   section.takes = []; // Backwards compatibility
                }
              });
            } else {
               note.sections = []; // Backwards compatibility
            }
            if (typeof note.syncedLyrics === 'undefined') {
                note.syncedLyrics = null;
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
        const noteCopy = JSON.parse(JSON.stringify(note));
        // Don't store blob URLs in localStorage
        if (noteCopy.sections) {
          noteCopy.sections.forEach((section: NoteSection) => {
            if (section.takes) {
              section.takes.forEach((take: AudioTake) => {
                if (take.url && take.url.startsWith('blob:')) {
                  take.url = null;
                }
              });
            }
          });
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
      sections: [{ type: 'Verse', content: '', takes: [] }],
      editorFormat: 'structured',
      timestamp: Date.now(),
      projectId: null,
      syncedLyrics: null,
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
          note.sections = [{ type: 'Verse', content: note.polishedNote, takes: [] }];
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
              const index = parseInt((card as HTMLElement).dataset.index!, 10);
              const oldSection = note.sections[index] || { takes: [] }; // Get existing takes
              newSections.push({ type, content, takes: oldSection.takes });
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

  private saveLiveRecordingTitle = (): void => {
    if (!this.currentNoteId) return;
    const note = this.notes.get(this.currentNoteId);
    if (note) {
        const newTitle = this.liveRecordingTitle.textContent?.trim() || 'Untitled Note';
        note.title = newTitle;
        note.timestamp = Date.now();
        this.editorTitle.textContent = newTitle; // Sync with main editor title
        this.saveDataToStorage();
        this.renderSidebar();
        this.saveNoteState(); // Save this change to undo history
    }
  }

  private deleteNote(noteId: string): void {
    if (!this.notes.has(noteId)) return;
    
    const noteToDelete = this.notes.get(noteId);
    if (noteToDelete?.sections) {
      noteToDelete.sections.forEach(section => {
        section.takes.forEach(take => {
          if (take.url) URL.revokeObjectURL(take.url);
        });
      });
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
      return;
    }

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
          if (note.polishedNote && note.sections.length === 0) {
            note.sections = [{ type: 'Verse', content: note.polishedNote, takes: [] }];
          } else if (note.sections.length === 0) {
            note.sections = [{ type: 'Verse', content: '', takes: [] }];
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
      <div class="card-swipe-container">
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
          <div class="section-header-actions">
            <button class="section-action-btn record-take-btn" title="Record a new take">
                <i class="fas fa-microphone-alt"></i>
            </button>
            ${section.takes.length > 0 ? `
            <button class="takes-badge" title="Show Audio Takes">
              <i class="fas fa-music"></i>
              <span class="takes-count">${section.takes.length}</span>
            </button>
            ` : ''}
          </div>
        </div>
        <div class="section-content-wrapper">
          <div class="section-content" contenteditable="true" placeholder="Start writing..."></div>
        </div>
      </div>
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

      const newSection: NoteSection = { type, content, takes: [] };
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
      this.triggerHapticFeedback();
      e.stopPropagation();
      target.closest('.section-type-dropdown')?.classList.toggle('open');
    }
    
    // Handle record take button click
    if (target.closest('.record-take-btn')) {
        this.triggerHapticFeedback();
        e.stopPropagation();
        this.recordingTargetSectionIndex = index;
        this.toggleRecording();
    }

    // Handle takes badge click
    if (target.closest('.takes-badge')) {
      this.triggerHapticFeedback();
      e.stopPropagation();
      this.showTakesMenu(index, target.closest('.takes-badge')!);
    }
    
    // Handle dropdown item selection
    if (target.matches('.section-type-menu button')) {
      this.triggerHapticFeedback();
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
  }

  // --- Drag, Swipe, Collapse ---
  private handleCardInteractionStart(e: MouseEvent | TouchEvent) {
      const target = e.target as HTMLElement;
      const header = target.closest('.section-card-header');
      
      if (!header) return;
      
      this.swipedCardContainer = target.closest('.card-swipe-container');
      if (this.swipedCardContainer) {
          this.triggerHapticFeedback(15);
          this.isSwiping = true;
          this.swipeStartX = this.getPointerX(e);
          this.swipeCurrentX = this.swipeStartX;
          this.swipedCardContainer.style.transition = 'none';
      }
  }

  private handleCardInteractionMove(e: MouseEvent | TouchEvent) {
      if (!this.isSwiping || !this.swipedCardContainer) return;
      
      e.preventDefault(); // Prevent scrolling while swiping
      this.swipeCurrentX = this.getPointerX(e);
      let deltaX = this.swipeCurrentX - this.swipeStartX;

      // Only allow swiping left
      if (deltaX > 0) deltaX = 0;
      // Clamp swipe distance
      if (deltaX < -110) deltaX = -110;

      // Logic to switch to dragging if moving vertically
      // For simplicity, we'll keep swipe and drag separate for now.
      // A more complex implementation could check the primary axis of movement.
      
      this.swipedCardContainer.style.transform = `translateX(${deltaX}px)`;
  }

  private handleCardInteractionEnd(e: MouseEvent | TouchEvent) {
    if (!this.isSwiping || !this.swipedCardContainer) return;

    this.isSwiping = false;
    this.swipedCardContainer.style.transition = 'transform var(--transition-fast)';
    const deltaX = this.swipeCurrentX - this.swipeStartX;
    // Fix: Cast the result of `closest` to HTMLElement to access the `style` property.
    const card = this.swipedCardContainer.closest('.song-section-card')! as HTMLElement;
    const index = parseInt(card.dataset.index!, 10);

    // Handle click (collapse) vs. swipe
    if (Math.abs(deltaX) < 10) { // It was a click/tap
        this.swipedCardContainer.style.transform = 'translateX(0)';
        if (!(e.target as HTMLElement).closest('button')) {
            card.classList.toggle('collapsed');
        }
    } else { // It was a swipe
        if (deltaX < -60) { // Threshold for delete
            this.triggerHapticFeedback([10, 40]);
            this.swipedCardContainer.style.transform = 'translateX(-100%)';
            card.style.opacity = '0';
            setTimeout(() => {
                const note = this.notes.get(this.currentNoteId!);
                if (note && note.sections[index]) {
                    this.updateCurrentNoteContent();
                    this.saveNoteState();
                    note.sections.splice(index, 1);
                    card.remove();
                    // Re-index remaining cards
                    this.songStructureEditor.querySelectorAll<HTMLDivElement>('.song-section-card').forEach((c, i) => c.dataset.index = i.toString());
                    this.updateCurrentNoteContent();
                    this.saveNoteState();
                }
            }, 300);
        } else { // Snap back
            this.swipedCardContainer.style.transform = 'translateX(0)';
        }
    }

    this.swipedCardContainer = null;
  }

  private handleSectionDragStart(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const card = target.closest<HTMLElement>('.song-section-card');
    if (!card) return;

    this.draggedElement = card;
    
    this.placeholder = document.createElement('div');
    this.placeholder.className = 'song-section-card-placeholder';
    this.placeholder.style.height = `${card.offsetHeight}px`;

    setTimeout(() => {
        if (this.draggedElement) {
            this.draggedElement.classList.add('dragging');
        }
    }, 0);

    card.parentElement?.insertBefore(this.placeholder, card.nextSibling);
    card.parentElement?.insertBefore(card, card.parentElement.firstChild); // Visually lift to top
  }

  private handleSectionDragMove(e: MouseEvent): void {
      if (!this.draggedElement || !this.placeholder) return;
      e.preventDefault();

      this.draggedElement.style.transform = `translateY(${e.clientY - this.swipeStartX}px)`;

      const afterElement = this.getDragAfterElement(this.songStructureEditor, e.clientY);
      if (afterElement) {
          this.songStructureEditor.insertBefore(this.placeholder, afterElement);
      } else {
          this.songStructureEditor.appendChild(this.placeholder);
      }
  }

  private handleSectionDragEnd(e: MouseEvent): void {
    if (this.draggedElement && this.placeholder) {
      this.placeholder.parentElement?.insertBefore(this.draggedElement, this.placeholder);
      this.placeholder.remove();
      this.draggedElement.classList.remove('dragging');
      this.draggedElement.style.transform = '';
      
      const newOrder = Array.from(this.songStructureEditor.querySelectorAll('.song-section-card')).map(card => parseInt((card as HTMLElement).dataset.index!));
      const note = this.notes.get(this.currentNoteId!);
      if (note) {
          this.updateCurrentNoteContent();
          this.saveNoteState();
          const reorderedSections = newOrder.map(i => note.sections[i]);
          note.sections = reorderedSections;
          // Re-index DOM elements after reordering data
          this.songStructureEditor.querySelectorAll<HTMLDivElement>('.song-section-card').forEach((c, i) => c.dataset.index = i.toString());
          this.updateCurrentNoteContent();
          this.saveNoteState();
      }
    }
    
    this.draggedElement = null;
    this.placeholder = null;
  }
  
  private getDragAfterElement(container: HTMLElement, y: number): HTMLElement | null {
    const draggableElements = [...container.querySelectorAll('.song-section-card:not(.dragging)')] as HTMLElement[];
    const closest = draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY, element: null as HTMLElement | null });
    return closest.element;
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
              this.triggerHapticFeedback();
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
      // Fix: The generic parameter on `closest` may not be correctly inferring the type.
      // Casting to `HTMLButtonElement` ensures `dataset` is available.
      const button = target.closest('.idea-tab-btn') as HTMLButtonElement | null;
      if (button && !button.classList.contains('active')) {
          this.triggerHapticFeedback();
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
        this.setRecordingModalState('hidden');
    }
  }

  private async toggleRecording(): Promise<void> {
      if (this.isProcessing) return;

      // START a new recording session
      if (!this.isRecording) {
          if (this.activeView === 'lyriq') {
            this.toggleLyriqRecording();
            return;
          }

          if (this.activeView === 'editor' && this.recordingTargetSectionIndex === null) {
              const shouldContinue = true;
              if (!shouldContinue) return;
          }

          this.setRecordingModalState('visible');

          if (navigator.permissions?.query) {
              try {
                  const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
                  if (permissionStatus.state === 'denied') {
                      this.recordingStatus.innerHTML = 'Microphone access is blocked. <br> Please enable it in your browser settings to record.';
                      setTimeout(() => this.setRecordingModalState('hidden'), 2000);
                      return;
                  }
                  await this.requestMicrophoneAndStart();
              } catch (e) {
                  console.error("Permissions API error, falling back:", e);
                  await this.requestMicrophoneAndStart();
              }
          } else {
              await this.requestMicrophoneAndStart();
          }
          return;
      }

      // If already in a session, toggle pause/redo
      if (this.isPaused) {
          // REDO: Discard current and start a new one immediately
          await this.discardRecording(false); // don't hide modal
          await this.requestMicrophoneAndStart();
      } else {
          // PAUSE
          this.mediaRecorder?.pause();
          this.isPaused = true;
          this.stopTimer();
          this.stopLiveWaveform();
          this.drawPausedWaveform();
          this.updateRecordingStateUI();
      }
  }

  private async finishRecording(): Promise<void> {
      if (!this.isRecording || this.isProcessing) return;

      this.isProcessing = true;
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
          this.mediaRecorder.stop();
      }
      
      this.stopLiveWaveform();
      this.stopTimer();
      this.drawPausedWaveform();
      this.updateRecordingStateUI();
      // 'onstop' will handle the rest
  }

  private async discardRecording(hideModal = true): Promise<void> {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.onstop = null; // Prevent processing
      this.mediaRecorder.stop();
    }
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.audioChunks = [];
    this.isRecording = false;
    this.isPaused = false;
    this.isProcessing = false;
    this.recordingTargetSectionIndex = null;

    this.stopTimer();
    this.stopLiveWaveform();
    this.clearLiveWaveform();
    this.liveRecordingTimerDisplay.textContent = '00:00.00';

    if (hideModal) {
      this.setRecordingModalState('hidden');
    }
    this.updateRecordingStateUI();
  }

  private async startRecording(): Promise<void> {
    if (!this.stream) {
        console.error("No audio stream available.");
        this.recordingStatus.textContent = 'Could not start recording.';
        return;
    }
    
    this.audioChunks = [];
    try {
        const options = { mimeType: 'audio/webm; codecs=opus' };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options.mimeType = 'audio/webm';
        }

        this.mediaRecorder = new MediaRecorder(this.stream, options);
        this.mediaRecorder.ondataavailable = (event) => {
          this.audioChunks.push(event.data);
        };
    
        this.mediaRecorder.onstop = async () => {
          this.isRecording = false;
          this.isPaused = false;

          // Clean up stream tracks
          this.stream?.getTracks().forEach(track => track.stop());
          this.stream = null;
          
          const audioBlob = new Blob(this.audioChunks, { type: this.mediaRecorder!.mimeType });
          this.audioChunks = [];

          if (audioBlob.size < 1000) { // Guard against empty recordings
            this.setFinalStatus('Recording too short.', true);
            return;
          }

          if (this.activeView === 'lyriq') {
              // If no beat is loaded, this vocal becomes the master track for playback.
              if (!this.beatAudioBuffer) {
                  this.vocalBlobForMaster = audioBlob;
                  this.lyriqAudioPlayer.src = URL.createObjectURL(audioBlob);
              } else {
                  this.lyriqVocalAudioPlayer.src = URL.createObjectURL(audioBlob);
              }

              await this.processAndRenderVocalWaveform(audioBlob);
              this.lyriqExpandedVocalBtn.classList.add('has-recording');
              this.isProcessing = false;
              
              const note = this.notes.get(this.currentNoteId!);
              if (note) {
                  this.generateLyricTimestamps(note, audioBlob);
              }
              
              return;
          }

          // If it's an editor recording, save it to the target section
          const note = this.notes.get(this.currentNoteId!);
          if (note && this.recordingTargetSectionIndex !== null) {
              const section = note.sections[this.recordingTargetSectionIndex];
              if (section) {
                  const newTake: AudioTake = {
                      id: `take_${Date.now()}`,
                      url: URL.createObjectURL(audioBlob),
                      data: await this.blobToBase64(audioBlob),
                      mimeType: audioBlob.type,
                      duration: await this.getAudioDuration(URL.createObjectURL(audioBlob)),
                      timestamp: Date.now()
                  };
                  section.takes.push(newTake);
                  this.saveDataToStorage();
                  this.saveNoteState();
                  this.renderNoteContent(note);
                  this.setFinalStatus('Take saved!');
              } else {
                  this.setFinalStatus('Target section not found.', true);
              }
          } else {
            // This is a general recording, transcribe and process it.
            await this.transcribeAndProcess(audioBlob);
          }
          this.recordingTargetSectionIndex = null; // Reset target
        };
    
        this.mediaRecorder.start(100); // Trigger dataavailable every 100ms
        this.isRecording = true;
        this.isPaused = false;
        
        const note = this.notes.get(this.currentNoteId!);
        if (note && this.activeView === 'editor') {
            this.liveRecordingTitle.textContent = note.title || 'New Recording';
            this.liveRecordingTitle.contentEditable = 'true';
        }
        this.startLiveWaveform();
        this.startTimer();
        this.updateRecordingStateUI();

    } catch (error) {
        console.error("Error creating MediaRecorder:", error);
        this.recordingStatus.textContent = 'Recording failed to start.';
        this.isRecording = false;
        this.updateRecordingStateUI();
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
          let structuredResult;

          try {
              structuredResult = JSON.parse(jsonString).map((section: any) => ({...section, takes: []}));
          } catch (e) {
              console.error("Failed to parse AI JSON response:", e);
              console.error("Received text:", jsonString);
              // Fallback: treat the whole response as content in one section
              this.setFinalStatus('Could not parse polished note.', true);
              note.polishedNote = jsonString; // Use the raw text response
              note.sections = [{ type: 'Verse', content: jsonString, takes: [] }];
              this.saveDataToStorage();
              this.saveNoteState();
              this.setActiveNote(note.id);
              return;
          }
          
          const isNoteEmpty = note.sections.length === 0 || 
                              (note.sections.length === 1 && note.sections[0].content.trim() === '');

          this.updateCurrentNoteContent();
          this.saveNoteState(); // Save state before AI polish

          if (isNoteEmpty) {
              note.sections = structuredResult;
          } else {
              note.sections.push(...structuredResult);
          }
          
          note.polishedNote = this.flattenSections(note.sections);
          note.timestamp = Date.now();
          
          this.saveDataToStorage();
          this.saveNoteState(); // Save state after AI polish
          this.setActiveNote(note.id);
          this.renderSidebar();
          this.setFinalStatus('Note polished successfully!');

      } catch (error) {
          console.error('Error polishing note:', error);
          this.setFinalStatus('Could not polish note.', true);
          note.polishedNote = note.rawTranscription;
          note.sections = [{ type: 'Verse', content: note.rawTranscription, takes: [] }];
          this.saveDataToStorage();
          this.saveNoteState();
          this.setActiveNote(note.id);
      }
  }
  
  private updateRecordingStateUI(): void {
    const isSessionActive = this.isRecording || this.isProcessing;
    this.finishRecordingButton.style.display = isSessionActive ? 'flex' : 'none';

    document.body.classList.toggle('is-processing', this.isProcessing);

    this.recordButton.classList.remove('recording', 'paused');
    const recordIcon = this.recordButton.querySelector('.fa-microphone') as HTMLElement;
    const stopIcon = this.recordButton.querySelector('.fa-stop') as HTMLElement;
    
    const isPeeking = this.recordingInterface.classList.contains('peeking');
    this.recordingPeekIndicator.classList.toggle('active', isPeeking && this.isRecording && !this.isPaused);


    if (this.isProcessing) {
      this.recordButtonText.textContent = '';
      recordIcon.style.display = 'inline-block';
      stopIcon.style.display = 'none';
      return;
    }

    if (isSessionActive) {
        this.recordButtonText.textContent = '';
        recordIcon.style.display = 'none';
        stopIcon.style.display = 'none';
        if (this.isPaused) {
            this.recordButton.classList.add('paused');
            this.recordButtonText.textContent = 'REDO';
        } else { // Actively recording
            this.recordButton.classList.add('recording');
            stopIcon.style.display = 'inline-block';
        }
    } else { // Idle
        this.recordButtonText.textContent = '';
        recordIcon.style.display = 'inline-block';
        stopIcon.style.display = 'none';
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
      if (!this.isRecording || this.isPaused || !this.analyserNode || !this.waveformDataArray || !this.liveWaveformCtx) {
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
  }

  private clearLiveWaveform(): void {
    if (this.liveWaveformCtx) {
        this.liveWaveformCtx.clearRect(0, 0, this.liveWaveformCanvas.width, this.liveWaveformCanvas.height);
    }
  }

  private drawPausedWaveform(): void {
    if (!this.liveWaveformCtx) return;
    const canvas = this.liveWaveformCtx.canvas;
    this.liveWaveformCtx.clearRect(0, 0, canvas.width, canvas.height);

    const isDarkMode = !document.body.classList.contains('light-mode');
    const centerY = canvas.height / 2;

    // Draw dotted line
    this.liveWaveformCtx.strokeStyle = isDarkMode ? '#555' : '#ccc';
    this.liveWaveformCtx.lineWidth = 1;
    this.liveWaveformCtx.setLineDash([2, 4]);
    this.liveWaveformCtx.beginPath();
    this.liveWaveformCtx.moveTo(0, centerY);
    this.liveWaveformCtx.lineTo(canvas.width / 2 - 5, centerY);
    this.liveWaveformCtx.stroke();
    
    // Draw vertical playhead
    this.liveWaveformCtx.setLineDash([]);
    this.liveWaveformCtx.strokeStyle = isDarkMode ? '#82aaff' : '#007AFF';
    this.liveWaveformCtx.lineWidth = 2;
    this.liveWaveformCtx.beginPath();
    this.liveWaveformCtx.moveTo(canvas.width / 2, 0);
    this.liveWaveformCtx.lineTo(canvas.width / 2, canvas.height);
    this.liveWaveformCtx.stroke();
  }
  
  // --- Timers ---
  private startTimer(): void {
    this.recordingStartTime = Date.now();
    this.stopTimer(); // Clear any existing timer

    this.timerIntervalId = window.setInterval(() => {
      const elapsedTime = Date.now() - this.recordingStartTime;
      const formattedTimeMs = this.formatTime(elapsedTime, true);
      if (this.activeView === 'editor') {
        this.liveRecordingTimerDisplay.textContent = formattedTimeMs;
      }
    }, 20); // Update frequently for smooth ms display
  }

  private stopTimer(): void {
    if (this.timerIntervalId) {
      clearInterval(this.timerIntervalId);
      this.timerIntervalId = null;
    }
  }

  // --- Audio Playback (for Takes) ---
  private toggleTakePlayback(take: AudioTake, button: HTMLButtonElement): void {
      const isPlaying = this.takesAudioPlayer.src === take.url && !this.takesAudioPlayer.paused;
      
      this.updateAllTakePlayButtons(false);

      if (isPlaying) {
          this.takesAudioPlayer.pause();
      } else {
          // If URL doesn't exist (e.g., from page load), create it from base64 data
          if (!take.url && take.data && take.mimeType) {
              const audioBlob = this.base64ToBlob(take.data, take.mimeType);
              take.url = URL.createObjectURL(audioBlob);
          }
          this.takesAudioPlayer.src = take.url!;
          this.takesAudioPlayer.play();
          button.classList.add('playing');
      }
  }

  private handleTakePlaybackEnded(): void {
      this.updateAllTakePlayButtons(false);
  }
  
  private updateAllTakePlayButtons(isPlaying: boolean): void {
      document.querySelectorAll('.take-play-btn').forEach(btn => {
          const takeId = (btn.closest('.take-item') as HTMLElement)?.dataset.takeId;
          const currentTakeId = this.takesAudioPlayer.src.split('/').pop(); // A bit hacky but works for blobs
          
          if (isPlaying && this.takesAudioPlayer.src === (btn as any).dataset.src) {
            btn.classList.add('playing');
          } else {
            btn.classList.remove('playing');
          }
      });
  }


  // --- Lyriq Player ---
  private async toggleLyriqRecording(): Promise<void> {
    if (this.isProcessing) return;

    this.setActiveMixerTrack('vocal');

    if (this.isRecording) {
        this.mediaRecorder?.stop();
        this.stopTimer();
        this.isRecording = false;
        // If audio was playing during recording, stop it.
        if (this.lyriqIsPlaying) {
            this.toggleLyriqPlayback();
        }
    } else {
        // Start a new recording session
        // Reset playhead if there is any audio loaded.
        if (this.lyriqAudioPlayer.src) {
            this.lyriqAudioPlayer.currentTime = 0;
            if (this.lyriqVocalAudioPlayer.src) this.lyriqVocalAudioPlayer.currentTime = 0;
            this.updatePlayheadPosition(0);
        }

        await this.requestMicrophoneAndStart();
        
        // If a beat exists (and is not a vocal placeholder), play it in sync.
        if (this.lyriqAudioPlayer.src && !this.vocalBlobForMaster) {
            // Delay playback start slightly to sync with recording
            setTimeout(() => this.toggleLyriqPlayback(), 100);
        }
    }
    
    this.lyriqExpandedRecordBtn.classList.toggle('recording', this.isRecording);
    this.lyriqExpandedVocalBtn.classList.toggle('recording', this.isRecording);
  }

  private handleBeatButtonClick(): void {
    this.setActiveMixerTrack('beat');
    if (!this.beatAudioBuffer) {
      this.audioUploadInput.click();
    }
  }

  private async generateLyricTimestamps(note: Note, audioBlob: Blob): Promise<void> {
    const lyricsText = this.flattenSections(note.sections);
    if (!lyricsText.trim()) {
        console.log("No lyrics in the original note to sync.");
        return;
    }

    this.lyricsContainer.innerHTML = '<p class="lyriq-line placeholder">Syncing lyrics...</p>';

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
                        You are a precise audio-to-text alignment tool.
                        Analyze the provided audio of a vocal performance and the full lyrics text.
                        Your task is to generate a JSON array of objects, where each object represents a line of the lyrics.
                        Each object must contain two properties:
                        1. "time": The exact start time of the lyric line in the audio, in seconds (e.g., 1.25).
                        2. "line": The text of the lyric line.

                        Ensure that every line from the provided lyrics is present in your output, with its corresponding timestamp.
                        The order of lines in the JSON array must match the order in the original lyrics.

                        FULL LYRICS:
                        ---
                        ${lyricsText}
                        ---
                    `},
                ]
            },
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            time: { type: Type.NUMBER, description: "Start time in seconds" },
                            line: { type: Type.STRING, description: "The lyric line" }
                        },
                        required: ["time", "line"]
                    }
                }
            }
        });

        const jsonString = response.text;
        const syncedLyrics = JSON.parse(jsonString);

        note.syncedLyrics = syncedLyrics;
        this.saveDataToStorage();
        this.loadNoteIntoLyriqPlayer(); // Refresh the display with new data

    } catch (error) {
        console.error("Error syncing lyrics:", error);
        this.lyricsContainer.innerHTML = '<p class="lyriq-line placeholder">Could not sync lyrics. Please try recording again.</p>';
        // Revert to non-synced lyrics if sync fails
        note.syncedLyrics = null;
        this.saveDataToStorage();
    }
  }

  private loadNoteIntoLyriqPlayer(): void {
      if (!this.currentNoteId) {
          // If no note is active, find the most recent one
          const sortedNotes = [...this.notes.values()].sort((a,b) => b.timestamp - a.timestamp);
          if (sortedNotes.length > 0) {
              this.currentNoteId = sortedNotes[0].id;
          } else {
              // Handle case with no notes at all
              this.lyriqSongTitle.textContent = 'No Note Selected';
              this.lyriqModalPeekTitle.textContent = 'No Note Selected';
              this.lyricsContainer.innerHTML = '<p class="lyriq-line placeholder">Create or select a note to see lyrics here.</p>';
              return;
          }
      }

      const note = this.notes.get(this.currentNoteId);
      if (!note) return;

      this.lyriqSongTitle.textContent = note.title;
      this.lyriqSongSubtitle.textContent = new Date(note.timestamp).toLocaleDateString();
      this.lyriqModalPeekTitle.textContent = note.title;

      // Always start with a blank slate per user request.
      this.lyricsData = [];
      this.lyricsContainer.innerHTML = '<p class="lyriq-line placeholder">Record a vocal performance to generate lyrics.</p>';
  }

  private async handleLyriqFileUpload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const url = URL.createObjectURL(file);
      this.lyriqPlayerView.classList.remove('empty-state');
      this.lyriqExpandedAddBeatBtn.classList.add('has-beat');
      this.lyriqControlsModal.classList.add('has-beat');
      
      this.lyriqAudioPlayer.src = url;
      
      this.lyriqExpandedAddBeatBtn.classList.add('active');

      // Process and draw waveform
      try {
        const arrayBuffer = await file.arrayBuffer();
        const audioContext = new AudioContext();
        this.beatAudioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        // If a vocal was acting as the master track, it's now a secondary track.
        // Move it to the dedicated vocal audio player.
        if (this.vocalBlobForMaster) {
            this.lyriqVocalAudioPlayer.src = URL.createObjectURL(this.vocalBlobForMaster);
            this.vocalBlobForMaster = null; // The new beat is now the master track.
        }

        // Resize canvas based on audio duration for scrolling effect
        const canvasWidth = this.beatAudioBuffer.duration * this.PIXELS_PER_SECOND;
        this.beatWaveformCanvas.width = canvasWidth;
        this.vocalWaveformCanvas.width = canvasWidth;

        this.lyriqWaveforms.scrollLeft = 0;

        this.renderBeatWaveform();
        // Rerender vocal waveform if it exists, as canvas has been resized
        if (this.vocalAudioBuffer) {
            this.renderVocalWaveform();
        }
        this.updatePlayheadPosition(0);
        this.setLyriqModalState('visible');

      } catch (e) {
        console.error("Error processing audio file:", e);
      }
    }
  }

  private toggleLyriqPlayback(): void {
      if (!this.lyriqAudioPlayer.src) return;
  
      const iconClass = this.lyriqIsPlaying ? 'fas fa-play' : 'fas fa-pause';
      
      const expandedIcon = this.lyriqExpandedPlayBtn.querySelector('i');
      if (expandedIcon) expandedIcon.className = iconClass;
      
      const peekIcon = this.lyriqModalPeekPlayBtn.querySelector('i');
      if (peekIcon) peekIcon.className = iconClass;

      if (this.lyriqIsPlaying) {
          this.lyriqAudioPlayer.pause();
          if (this.lyriqVocalAudioPlayer.src) this.lyriqVocalAudioPlayer.pause();
          this.stopLyriqAnimation();
      } else {
          // Sync vocal track to beat track before playing
          if (this.lyriqVocalAudioPlayer.src) {
              this.lyriqVocalAudioPlayer.currentTime = this.lyriqAudioPlayer.currentTime;
          }
          this.lyriqAudioPlayer.play();
          if (this.lyriqVocalAudioPlayer.src) this.lyriqVocalAudioPlayer.play();
          this.startLyriqAnimation();
      }
      this.lyriqIsPlaying = !this.lyriqIsPlaying;
  }
  
  private handleRewind = (): void => {
      if (!this.lyriqAudioPlayer) return;
      const newTime = Math.max(0, this.lyriqAudioPlayer.currentTime - 15);
      this.updatePlayheadPosition(newTime);
  }

  private handleForward = (): void => {
      if (!this.lyriqAudioPlayer || !this.lyriqAudioPlayer.duration) return;
      const newTime = Math.min(this.lyriqAudioPlayer.duration, this.lyriqAudioPlayer.currentTime + 15);
      this.updatePlayheadPosition(newTime);
  }

  private handleLyriqMetadataLoaded(): void {
    this.updatePlayheadPosition(this.lyriqAudioPlayer.currentTime);
    this.syncLyrics();
  }

  private syncLyrics(): void {
    if (!this.lyriqAudioPlayer.duration) return;

    const currentTime = this.lyriqAudioPlayer.currentTime;
    this.updatePlayheadPosition(currentTime);


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
      this.toggleLyriqRecording();
    }
    this.stopLyriqAnimation();
    const expandedIcon = this.lyriqExpandedPlayBtn.querySelector('i');
    if (expandedIcon) expandedIcon.className = 'fas fa-play';
    const peekIcon = this.lyriqModalPeekPlayBtn.querySelector('i');
    if (peekIcon) peekIcon.className = 'fas fa-play';
    this.updatePlayheadPosition(0);
  }
  
  private setActiveMixerTrack(track: MixerTrack): void {
      this.activeMixerTrack = track;
      this.lyriqExpandedAddBeatBtn.classList.toggle('active', track === 'beat');
      this.lyriqExpandedVocalBtn.classList.toggle('active', track === 'vocal');

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
      
      const icon = this.lyriqExpandedVolumeBtn.querySelector('i')!;
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
              this.triggerHapticFeedback();
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
          this.triggerHapticFeedback(50);
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

  // --- Takes Menu ---
  private showTakesMenu(sectionIndex: number, badgeElement: HTMLElement): void {
      this.hideTakesMenu(); // Hide any existing menu
      const note = this.notes.get(this.currentNoteId!);
      if (!note) return;
      const section = note.sections[sectionIndex];
      if (!section || section.takes.length === 0) return;

      const menu = document.createElement('div');
      menu.className = 'takes-context-menu';
      
      const takesHtml = `
          <ul class="takes-list">
            ${section.takes.map((take, i) => `
              <li class="take-item" data-take-id="${take.id}">
                <div class="take-player">
                  <button class="take-play-btn" data-src="${take.url || ''}">
                    <i class="fas fa-play"></i><i class="fas fa-pause"></i>
                  </button>
                  <div class="take-info">
                    <div class="take-title">Take ${i + 1}</div>
                    <div class="take-time">${this.formatTime(take.duration || 0)}</div>
                  </div>
                </div>
              </li>
            `).join('')}
          </ul>
        `;

      menu.innerHTML = takesHtml;

      document.body.appendChild(menu);

      // Position the menu intelligently to avoid viewport overflow
      const badgeRect = badgeElement.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
  
      // Start by aligning left edges
      let left = badgeRect.left;
  
      // If the menu overflows the right edge, align right edges instead
      if (left + menuRect.width > viewportWidth - 16) { // 16px buffer
          left = badgeRect.right - menuRect.width;
      }
  
      // Ensure it doesn't overflow the left edge either
      if (left < 16) {
          left = 16;
      }
  
      menu.style.left = `${left}px`;
      menu.style.top = `${badgeRect.bottom + 8}px`;

      // Add event listeners
      menu.querySelectorAll('.take-play-btn').forEach((btn, i) => {
        btn.addEventListener('click', () => {
            this.triggerHapticFeedback();
            this.toggleTakePlayback(section.takes[i], btn as HTMLButtonElement);
        });
      });

      // Make visible with animation
      setTimeout(() => menu.classList.add('visible'), 10);
  }

  private hideTakesMenu(): void {
      const existingMenu = document.querySelector('.takes-context-menu');
      if (existingMenu) {
          existingMenu.remove();
      }
  }

  // --- Lyriq Modal & Waveform ---

  private showLyriqModal(startRecording: boolean = false): void {
    this.setLyriqModalState('visible');
    if (startRecording) {
      this.setActiveMixerTrack('vocal');
    } else {
      this.setActiveMixerTrack('beat');
    }
  }

  private setLyriqModalState(state: 'visible' | 'peeking' | 'hidden'): void {
    this.lyriqControlsModal.classList.remove('visible', 'peeking');
    this.lyriqControlsModal.style.transform = '';

    if (state === 'hidden') {
      if (!this.beatAudioBuffer) {
        this.lyriqPlayerView.classList.add('empty-state');
      }
      return;
    }

    this.lyriqPlayerView.classList.remove('empty-state');
    this.lyriqControlsModal.classList.add(state);

    if (state === 'visible' && this.beatAudioBuffer) {
        // Recalculate canvas size if it becomes fully visible
        setTimeout(() => {
          this.renderBeatWaveform();
          this.renderVocalWaveform();
        }, 50); // allow transition to start
    }
  }

  private toggleLyriqModalVisibility(): void {
    const isVisible = this.lyriqControlsModal.classList.contains('visible');
    
    if (!this.beatAudioBuffer && !this.vocalAudioBuffer) {
      this.setLyriqModalState('hidden');
      return;
    }

    if (isVisible) {
      this.setLyriqModalState('peeking');
    } else {
      this.setLyriqModalState('visible');
    }
  }

  private getPointerY(e: MouseEvent | TouchEvent): number {
    return e.type.startsWith('touch') ? (e as TouchEvent).touches[0].clientY : (e as MouseEvent).clientY;
  }
  
  private getPointerX(e: MouseEvent | TouchEvent): number {
    return e.type.startsWith('touch') ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX;
  }

  // --- Recording Modal Interaction ---
  private setRecordingModalState(state: 'visible' | 'peeking' | 'hidden'): void {
    this.recordingInterface.classList.remove('visible', 'peeking');
    this.recordingInterface.style.transform = ''; // Reset inline styles
    if (state === 'visible' || state === 'peeking') {
        this.recordingInterface.classList.add(state);
        document.body.classList.add('recording-modal-active');
    } else {
        document.body.classList.remove('recording-modal-active');
        this.liveRecordingTitle.contentEditable = 'false';
    }
    this.updateRecordingStateUI();
  }
  
  private toggleRecordingModalVisibility(): void {
    const isVisible = this.recordingInterface.classList.contains('visible');
    if (isVisible) {
      this.setRecordingModalState('peeking');
    } else {
      this.setRecordingModalState('visible');
    }
  }
  
  private handleScrubStart(e: MouseEvent | TouchEvent): void {
    if (e instanceof MouseEvent && e.button !== 0) return;
    if (!this.beatAudioBuffer) return;

    this.isScrubbing = true;
    this.lyriqWaveforms.classList.add('is-scrubbing');
    if (this.lyriqIsPlaying) this.toggleLyriqPlayback(); // Pause while scrubbing
    
    this.scrubStartX = this.getPointerX(e);
    this.scrubStartScrollLeft = this.lyriqWaveforms.scrollLeft;

    // Prevent momentum scrolling on touch devices
    this.lyriqWaveforms.style.overflowX = 'hidden';
  }

  private handleScrubMove(e: MouseEvent | TouchEvent): void {
    if (!this.isScrubbing) return;
    e.preventDefault();

    const currentX = this.getPointerX(e);
    const deltaX = currentX - this.scrubStartX;
    // Invert the scroll direction for a more natural "drag-to-seek" feel.
    // Dragging right should fast-forward (increase scrollLeft).
    const newScrollLeft = this.scrubStartScrollLeft + deltaX;

    const maxScroll = this.lyriqWaveforms.scrollWidth - this.lyriqWaveforms.clientWidth;
    const clampedScrollLeft = Math.max(0, Math.min(newScrollLeft, maxScroll));

    this.lyriqWaveforms.scrollLeft = clampedScrollLeft;

    const newTime = clampedScrollLeft / this.PIXELS_PER_SECOND;

    this.updatePlayheadPosition(newTime, false);
  }
  
  private handleScrubEnd(): void {
    if (!this.isScrubbing) return;
    this.isScrubbing = false;
    this.lyriqWaveforms.classList.remove('is-scrubbing');
    this.lyriqWaveforms.style.overflowX = 'scroll';
  }

  private renderBeatWaveform(): void {
    if (!this.beatAudioBuffer || !this.beatWaveformCtx) return;
    // Do not render a waveform for the beat track if it's just a silent placeholder
    if (this.vocalBlobForMaster) {
      this.beatWaveformCtx.clearRect(0, 0, this.beatWaveformCanvas.width, this.beatWaveformCanvas.height);
      return;
    }
    this.drawWaveform(this.beatAudioBuffer, this.beatWaveformCtx, 'var(--color-accent-alt)');
  }
  
  private renderVocalWaveform(): void {
    if (!this.vocalAudioBuffer || !this.vocalWaveformCtx) return;
    this.drawWaveform(this.vocalAudioBuffer, this.vocalWaveformCtx, '#fff');
  }
  
  private async processAndRenderVocalWaveform(vocalBlob: Blob): Promise<void> {
    try {
        const arrayBuffer = await vocalBlob.arrayBuffer();
        const audioContext = new AudioContext();
        this.vocalAudioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        // If the vocal is acting as the master track (no beat loaded yet).
        if (this.vocalBlobForMaster) {
            const duration = this.vocalAudioBuffer.duration;
            const canvasWidth = duration * this.PIXELS_PER_SECOND;
            this.beatWaveformCanvas.width = canvasWidth;
            this.vocalWaveformCanvas.width = canvasWidth;

            // Create a silent buffer for timing calculations so scrubbing and other functions work.
            const silentContext = new AudioContext();
            this.beatAudioBuffer = silentContext.createBuffer(1, Math.round(duration * silentContext.sampleRate), silentContext.sampleRate);
            
            // Update UI to show the player is active.
            this.lyriqPlayerView.classList.remove('empty-state');
            this.setLyriqModalState('visible');
        }
        
        this.renderVocalWaveform();
    } catch(e) {
        console.error("Error processing vocal audio:", e);
    }
  }

  private drawWaveform(buffer: AudioBuffer, ctx: CanvasRenderingContext2D, color: string): void {
      const data = buffer.getChannelData(0);
      const canvas = ctx.canvas;
      const width = canvas.width;
      const height = canvas.height;

      ctx.clearRect(0, 0, width, height);
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      
      const step = 1;

      ctx.beginPath();
      for (let x = 0; x < width; x += step) {
          const startIndex = Math.floor(x * data.length / width);
          const endIndex = Math.min(startIndex + Math.ceil(data.length / width), data.length);
          let min = 1.0;
          let max = -1.0;
          for (let i = startIndex; i < endIndex; i++) {
              if (data[i] < min) min = data[i];
              if (data[i] > max) max = data[i];
          }

          const y_max = (1 - max) * height / 2;
          const y_min = (1 - min) * height / 2;
          
          ctx.moveTo(x, y_max);
          ctx.lineTo(x, y_min);
      }
      ctx.stroke();
  }

  private startLyriqAnimation(): void {
      this.stopLyriqAnimation();
      
      const animate = () => {
          const currentTime = this.lyriqAudioPlayer.currentTime;
          this.updatePlayheadPosition(currentTime);
          this.lyriqAnimationId = requestAnimationFrame(animate);
      };
      animate();
  }

  private stopLyriqAnimation(): void {
      if (this.lyriqAnimationId) {
          cancelAnimationFrame(this.lyriqAnimationId);
          this.lyriqAnimationId = null;
      }
  }
  
  private updatePlayheadPosition(time: number, updateScroll = true): void {
      if (!this.beatAudioBuffer) return;
  
      const duration = this.lyriqAudioPlayer.duration;
      let clampedTime = time;
  
      // Clamp time to valid range if duration is available
      if (duration && !isNaN(duration)) {
          clampedTime = Math.max(0, Math.min(time, duration));
      } else {
          clampedTime = Math.max(0, time);
      }
      
      // Set time for both audio players. This is now the single source of truth.
      // Use a small epsilon to prevent floating point issues from causing seeks during playback.
      const epsilon = 0.01;
      if (Math.abs(this.lyriqAudioPlayer.currentTime - clampedTime) > epsilon) {
        this.lyriqAudioPlayer.currentTime = clampedTime;
      }
      if (this.lyriqVocalAudioPlayer.src && Math.abs(this.lyriqVocalAudioPlayer.currentTime - clampedTime) > epsilon) {
          this.lyriqVocalAudioPlayer.currentTime = clampedTime;
      }
  
      if (updateScroll) {
        const newScrollLeft = clampedTime * this.PIXELS_PER_SECOND;
        this.lyriqWaveforms.scrollLeft = Math.max(0, newScrollLeft);
      }
  
      const displayDuration = duration && !isNaN(duration) ? duration : 0;
      this.lyriqExpandedTime.textContent = this.formatTime(clampedTime * 1000);
      this.lyriqModalTime.textContent = `${this.formatTime(clampedTime * 1000)} / ${this.formatTime(displayDuration * 1000)}`;
  }


  // --- Undo / Redo ---
  private getNoteState(note: Note): NoteState {
      // Deep copy to prevent mutation
      return JSON.parse(JSON.stringify({
          title: note.title,
          sections: note.sections,
          polishedNote: note.polishedNote,
          editorFormat: note.editorFormat,
      }));
  }
  
  private saveNoteState(): void {
    if (!this.currentNoteId) return;

    const history = this.noteHistories.get(this.currentNoteId);
    const note = this.notes.get(this.currentNoteId);
    if (!history || !note) return;

    const currentState = this.getNoteState(note);
    const lastUndoState = history.undo[history.undo.length - 1];
    
    if (JSON.stringify(currentState) === JSON.stringify(lastUndoState)) {
      return;
    }

    history.undo.push(currentState);
    history.redo = []; // Clear redo stack on new action
    
    if (history.undo.length > 50) {
      history.undo.shift();
    }
    this.updateUndoRedoButtons();
  }
  
  private debouncedSaveState = () => {
    if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = window.setTimeout(() => {
        this.updateCurrentNoteContent();
        this.saveNoteState();
    }, 800);
  }

  private undo(): void {
    if (!this.currentNoteId) return;
    const history = this.noteHistories.get(this.currentNoteId);
    if (!history || history.undo.length <= 1) return; // Can't undo the initial state

    this.updateCurrentNoteContent();

    const currentState = history.undo.pop()!;
    history.redo.push(currentState);
    
    this.applyNoteState(history.undo[history.undo.length - 1]);
    this.updateUndoRedoButtons();
  }

  private redo(): void {
    if (!this.currentNoteId) return;
    const history = this.noteHistories.get(this.currentNoteId);
    if (!history || history.redo.length === 0) return;

    const stateToRestore = history.redo.pop()!;
    history.undo.push(stateToRestore);
    this.applyNoteState(stateToRestore);
    this.updateUndoRedoButtons();
  }

  private applyNoteState(state: NoteState): void {
      if (!this.currentNoteId) return;
      const note = this.notes.get(this.currentNoteId);
      if (!note) return;
      
      note.title = state.title;
      note.sections = state.sections;
      note.polishedNote = state.polishedNote;
      note.editorFormat = state.editorFormat;

      this.editorTitle.textContent = note.title;
      this.renderNoteContent(note);
      this.saveDataToStorage();
  }
  
  private updateUndoRedoButtons(): void {
    if (!this.currentNoteId) {
        this.undoButton.disabled = true;
        this.redoButton.disabled = true;
        return;
    };
    const history = this.noteHistories.get(this.currentNoteId);
    this.undoButton.disabled = !history || history.undo.length <= 1;
    this.redoButton.disabled = !history || history.redo.length === 0;
  }

  // --- Utility Functions ---
  private triggerHapticFeedback(pattern: number | number[] = 5): void {
    if ('vibrate' in navigator) {
        try {
            navigator.vibrate(pattern);
        } catch (e) {
            // Vibration may be disabled by user settings
            console.log("Haptic feedback failed.", e);
        }
    }
  }

  private setFinalStatus(message: string, isError = false, duration = 3000): void {
    this.isProcessing = false;
    this.recordingStatus.textContent = message;
    if (isError) {
      document.body.classList.add('error');
    }
    document.body.classList.remove('is-processing');

    setTimeout(() => {
      this.recordingStatus.textContent = 'Ready to record';
      document.body.classList.remove('error');
      this.setRecordingModalState('hidden');
      this.clearLiveWaveform();
    }, duration);
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
  
  private async getAudioDuration(url: string): Promise<number> {
      return new Promise((resolve, reject) => {
          const audio = new Audio();
          audio.addEventListener('loadedmetadata', () => {
              resolve(audio.duration * 1000); // Return duration in milliseconds
          });
          audio.addEventListener('error', (e) => {
              reject(e.error || new Error('Failed to load audio metadata.'));
          });
          audio.src = url;
      });
  }

  private formatTime(ms: number, showMilliseconds = false): string {
    if (isNaN(ms)) return "0:00";
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = Math.floor((ms % 1000) / 10);
    
    if (showMilliseconds) {
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString()}:${seconds.toString().padStart(2, '0')}`;
  }

  private setAppHeight(): void {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
  }

  private updatePlaceholderVisibility(element: HTMLElement): void {
      const text = (element as HTMLDivElement).innerText;
      if (text.trim() === '') {
          element.classList.add('placeholder-active');
      } else {
          element.classList.remove('placeholder-active');
      }
  }

  private handleKeyDown(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
          e.preventDefault();
          if (e.shiftKey) {
              this.redo();
          } else {
              this.undo();
          }
      }
  }

  private handleOutsideClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    // Hide sidebar on outside click on mobile
    if (this.isMobile && !this.appContainer.classList.contains('sidebar-collapsed')) {
      if (!target.closest('.sidebar') && !target.closest('.sidebar-toggle-button')) {
        this.appContainer.classList.add('sidebar-collapsed');
      }
    }
  }

}

// Initialize the app
new VoiceNotesApp();