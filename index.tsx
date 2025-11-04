/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/* tslint:disable */

import {GoogleGenAI, Type} from '@google/genai';
import {marked} from 'marked';

// --- Standalone Utility Functions ---
function blobToBase64(blob: Blob): Promise<string> {
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

/**
 * Groups an array of timed words into lines.
 * A new line is started if there's a significant pause between words.
 */
function groupWordsIntoLines(words: TimedWord[]): TimedLine[] {
    if (!words || words.length === 0) {
        return [];
    }

    const lines: TimedLine[] = [];
    let currentLine: TimedWord[] = [];
    const MAX_PAUSE_BETWEEN_WORDS = 0.5; // seconds

    words.forEach((word, index) => {
        if (currentLine.length === 0) {
            currentLine.push(word);
        } else {
            const previousWord = currentLine[currentLine.length - 1];
            const pause = word.start - previousWord.end;

            if (pause < MAX_PAUSE_BETWEEN_WORDS) {
                currentLine.push(word);
            } else {
                lines.push({
                    text: currentLine.map(w => w.word).join(' '),
                    start: currentLine[0].start,
                    end: currentLine[currentLine.length - 1].end,
                });
                currentLine = [word];
            }
        }
    });

    // Add the last line
    if (currentLine.length > 0) {
        lines.push({
            text: currentLine.map(w => w.word).join(' '),
            start: currentLine[0].start,
            end: currentLine[currentLine.length - 1].end,
        });
    }

    return lines;
}


// --- AI Helper Class for Gemini API interactions ---
const AI_MODEL_NAME = 'gemini-flash-lite-latest';

class AIHelper {
  private genAI: GoogleGenAI;

  constructor() {
    this.genAI = new GoogleGenAI({apiKey: process.env.API_KEY});
  }

  async structureVoiceMemo(audioBlob: Blob): Promise<NoteSection[]> {
    const base64Audio = await blobToBase64(audioBlob);
    const audioPart = {
      inlineData: {
        mimeType: audioBlob.type,
        data: base64Audio,
      },
    };

    const prompt = `You are an expert musical assistant for a songwriter. I'm providing an audio voice memo.
Your task is to transcribe the audio and structure it into a clear, organized format for songwriting.

Follow these rules:
1. First, transcribe the audio, which may contain singing, humming, speech, and musical instruments.
2. Next, analyze the transcription to identify distinct song sections (e.g., Verse, Chorus, Bridge, Intro, etc.). If the structure isn't clear, use logical groupings like "Idea 1", "Idea 2".
3. Clean up the content: remove filler words (um, uh), correct obvious transcription errors, and format lyrics cleanly. Preserve the core creative ideas from the audio. Do NOT add any new lyrics or ideas.
4. Format the final output as a JSON object. This object must be an array of "NoteSection" objects.
5. Each NoteSection object must have two properties: "type" (a string, e.g., "Verse") and "content" (a string with the lyrics/notes for that section).
6. If the audio contains very little content, you can create a single section (e.g., "Verse" or "Lyric Idea").`;

    const response = await this.genAI.models.generateContent({
      model: AI_MODEL_NAME,
      contents: { parts: [ audioPart, { text: prompt } ] },
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
    try {
        const structuredResult = JSON.parse(jsonString).map((section: any) => ({...section, takes: []}));
        return structuredResult;
    } catch (e) {
        console.error("Failed to parse AI JSON response for structuring:", e);
        console.error("Received text:", jsonString);
        // Fallback: return the raw text as a single section
        return [{ type: 'Verse', content: jsonString, takes: [] }];
    }
  }

  async syncLyricsWithWordTimings(audioBlob: Blob): Promise<TimedWord[]> {
    const base64Audio = await blobToBase64(audioBlob);
    const audioPart = {
      inlineData: {
        mimeType: audioBlob.type,
        data: base64Audio,
      },
    };

    const prompt = `You are an expert Speech-to-Text processor specializing in musical vocals. Your task is to analyze the provided audio and produce a highly accurate, word-for-word transcription with precise timing.

Follow these rules strictly:
1.  Transcribe the sung vocals in the audio.
2.  Format the entire output as a single, clean JSON array of objects.
3.  Each object in the array represents a single word.
4.  Each object MUST contain three keys:
    - "word": The transcribed word as a string.
    - "start": The start time of the word in seconds (float).
    - "end": The end time of the word in seconds (float).
5.  Do NOT include any additional commentary, text, or formatting outside of the final JSON array. The response must be only the JSON.`;
        
    const response = await this.genAI.models.generateContent({
        model: AI_MODEL_NAME,
        contents: { parts: [audioPart, { text: prompt }] },
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        word: { type: Type.STRING },
                        start: { type: Type.NUMBER },
                        end: { type: Type.NUMBER }
                    },
                    required: ["word", "start", "end"]
                }
            }
        }
    });

    const jsonString = response.text;
    const timedWords: TimedWord[] = JSON.parse(jsonString);
    return timedWords;
  }
}


// --- Interfaces for data structures ---
interface AudioTake {
  id: string;
  url: string | null;
  data: string | null; // base64
  mimeType: string | null;
  duration: number | null; // ms
  timestamp: number;
}

interface TimedWord {
    word: string;
    start: number; // in seconds
    end: number;   // in seconds
}

interface TimedLine {
  text: string;
  editedText?: string;
  start: number; // in seconds
  end?: number;  // in seconds
}

interface NoteSection {
  type: string;
  content: string;
  takes: AudioTake[];
}

interface Note {
  id:string;
  title: string;
  rawTranscription: string;
  polishedNote: string; // Used for 'open' format content and list view snippets
  sections: NoteSection[]; // Used for 'structured' format
  editorFormat: 'structured' | 'open';
  timestamp: number;
  projectId: string | null;
  syncedWords: TimedWord[] | null;
  syncedLines: TimedLine[] | null;
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
  private aiHelper: AIHelper;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private isRecording = false;
  private isPaused = false;
  private isProcessing = false;
  private stream: MediaStream | null = null;
  private recordingTargetSectionIndex: number | null = null;
  private isPlaybackActive = false;

  // Live recording UI properties
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private waveformDataArray: Uint8Array | null = null;
  private waveformDrawingId: number | null = null;
  private lyriqLiveWaveformDrawingId: number | null = null;
  private timerIntervalId: number | null = null;
  private recordingStartTime: number = 0;

  // Data management properties
  private notes: Map<string, Note> = new Map();
  private projects: Map<string, Project> = new Map();
  private currentNoteId: string | null = null;
  private currentFilter: { type: 'all' | 'project'; id: string | null } = { type: 'all', id: null };
  private activeLibraryTab: string = 'songs';
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
  private sidebarBackdrop: HTMLDivElement;
  private sidebarToggleButton: HTMLButtonElement;
  private sidebarNewNoteButton: HTMLButtonElement;
  private allNotesButton: HTMLAnchorElement;
  private projectsList: HTMLUListElement;
  private newProjectButton: HTMLButtonElement;
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
  private viewToggleButton: HTMLButtonElement;
  private undoButton: HTMLButtonElement;
  private redoButton: HTMLButtonElement;
  
  // Recording interface elements
  private recordingInterface: HTMLDivElement;
  private recordingInterfaceHandle: HTMLDivElement;
  private finishRecordingButton: HTMLButtonElement;
  private liveRecordingTitle: HTMLDivElement;
  private liveWaveformContainer: HTMLDivElement;
  private liveWaveformCanvas: HTMLCanvasElement;
  private liveWaveformCtx: CanvasRenderingContext2D | null;
  private liveRecordingTimerDisplay: HTMLDivElement;
  private recordingPeekIndicator: HTMLDivElement;
  private previewPlayhead: HTMLDivElement;
  
  // Notes List View elements
  private notesListView: HTMLDivElement;
  private notesListTitle: HTMLHeadingElement;
  private notesListBackButton: HTMLButtonElement;
  private notesListContent: HTMLDivElement;
  private libraryTabsContainer: HTMLDivElement;
  private listViewNewNoteFab: HTMLButtonElement;

  // Note Audio Playback elements
  private takesAudioPlayer: HTMLAudioElement;
  private recordingPreviewPlayer: HTMLAudioElement;
  private isScrubbingPreview = false;
  private previewAudioBuffer: AudioBuffer | null = null;
  private previewAnimationId: number | null = null;


  // Lyriq Player elements and state
  private lyriqPlayerView: HTMLDivElement;
  private lyriqSidebarToggleButton: HTMLButtonElement;
  private lyriqViewToggleButton: HTMLButtonElement;
  private lyriqModeToggleBtn: HTMLButtonElement;
  private audioUploadInput: HTMLInputElement;
  private lyriqAudioPlayer: HTMLAudioElement;
  private lyriqVocalAudioPlayer: HTMLAudioElement;
  private lyricsContainer: HTMLDivElement;
  private lyriqSongTitle: HTMLHeadingElement;
  private lyriqInitialControls: HTMLDivElement;
  private lyriqInitialAddBeatBtn: HTMLButtonElement;
  private lyriqInitialRecordBtn: HTMLButtonElement;
  
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

  // Lyriq Modal: Volume Mixer
  private lyriqVolumeMixer: HTMLDivElement;
  private beatVolumeSliderContainer: HTMLDivElement;
  private vocalVolumeSliderContainer: HTMLDivElement;
  private beatVolumeFill: HTMLDivElement;
  private vocalVolumeFill: HTMLDivElement;
  private beatVolumePercentage: HTMLSpanElement;
  private vocalVolumePercentage: HTMLSpanElement;

  private beatAudioBuffer: AudioBuffer | null = null;
  private vocalAudioBuffer: AudioBuffer | null = null;
  
  // Volume State
  private beatVolume = 1.0;
  private vocalVolume = 1.0;

  // Scrubbing State
  private isScrubbing = false;
  private seekDebounceTimer: number | null = null;
  
  // Volume Drag State
  private isVolumeViewActive = false;
  private draggingVolumeTrack: MixerTrack | null = null;

  private lyriqIsPlaying = false;
  private lyriqAutoScrollEnabled = true;
  private lyriqCurrentLineIndex = -1;
  private lyriqLineElements: HTMLElement[] | null = null;
  private activeMixerTrack: MixerTrack = 'beat';
  private vocalBlobForMaster: Blob | null = null;
  private lyriqMode: 'karaoke' | 'editor' = 'editor';
  private lyriqLyricsAreDirty = false;
  
  private lyriqAnimationId: number | null = null;
  private readonly PIXELS_PER_SECOND = 100;
  private LYRIQ_HIGHLIGHT_OFFSET = 0.15; // 150ms lookahead for anticipation
  
  private isMobile: boolean = window.innerWidth <= 1024;
  
  // High-precision timing properties
  private lyriqAudioContext: AudioContext | null = null;
  private lyriqBeatSourceNode: MediaElementAudioSourceNode | null = null;
  private lyriqVocalSourceNode: MediaElementAudioSourceNode | null = null;
  private lyriqPlaybackStartTime: number = 0;
  private lyriqDebugMode = false;

  // Debug panel elements
  private lyriqDebugPanel: HTMLDivElement;
  private debugTime: HTMLSpanElement;
  private debugWordIndex: HTMLSpanElement;
  private debugWordTime: HTMLSpanElement;

  // Long press properties
  private longPressTimer: number | null = null;
  private readonly LONG_PRESS_DURATION = 500; // 500ms for long press

  // Swipe to delete properties
  private isSwiping = false;
  private swipeStartX = 0;
  private swipeStartTime = 0;
  private currentSwipeCard: HTMLElement | null = null;
  private currentSwipeContainer: HTMLElement | null = null;
  private readonly SWIPE_THRESHOLD = -80; // pixels

  // Drag and drop properties
  private isDraggingCard = false;
  private draggedCard: HTMLElement | null = null;
  private placeholderCard: HTMLElement | null = null;
  private dragOffsetY = 0;


  constructor() {
    // Initialize AI Helper
    this.aiHelper = new AIHelper();

    // Get all necessary DOM elements
    this.appContainer = document.getElementById('appContainer') as HTMLDivElement;
    this.recordButton = document.getElementById('recordButton') as HTMLButtonElement;
    this.recordButtonText = document.getElementById('recordButtonText') as HTMLSpanElement;
    this.recordingStatus = document.getElementById('recordingStatus') as HTMLDivElement;
    this.themeToggleButton = document.getElementById('themeToggleButton') as HTMLButtonElement;
    this.themeToggleIcon = this.themeToggleButton.querySelector('i') as HTMLElement;
    this.editorTitle = document.querySelector('.editor-title') as HTMLDivElement;
    this.sidebar = document.querySelector('.sidebar') as HTMLElement;
    this.sidebarBackdrop = document.getElementById('sidebarBackdrop') as HTMLDivElement;
    this.sidebarToggleButton = document.getElementById('sidebarToggleButton') as HTMLButtonElement;
    this.sidebarNewNoteButton = document.getElementById('sidebarNewNoteButton') as HTMLButtonElement;
    this.allNotesButton = document.getElementById('allNotesButton') as HTMLAnchorElement;
    this.projectsList = document.getElementById('projectsList') as HTMLUListElement;
    this.newProjectButton = document.getElementById('newProjectButton') as HTMLButtonElement;
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
    this.viewToggleButton = document.getElementById('viewToggleButton') as HTMLButtonElement;
    this.undoButton = document.getElementById('undoButton') as HTMLButtonElement;
    this.redoButton = document.getElementById('redoButton') as HTMLButtonElement;
    
    // Recording UI elements
    this.recordingInterface = document.getElementById('recordingInterface') as HTMLDivElement;
    this.recordingInterfaceHandle = document.getElementById('recordingInterfaceHandle') as HTMLDivElement;
    this.finishRecordingButton = document.getElementById('finishRecordingButton') as HTMLButtonElement;
    this.liveRecordingTitle = document.getElementById('liveRecordingTitle') as HTMLDivElement;
    this.liveWaveformContainer = document.getElementById('liveWaveformContainer') as HTMLDivElement;
    this.liveWaveformCanvas = document.getElementById('liveWaveformCanvas') as HTMLCanvasElement;
    this.liveRecordingTimerDisplay = document.getElementById('liveRecordingTimerDisplay') as HTMLDivElement;
    this.recordingPeekIndicator = this.recordingInterface.querySelector('.recording-peek-indicator') as HTMLDivElement;
    this.previewPlayhead = document.getElementById('previewPlayhead') as HTMLDivElement;
    this.liveWaveformCtx = this.liveWaveformCanvas.getContext('2d');
    
    // Notes List View elements
    this.notesListView = document.querySelector('.notes-list-view') as HTMLDivElement;
    this.notesListTitle = document.getElementById('notesListTitle') as HTMLHeadingElement;
    this.notesListBackButton = document.getElementById('notesListBackButton') as HTMLButtonElement;
    this.notesListContent = document.querySelector('.notes-list-content') as HTMLDivElement;
    this.libraryTabsContainer = document.querySelector('.library-tabs') as HTMLDivElement;
    this.listViewNewNoteFab = document.querySelector('.list-view-new-note-fab') as HTMLButtonElement;

    // Note Audio Playback elements
    this.takesAudioPlayer = new Audio();
    this.recordingPreviewPlayer = new Audio();
    
    // Lyriq Player elements
    this.lyriqPlayerView = document.querySelector('.lyriq-player-view') as HTMLDivElement;
    this.lyriqSidebarToggleButton = document.getElementById('lyriqSidebarToggleButton') as HTMLButtonElement;
    this.lyriqViewToggleButton = document.getElementById('lyriqViewToggleButton') as HTMLButtonElement;
    this.lyriqModeToggleBtn = document.getElementById('lyriqModeToggleBtn') as HTMLButtonElement;
    this.audioUploadInput = document.getElementById('audioUpload') as HTMLInputElement;
    this.lyriqAudioPlayer = document.getElementById('lyriqAudio') as HTMLAudioElement;
    this.lyriqVocalAudioPlayer = document.getElementById('lyriqVocalAudio') as HTMLAudioElement;
    this.lyricsContainer = document.getElementById('lyricsContainer') as HTMLDivElement;
    this.lyriqSongTitle = document.getElementById('lyriqSongTitle') as HTMLHeadingElement;
    this.lyriqInitialControls = document.getElementById('lyriqInitialControls') as HTMLDivElement;
    this.lyriqInitialAddBeatBtn = document.getElementById('lyriqInitialAddBeatBtn') as HTMLButtonElement;
    this.lyriqInitialRecordBtn = document.getElementById('lyriqInitialRecordBtn') as HTMLButtonElement;

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

    // Lyriq Modal: Volume Mixer
    this.lyriqVolumeMixer = document.getElementById('lyriqVolumeMixer') as HTMLDivElement;
    this.beatVolumeSliderContainer = document.getElementById('beatVolumeSliderContainer') as HTMLDivElement;
    this.vocalVolumeSliderContainer = document.getElementById('vocalVolumeSliderContainer') as HTMLDivElement;
    this.beatVolumeFill = document.getElementById('beatVolumeFill') as HTMLDivElement;
    this.vocalVolumeFill = document.getElementById('vocalVolumeFill') as HTMLDivElement;
    this.beatVolumePercentage = document.getElementById('beatVolumePercentage') as HTMLSpanElement;
    this.vocalVolumePercentage = document.getElementById('vocalVolumePercentage') as HTMLSpanElement;

    // Debug panel
    this.lyriqDebugPanel = document.getElementById('lyriqDebugPanel') as HTMLDivElement;
    this.debugTime = document.getElementById('debugTime') as HTMLSpanElement;
    this.debugWordIndex = document.getElementById('debugWordIndex') as HTMLSpanElement;
    this.debugWordTime = document.getElementById('debugWordTime') as HTMLSpanElement;

    // Initial setup
    this.bindEventListeners();
    this.setAppHeight();
    this.initTheme();
    this.loadDataFromStorage();
    this.setActiveMixerTrack('beat');
    this.updateLyriqControlsState();

    // Initialize player volume from state
    this.lyriqAudioPlayer.volume = this.beatVolume;
    this.lyriqVocalAudioPlayer.volume = this.vocalVolume;

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
    this.viewToggleButton.addEventListener('click', () => { this.triggerHapticFeedback(); this.toggleEditorLyriqView(); });
    this.undoButton.addEventListener('click', () => { this.triggerHapticFeedback(); this.undo(); });
    this.redoButton.addEventListener('click', () => { this.triggerHapticFeedback(); this.redo(); });

    // Sidebar controls
    this.sidebarToggleButton.addEventListener('click', () => { this.triggerHapticFeedback(); this.toggleSidebar(); });
    this.sidebarBackdrop.addEventListener('click', () => { this.triggerHapticFeedback(); this.toggleSidebar(); });
    this.sidebarNewNoteButton.addEventListener('click', async () => {
        this.triggerHapticFeedback();
        await this.createNewNote();
        this.setActiveView('editor');
    });
    this.newProjectButton.addEventListener('click', () => { this.triggerHapticFeedback(); this.createProject(); });
    this.allNotesButton.addEventListener('click', (e) => {
        this.triggerHapticFeedback();
        e.preventDefault();
        this.currentFilter = { type: 'all', id: null };
        this.setActiveView('list');
    });
    // Context menu for projects
    this.projectsList.addEventListener('contextmenu', (e) => this.handleProjectContextMenu(e));
    this.projectsList.addEventListener('touchstart', (e) => this.handleProjectTouchStart(e as TouchEvent), { passive: false });
    this.projectsList.addEventListener('touchend', () => this.handleNoteTouchEnd()); // Can reuse note's touchend
    this.projectsList.addEventListener('touchmove', () => this.handleNoteTouchEnd());

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
    
    // Swipe to delete & Drag/Drop listeners
    this.songStructureEditor.addEventListener('mousedown', this.handleCardInteractionStart);
    this.songStructureEditor.addEventListener('touchstart', this.handleCardInteractionStart, { passive: false });


    // Notes list view controls
    this.libraryTabsContainer.addEventListener('click', (e) => this.handleLibraryTabClick(e as MouseEvent));
    this.listViewNewNoteFab.addEventListener('click', async () => {
        this.triggerHapticFeedback();
        await this.createNewNote();
        this.setActiveView('editor');
    });
    this.notesListBackButton.addEventListener('click', () => {
        this.triggerHapticFeedback();
        this.setActiveView('editor');
    });

    // Audio Playback Controls for Takes
    this.takesAudioPlayer.addEventListener('ended', () => this.handleTakePlaybackEnded());
    this.takesAudioPlayer.addEventListener('play', () => this.updateAllTakePlayButtons(true));
    this.takesAudioPlayer.addEventListener('pause', () => this.updateAllTakePlayButtons(false));
    
    // Recording Preview Player
    this.recordingPreviewPlayer.addEventListener('ended', this.handlePreviewPlaybackEnded);
    this.recordingPreviewPlayer.addEventListener('play', this.handlePreviewPlaybackPlay);
    this.recordingPreviewPlayer.addEventListener('pause', this.handlePreviewPlaybackPause);

    // Recording Modal Interaction & Scrubbing
    this.recordingInterfaceHandle.addEventListener('click', () => { this.triggerHapticFeedback(); this.toggleRecordingModalVisibility(); });
    this.liveWaveformContainer.addEventListener('mousedown', this.handlePreviewScrubStart);
    this.liveWaveformContainer.addEventListener('touchstart', this.handlePreviewScrubStart, { passive: false });


    // Lyriq Player controls
    this.lyriqSidebarToggleButton.addEventListener('click', () => { this.triggerHapticFeedback(); this.toggleSidebar(); });
    this.lyriqViewToggleButton.addEventListener('click', () => { this.triggerHapticFeedback(); this.toggleEditorLyriqView(); });
    this.lyriqModeToggleBtn.addEventListener('click', () => { this.triggerHapticFeedback(); this.toggleLyriqMode(); });
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
    this.lyriqExpandedVolumeBtn.addEventListener('click', () => { this.triggerHapticFeedback(); this.toggleVolumeView(); });
    
    this.lyriqAudioPlayer.addEventListener('loadedmetadata', () => this.handleLyriqMetadataLoaded());
    this.lyriqAudioPlayer.addEventListener('ended', () => this.handleLyriqEnded());
    
    // Lyriq Mixer Controls
    this.lyriqExpandedAddBeatBtn.addEventListener('click', () => { this.triggerHapticFeedback(); this.handleBeatButtonClick(); });
    this.lyriqExpandedVocalBtn.addEventListener('click', () => { this.triggerHapticFeedback(); this.setActiveMixerTrack('vocal'); });

    // Lyriq Modal Click Toggle
    this.lyriqModalHandle.addEventListener('click', () => { this.triggerHapticFeedback(); this.toggleLyriqModalVisibility(); });
    
    // Lyriq Waveform Scrubbing
    this.lyriqWaveforms.addEventListener('mousedown', this.handleScrubStart);
    this.lyriqWaveforms.addEventListener('touchstart', this.handleScrubStart, { passive: false });
    this.lyriqWaveforms.addEventListener('scroll', this.handleWaveformScroll);


    // Lyriq Volume Mixer Dragging
    this.beatVolumeSliderContainer.addEventListener('mousedown', (e) => this.handleVolumeDragStart(e, 'beat'));
    this.vocalVolumeSliderContainer.addEventListener('mousedown', (e) => this.handleVolumeDragStart(e, 'vocal'));
    this.beatVolumeSliderContainer.addEventListener('touchstart', (e) => this.handleVolumeDragStart(e, 'beat'), { passive: false });
    this.vocalVolumeSliderContainer.addEventListener('touchstart', (e) => this.handleVolumeDragStart(e, 'vocal'), { passive: false });

    // Window and global listeners
    window.addEventListener('resize', () => { 
        this.isMobile = window.innerWidth <= 1024;
        this.setAppHeight();
    });
    window.addEventListener('keydown', (e) => this.handleKeyDown(e));
    document.addEventListener('click', (e) => {
      this.hideContextMenu();
      document.querySelectorAll('.song-section-card.dropdown-is-open').forEach(card => {
        const dropdown = card.querySelector('.section-type-dropdown');
        if (dropdown && !dropdown.contains(e.target as Node)) {
          dropdown.classList.remove('open');
          card.classList.remove('dropdown-is-open');
        }
      });
      // Hide takes menu on outside click
      const takesMenu = document.querySelector('.takes-context-menu');
      if (takesMenu && !takesMenu.contains(e.target as Node) && !(e.target as HTMLElement).closest('.takes-badge')) {
        this.hideTakesMenu();
      }
    });
    
    // Context Menu Listeners (Desktop Right-Click + Mobile Long-Press)
    this.recentNotesList.addEventListener('contextmenu', (e) => this.showNoteContextMenu(e as MouseEvent));
    this.recentNotesList.addEventListener('touchstart', (e) => this.handleNoteTouchStart(e as TouchEvent), { passive: false });
    this.recentNotesList.addEventListener('touchend', () => this.handleNoteTouchEnd());
    this.recentNotesList.addEventListener('touchmove', () => this.handleNoteTouchEnd());
  }

  // --- View Management ---
  private toggleEditorLyriqView(): void {
    if (this.activeView === 'editor') {
        this.setActiveView('lyriq');
    } else if (this.activeView === 'lyriq') {
        this.setActiveView('editor');
    }
  }

  private setActiveView(view: AppView): void {
      // Save any pending edits if leaving Lyriq editor mode
      if (this.activeView === 'lyriq' && this.lyriqMode === 'editor') {
          this.updateNoteFromLyriqEditor();
      }

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
              this.renderNotesList();
              break;
          case 'lyriq':
              this.appContainer.classList.add('lyriq-player-active');
              // Reset to default Karaoke mode when entering the view
              this.lyriqMode = 'karaoke';
              this.lyriqLyricsAreDirty = false;
              this.lyriqPlayerView.classList.remove('editor-mode');
              this.lyricsContainer.contentEditable = 'false';
              this.lyricsContainer.removeEventListener('input', this.handleLyriqEdit);
              const icon = this.lyriqModeToggleBtn?.querySelector('i');
              if (icon) {
                  icon.className = 'fas fa-edit';
                  this.lyriqModeToggleBtn.title = 'Editor Mode';
              }

              this.loadNoteIntoLyriqPlayer();
              const hasAudio = this.beatAudioBuffer || this.vocalAudioBuffer;
              if (hasAudio) {
                  this.lyriqPlayerView.classList.remove('empty-state');
                  this.setLyriqModalState('peeking');
              } else {
                  this.lyriqPlayerView.classList.add('empty-state');
                  this.setLyriqModalState('hidden');
              }
              break;
          case 'editor':
              // Default state, no extra class needed
              break;
      }
      
      if (this.isMobile) {
          this.appContainer.classList.add('sidebar-collapsed');
      }

      this.renderSidebar();
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
        const isActive = note.id === this.currentNoteId && this.activeView === 'editor';
        button.className = `sidebar-note-item ${isActive ? 'active' : ''}`;
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
        const isActive = this.activeView === 'list' && this.currentFilter.type === 'project' && this.currentFilter.id === project.id;
        button.className = `sidebar-link ${isActive ? 'active' : ''}`;
        button.dataset.projectId = project.id;
        button.innerHTML = `<i class="fas fa-folder"></i><span>${project.name}</span>`;
        button.addEventListener('click', () => this.filterByProject(project.id));
        li.appendChild(button);
        this.projectsList.appendChild(li);
    });

    // Update main nav active state
    this.allNotesButton.classList.toggle('active', this.activeView === 'list' && this.currentFilter.type === 'all');
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
            // Backwards compatibility for new syncedWords property
            if (typeof (note as any).syncedLyrics !== 'undefined') {
                delete (note as any).syncedLyrics;
            }
            if (typeof note.syncedWords === 'undefined') {
                note.syncedWords = null;
            }
            if (typeof note.syncedLines === 'undefined') {
                note.syncedLines = null;
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
      projectId: this.currentFilter.type === 'project' ? this.currentFilter.id : null,
      syncedWords: null,
      syncedLines: null,
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
    this.triggerHapticFeedback(20); // Success feedback
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
        this.triggerHapticFeedback(20); // Success feedback
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
      <div class="card-delete-zone">
        <i class="fas fa-trash-alt"></i>
      </div>
      <div class="card-swipe-container">
        <div class="section-card-header">
           <div class="drag-handle" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></div>
          <div class="section-type-dropdown">
            <button class="section-type-btn" aria-haspopup="true">
              <span>${section.type}</span>
              <i class="fas fa-chevron-down"></i>
            </button>
            <ul class="section-type-menu" role="menu">
              ${['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Outro', 'Hook', 'Solo'].map(type => `<li><button role="menuitem">${type}</button></li>`).join('')}
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
      const dropdown = target.closest('.section-type-dropdown');
      const isOpening = !dropdown?.classList.contains('open');

      // Close all other dropdowns and remove the elevated z-index class
      this.songStructureEditor.querySelectorAll<HTMLElement>('.song-section-card.dropdown-is-open').forEach(openCard => {
          openCard.classList.remove('dropdown-is-open');
          openCard.querySelector('.section-type-dropdown')?.classList.remove('open');
      });

      if (isOpening) {
        dropdown?.classList.add('open');
        card.classList.add('dropdown-is-open');
      }
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
      card.classList.remove('dropdown-is-open');
    }

    // Handle collapse on header click (if not on a button or dropdown)
    const header = target.closest('.section-card-header');
    if (header && !target.closest('button') && !target.closest('.section-type-dropdown')) {
        card.classList.toggle('collapsed');
    }
  }

  // --- Swipe To Delete & Drag/Drop ---
  private handleCardInteractionStart = (e: MouseEvent | TouchEvent): void => {
    const target = e.target as HTMLElement;

    // Delegate to drag handler if handle is pressed
    if (target.closest('.drag-handle')) {
        this.initDrag(e);
        return;
    }

    // Don't start a swipe if interacting with buttons, dropdowns, content, or drag handle
    if (target.closest('button, [contenteditable="true"], .section-type-dropdown, .drag-handle')) {
        return;
    }
    
    this.currentSwipeCard = target.closest('.song-section-card');
    if (!this.currentSwipeCard) return;

    this.currentSwipeContainer = this.currentSwipeCard.querySelector('.card-swipe-container');
    if (!this.currentSwipeContainer) return;

    this.isSwiping = true;
    this.swipeStartX = this.getPointerX(e);
    this.swipeStartTime = Date.now();
    
    this.currentSwipeContainer.style.transition = 'none';

    document.addEventListener('mousemove', this.handleCardInteractionMove);
    document.addEventListener('touchmove', this.handleCardInteractionMove, { passive: false });
    document.addEventListener('mouseup', this.handleCardInteractionEnd);
    document.addEventListener('touchend', this.handleCardInteractionEnd);
  }

  private handleCardInteractionMove = (e: MouseEvent | TouchEvent): void => {
      if (!this.isSwiping || !this.currentSwipeContainer) return;
      e.preventDefault();
      const currentX = this.getPointerX(e);
      let deltaX = currentX - this.swipeStartX;
      if (deltaX > 0) deltaX = 0;
      deltaX = Math.max(deltaX, this.SWIPE_THRESHOLD - 30);
      this.currentSwipeContainer.style.transform = `translateX(${deltaX}px)`;
  }

  private handleCardInteractionEnd = (e: MouseEvent | TouchEvent): void => {
      if (!this.isSwiping || !this.currentSwipeCard || !this.currentSwipeContainer) return;
  
      this.isSwiping = false;
      const currentX = this.getPointerX(e);
      const deltaX = currentX - this.swipeStartX;
  
      if (deltaX < this.SWIPE_THRESHOLD) {
          const swipedCard = this.currentSwipeCard;
          const swipeContainer = this.currentSwipeContainer;
          
          // Finish the swipe-out animation
          swipeContainer.style.transition = 'transform 0.25s ease-in, opacity 0.2s 0.05s ease-in';
          swipeContainer.style.transform = `translateX(-105%)`;
          swipeContainer.style.opacity = '0';
  
          // Start the vertical collapse animation after a short delay
          setTimeout(() => {
              this.deleteSectionCard(swipedCard);
          }, 100);
      } else {
          this.currentSwipeContainer.style.transition = 'transform var(--transition-fast)';
          this.currentSwipeContainer.style.transform = 'translateX(0px)';
      }
  
      this.currentSwipeCard = null;
      this.currentSwipeContainer = null;
      document.removeEventListener('mousemove', this.handleCardInteractionMove);
      document.removeEventListener('touchmove', this.handleCardInteractionMove);
      document.removeEventListener('mouseup', this.handleCardInteractionEnd);
      document.removeEventListener('touchend', this.handleCardInteractionEnd);
  }
  
  private initDrag = (e: MouseEvent | TouchEvent): void => {
    e.preventDefault();
    const card = (e.target as HTMLElement).closest<HTMLElement>('.song-section-card');
    if (!card || this.isDraggingCard) return;

    this.draggedCard = card;
    this.isDraggingCard = true;

    const rect = card.getBoundingClientRect();
    this.dragOffsetY = this.getPointerY(e) - rect.top;

    this.placeholderCard = document.createElement('div');
    this.placeholderCard.className = 'song-section-card-placeholder';
    this.placeholderCard.style.height = `${rect.height}px`;

    card.parentElement!.insertBefore(this.placeholderCard, card);
    
    card.classList.add('dragging');
    card.style.width = `${rect.width}px`;
    card.style.top = `${card.offsetTop}px`;

    // A small delay to allow the DOM to update before starting move calcs
    requestAnimationFrame(() => {
        document.addEventListener('mousemove', this.handleDragMove);
        document.addEventListener('touchmove', this.handleDragMove, { passive: false });
        document.addEventListener('mouseup', this.handleDragEnd);
        document.addEventListener('touchend', this.handleDragEnd);
    });
  }

  private handleDragMove = (e: MouseEvent | TouchEvent): void => {
      if (!this.isDraggingCard || !this.draggedCard) return;
      e.preventDefault();

      const pointerY = this.getPointerY(e);
      const containerRect = this.songStructureEditor.getBoundingClientRect();
      this.draggedCard.style.top = `${pointerY - containerRect.top - this.dragOffsetY}px`;

      const cards = [...this.songStructureEditor.querySelectorAll('.song-section-card:not(.dragging)')] as HTMLElement[];
      
      let closestCard: HTMLElement | null = null;
      let smallestDistance = Infinity;

      cards.forEach(card => {
          const rect = card.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          const distance = Math.abs(pointerY - midY);
          if (distance < smallestDistance) {
              smallestDistance = distance;
              closestCard = card;
          }
      });
      
      if (closestCard) {
          const rect = closestCard.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          if (pointerY < midY) {
              closestCard.parentElement!.insertBefore(this.placeholderCard!, closestCard);
          } else {
              closestCard.parentElement!.insertBefore(this.placeholderCard!, closestCard.nextSibling);
          }
      }
  }

  private handleDragEnd = (): void => {
      if (!this.isDraggingCard || !this.draggedCard) return;

      this.isDraggingCard = false;
      
      this.draggedCard.classList.remove('dragging');
      this.draggedCard.style.width = '';
      this.draggedCard.style.top = '';

      if (this.placeholderCard) {
          this.placeholderCard.parentElement!.replaceChild(this.draggedCard, this.placeholderCard);
      }
      
      this.draggedCard = null;
      this.placeholderCard = null;

      document.removeEventListener('mousemove', this.handleDragMove);
      document.removeEventListener('touchmove', this.handleDragMove);
      document.removeEventListener('mouseup', this.handleDragEnd);
      document.removeEventListener('touchend', this.handleDragEnd);

      this.reorderSectionsAfterDrag();
  }
  
  private reorderSectionsAfterDrag(): void {
    if (!this.currentNoteId) return;
    const note = this.notes.get(this.currentNoteId);
    if (!note) return;

    const cards = this.songStructureEditor.querySelectorAll('.song-section-card');
    const newSections: NoteSection[] = [];
    const oldSectionsCopy = [...note.sections];

    cards.forEach(card => {
        const oldIndex = parseInt((card as HTMLElement).dataset.index!, 10);
        newSections.push(oldSectionsCopy[oldIndex]);
    });

    note.sections = newSections;

    // Re-index the data-index attributes in the DOM for future operations
    cards.forEach((card, index) => {
        (card as HTMLElement).dataset.index = index.toString();
    });

    this.saveDataToStorage();
    this.saveNoteState();
  }

  private deleteSectionCard(card: HTMLElement): void {
      const index = parseInt(card.dataset.index!, 10);
      const note = this.notes.get(this.currentNoteId!);
  
      if (note && note.sections[index] !== undefined) {
          this.updateCurrentNoteContent(); // Save state before deleting
          this.saveNoteState();
          
          const animationDuration = 350;
          const easing = 'cubic-bezier(0.4, 0, 0.2, 1)';
  
          // Animate the card collapsing vertically
          card.style.transition = `all ${animationDuration}ms ${easing}`;
          card.style.overflow = 'hidden';
          card.style.opacity = '0';
          card.style.maxHeight = '0px';
          card.style.margin = '0';
          card.style.padding = '0';
  
          setTimeout(() => {
              note.sections.splice(index, 1);
              card.remove();
              // Re-index remaining cards
              this.songStructureEditor.querySelectorAll<HTMLDivElement>('.song-section-card').forEach((c, i) => c.dataset.index = i.toString());
              this.saveDataToStorage();
              this.saveNoteState(); // Save state after deleting
          }, animationDuration);
      }
  }


  // --- Notes List View ---
  private renderNotesList(): void {
      this.notesListContent.innerHTML = '';
      let notesArray = [...this.notes.values()].sort((a,b) => b.timestamp - a.timestamp);

      // Filter notes based on the current filter
      if (this.currentFilter.type === 'project') {
          notesArray = notesArray.filter(note => note.projectId === this.currentFilter.id);
          const project = this.projects.get(this.currentFilter.id!);
          this.notesListTitle.textContent = project ? project.name : 'Project';
      } else {
          this.notesListTitle.textContent = 'Library';
      }

      if (notesArray.length === 0) {
        this.notesListContent.innerHTML = `
          <div class="placeholder-content">
              <p>Your Library is Empty</p>
              <span>Click the button in the bottom right to create a new note.</span>
          </div>`;
        return;
      }
      
      // For now, just one group. Can expand later with date grouping.
      const group = document.createElement('div');
      group.className = 'notes-group';
      const groupTitleText = this.currentFilter.type === 'project' ? 'Notes' : 'All Notes';
      group.innerHTML = `<h2 class="notes-group-title">${groupTitleText}</h2>`;
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

  private handleLibraryTabClick(e: MouseEvent): void {
      const target = e.target as HTMLElement;
      const button = target.closest<HTMLButtonElement>('.library-tab-btn');
      if (button && !button.classList.contains('active')) {
          this.triggerHapticFeedback();
          this.libraryTabsContainer.querySelector('.active')?.classList.remove('active');
          button.classList.add('active');
          this.activeLibraryTab = button.dataset.tab!;
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
        const errMessage = (err as Error).message;
        if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
            this.recordingStatus.innerHTML = 'Microphone access denied. <br> Please enable it in your browser settings to record.';
        } else if (errMessage.includes('AVAudioSession')) { // Specific error for iOS
            this.recordingStatus.innerHTML = 'Could not start microphone. <br> Another app might be using it. Please try again.';
        } else {
            this.recordingStatus.textContent = 'Could not access microphone.';
        }
        this.setRecordingModalState('hidden');
    }
  }

  private async toggleRecording(): Promise<void> {
      if (this.isProcessing) return;

      // If in a paused state, the button now controls playback.
      if (this.isPaused) {
          this.toggleRecordingPlayback();
          return;
      }

      // START a new recording session
      if (!this.isRecording) {
          if (this.activeView === 'lyriq') {
            this.toggleLyriqRecording();
            return;
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

      // PAUSE: If already recording (and not paused), pause.
      this.mediaRecorder?.pause();
      this.isPaused = true;
      this.stopTimer();
      this.stopLiveWaveform();
      this.preparePreview();
      this.updateRecordingStateUI();
  }

  private toggleRecordingPlayback(): void {
    if (this.isPlaybackActive) {
        this.recordingPreviewPlayer.pause();
    } else {
        if (this.audioChunks.length > 0 && this.recordingPreviewPlayer.src) {
            this.recordingPreviewPlayer.play();
        }
    }
  }

  private handlePreviewPlaybackEnded = (): void => {
      this.isPlaybackActive = false;
      this.recordingPreviewPlayer.currentTime = 0; // Reset to start
      this.stopPreviewAnimation();
      this.updatePreviewPlayhead(0);
      this.updateRecordingStateUI();
  }
  private handlePreviewPlaybackPlay = (): void => {
      this.isPlaybackActive = true;
      this.startPreviewAnimation();
      this.updateRecordingStateUI();
  }
  private handlePreviewPlaybackPause = (): void => {
      this.isPlaybackActive = false;
      this.stopPreviewAnimation();
      this.updateRecordingStateUI();
  }

  private async finishRecording(): Promise<void> {
      if (!this.isRecording || this.isProcessing) return;
      
      if (this.isPlaybackActive) {
        this.recordingPreviewPlayer.pause();
        this.isPlaybackActive = false;
      }
      this.cleanupPreview();


      this.isProcessing = true;
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
          this.mediaRecorder.stop();
      }
      
      this.stopLiveWaveform();
      this.stopTimer();
      this.updateRecordingStateUI();
      // 'onstop' will handle the rest
  }

  private async discardRecording(hideModal = true): Promise<void> {
    if (this.isPlaybackActive) {
        this.recordingPreviewPlayer.pause();
    }
    this.isPlaybackActive = false;
    this.cleanupPreview();

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.onstop = null; // Prevent processing
      this.mediaRecorder.stop();
    }

    this.cleanupAudioResources(); // Centralized cleanup

    this.audioChunks = [];
    this.isRecording = false;
    this.isPaused = false;
    this.isProcessing = false;
    this.recordingTargetSectionIndex = null;

    this.stopTimer();
    this.clearLiveWaveform();
    this.liveRecordingTimerDisplay.textContent = '00:00.00';

    if (hideModal) {
      this.setRecordingModalState('hidden');
    }
    this.updateRecordingStateUI();
  }

  /**
   * Centralized cleanup function to stop all audio tracks, close the AudioContext,
   * and nullify related properties. This is critical for releasing the microphone
   * and preventing errors on subsequent recordings, especially on iOS.
   */
  private cleanupAudioResources(): void {
    // Stop all media stream tracks to release the microphone. This is the most critical part.
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;

    // Stop any running waveform animations.
    this.stopLiveWaveform();
    this.stopLyriqLiveWaveform();

    // Close the AudioContext to release the audio hardware session.
    if (this.audioContext && this.audioContext.state !== 'closed') {
        this.audioContext.close().catch(e => console.error("Error closing audio context", e));
    }

    // Nullify properties to prevent stale references on the next recording.
    this.audioContext = null;
    this.analyserNode = null;
    this.waveformDataArray = null;
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
          try {
            this.isRecording = false;
            this.isPaused = false;
            
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
                
                await this.processRecordingForLyriq(audioBlob);
        
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
                        data: await blobToBase64(audioBlob),
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
              await this.processRecordingWithAI(audioBlob);
            }
            this.recordingTargetSectionIndex = null; // Reset target
          } finally {
            this.cleanupAudioResources();
          }
        };
    
        this.mediaRecorder.start(100); // Trigger dataavailable every 100ms
        this.isRecording = true;
        this.isPaused = false;
        
        if (this.activeView === 'lyriq') {
            this.startLyriqLiveWaveform();
        } else {
            const note = this.notes.get(this.currentNoteId!);
            if (note) {
                this.liveRecordingTitle.textContent = note.title || 'New Recording';
                this.liveRecordingTitle.contentEditable = 'true';
            }
            this.startLiveWaveform();
        }
        
        this.startTimer();
        this.updateRecordingStateUI();

    } catch (error) {
        console.error("Error creating MediaRecorder:", error);
        this.recordingStatus.textContent = 'Recording failed to start.';
        // This is the key change. Call the main cleanup/reset function.
        // It ensures the microphone stream is released even if MediaRecorder fails to start.
        this.discardRecording(true);
    }
  }

  private async processRecordingWithAI(audioBlob: Blob): Promise<void> {
    if (!this.currentNoteId) return;

    document.body.classList.add('is-processing');
    this.recordingStatus.textContent = 'Structuring note...';
    
    try {
      const structuredResult = await this.aiHelper.structureVoiceMemo(audioBlob);
      const note = this.notes.get(this.currentNoteId)!;
      
      const isNoteEmpty = note.sections.length === 0 || 
                          (note.sections.length === 1 && note.sections[0].content.trim() === '');

      this.updateCurrentNoteContent();
      this.saveNoteState(); // Save state before AI polish

      if (isNoteEmpty) {
          note.sections = structuredResult;
      } else {
          note.sections.push(...structuredResult);
      }
      
      note.rawTranscription = ''; // No longer needed
      note.polishedNote = this.flattenSections(note.sections);
      note.timestamp = Date.now();
      
      this.saveDataToStorage();
      this.saveNoteState(); // Save state after AI polish
      this.setActiveNote(note.id);
      this.renderSidebar();
      this.setFinalStatus('Note processed successfully!');

    } catch (error) {
      console.error('Error during transcription/processing:', error);
      let errorMessage = 'Error processing audio.';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      this.setFinalStatus(errorMessage, true);
    }
  }

  private async processRecordingForLyriq(audioBlob: Blob): Promise<void> {
    if (!this.currentNoteId) return;

    this.lyricsContainer.innerHTML = '<p class="lyriq-line placeholder">Syncing lyrics...</p>';
    this.isProcessing = true;
    this.updateLyriqControlsState();

    try {
        const timedWords = await this.aiHelper.syncLyricsWithWordTimings(audioBlob);
        const timedLines = groupWordsIntoLines(timedWords);
        
        const note = this.notes.get(this.currentNoteId)!;
        note.syncedWords = timedWords;
        note.syncedLines = timedLines;
        
        // Also update the note sections with the new transcription for the editor view
        const fullText = timedLines.map(l => l.text).join('\n');
        note.sections = [{ type: 'Verse', content: fullText, takes: [] }];
        note.polishedNote = fullText;
        note.timestamp = Date.now();
        
        this.saveDataToStorage();
        this.saveNoteState();
        
        this.loadNoteIntoLyriqPlayer();
        this.triggerHapticFeedback(20);

    } catch (error) {
        console.error("Error syncing lyrics:", error);
        this.lyricsContainer.innerHTML = '<p class="lyriq-line placeholder">Could not sync lyrics. Please try again.</p>';
        setTimeout(() => this.loadNoteIntoLyriqPlayer(), 2000); // Revert to previous state
        this.triggerHapticFeedback([40, 30, 40]);
    } finally {
        this.isProcessing = false;
        this.updateLyriqControlsState();
    }
  }
  
  private updateRecordingStateUI(): void {
    const isSessionActive = this.isRecording || this.isProcessing;
    this.finishRecordingButton.style.display = isSessionActive ? 'flex' : 'none';

    document.body.classList.toggle('is-processing', this.isProcessing);
    this.recordingInterface.classList.toggle('playback-mode', this.isPaused);


    this.recordButton.classList.remove('recording', 'paused');
    const recordIcon = this.recordButton.querySelector('.fa-microphone') as HTMLElement;
    const stopIcon = this.recordButton.querySelector('.fa-stop') as HTMLElement;
    const playIcon = this.recordButton.querySelector('.fa-play') as HTMLElement;
    const pauseIcon = this.recordButton.querySelector('.fa-pause') as HTMLElement;
    
    // Hide all icons initially
    recordIcon.style.display = 'none';
    stopIcon.style.display = 'none';
    playIcon.style.display = 'none';
    pauseIcon.style.display = 'none';
    
    const isPeeking = this.recordingInterface.classList.contains('peeking');
    this.recordingPeekIndicator.classList.toggle('active', isPeeking && this.isRecording && !this.isPaused);

    if (this.isProcessing) {
      recordIcon.style.display = 'inline-block';
      this.recordButtonText.textContent = '';
      return;
    }

    if (isSessionActive) {
        this.recordButtonText.textContent = '';
        if (this.isPaused) {
            this.recordButton.classList.add('paused');
            if (this.isPlaybackActive) {
                pauseIcon.style.display = 'inline-block';
            } else {
                playIcon.style.display = 'inline-block';
            }
        } else { // Actively recording
            this.recordButton.classList.add('recording');
            stopIcon.style.display = 'inline-block';
        }
    } else { // Idle
        recordIcon.style.display = 'inline-block';
        this.recordButtonText.textContent = '';
    }
  }

  // --- Live Waveform ---
  /**
   * Gets or creates the shared AudioContext. This is necessary because browsers
   * often suspend audio contexts until a user gesture.
   */
  private getAudioContext(): AudioContext | null {
    // Re-use existing context or create a new one
    if (!this.audioContext || this.audioContext.state === 'closed') {
        try {
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        } catch (e) {
            console.error("Failed to create AudioContext", e);
            return null;
        }
    }

    // A context may be suspended by the browser; it must be resumed by a user gesture.
    if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
    }
    
    return this.audioContext;
  }

  private startLiveWaveform(): void {
    if (!this.stream || !this.stream.active) {
        console.error("Cannot start live waveform: stream is null or inactive.");
        return;
    }

    try {
        const audioContext = this.getAudioContext();
        if (!audioContext) {
            console.error("AudioContext is not available for live waveform.");
            return;
        }

        // Must create a new source and analyser for each new stream.
        const source = audioContext.createMediaStreamSource(this.stream);
        this.analyserNode = audioContext.createAnalyser();
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
    } catch(e) {
        console.error("Error initializing audio context for waveform:", e);
        this.stopLiveWaveform();
    }
  }

  private stopLiveWaveform(): void {
    if (this.waveformDrawingId) {
      cancelAnimationFrame(this.waveformDrawingId);
      this.waveformDrawingId = null;
    }
  }

  private startLyriqLiveWaveform(): void {
    if (!this.stream || !this.stream.active || !this.vocalWaveformCtx) {
        console.error("Cannot start Lyriq live waveform: stream or context is missing.");
        return;
    }
    
    const audioContext = this.getAudioContext();
    if (!audioContext) {
        console.error("Cannot start Lyriq waveform: AudioContext is not available.");
        return;
    }
    
    // We must create a new source and analyser for each new stream to avoid using a closed stream.
    try {
        const source = audioContext.createMediaStreamSource(this.stream);
        this.analyserNode = audioContext.createAnalyser();
        this.analyserNode.fftSize = 2048;
        source.connect(this.analyserNode);
        this.waveformDataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
    } catch(e) {
        console.error("Error initializing audio nodes for Lyriq waveform:", e);
        return;
    }


    const canvas = this.vocalWaveformCtx.canvas;
    const ctx = this.vocalWaveformCtx;
    const scrollContainer = this.lyriqWaveforms;

    // If there's no beat, the canvas width might be 0. Set an initial width.
    if (canvas.width <= 1) {
        const parentWidth = scrollContainer.clientWidth;
        const newWidth = parentWidth > 0 ? parentWidth : 600; // Fallback width
        canvas.width = newWidth;
        if (this.beatWaveformCanvas) this.beatWaveformCanvas.width = newWidth;
    }

    const centerY = canvas.height / 2;
    // Clear the canvas before starting a new live recording
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const draw = () => {
        if (!this.isRecording || this.isPaused || !this.analyserNode || !this.waveformDataArray || !ctx) {
            return; // Stop drawing if recording stops
        }

        this.analyserNode.getByteTimeDomainData(this.waveformDataArray);
        
        const elapsedSeconds = (Date.now() - this.recordingStartTime) / 1000;
        const currentX = elapsedSeconds * this.PIXELS_PER_SECOND;

        // Dynamically expand canvas if we're about to draw off-screen
        if (currentX > canvas.width - 200) { // 200px buffer
            canvas.width += scrollContainer.clientWidth;
            if (this.beatWaveformCanvas) this.beatWaveformCanvas.width = canvas.width;
        }

        // Find the peak amplitude for this frame to draw a simple line
        let peak = 0;
        for (let i = 0; i < this.waveformDataArray.length; i++) {
            const v = Math.abs(this.waveformDataArray[i] / 128.0 - 1.0);
            if (v > peak) peak = v;
        }
        const lineHeight = Math.max(1, peak * centerY); // Ensure at least 1px line
        
        // Draw a vertical line representing the amplitude
        ctx.fillStyle = '#fff'; // Vocal color
        ctx.fillRect(currentX, centerY - lineHeight, 2, lineHeight * 2);

        this.lyriqLiveWaveformDrawingId = requestAnimationFrame(draw);
    };

    draw();
  }

  private stopLyriqLiveWaveform(): void {
    if (this.lyriqLiveWaveformDrawingId) {
      cancelAnimationFrame(this.lyriqLiveWaveformDrawingId);
      this.lyriqLiveWaveformDrawingId = null;
    }
  }

  private clearLiveWaveform(): void {
    if (this.liveWaveformCtx) {
        this.liveWaveformCtx.clearRect(0, 0, this.liveWaveformCanvas.width, this.liveWaveformCanvas.height);
    }
  }

  private async preparePreview(): Promise<void> {
    if (this.audioChunks.length === 0 || !this.liveWaveformCtx) return;

    const previewBlob = new Blob(this.audioChunks, { type: this.mediaRecorder!.mimeType });
    
    // Create URL for playback
    const previewUrl = URL.createObjectURL(previewBlob);
    this.recordingPreviewPlayer.src = previewUrl;

    // Process for waveform rendering
    try {
        const arrayBuffer = await previewBlob.arrayBuffer();
        const audioContext = this.getAudioContext();
        if (!audioContext) return;
        this.previewAudioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        this.drawWaveform(this.previewAudioBuffer, this.liveWaveformCtx, 'var(--color-accent)');

        this.recordingPreviewPlayer.onloadedmetadata = () => {
            this.updatePreviewPlayhead(0);
        };

    } catch(e) {
        console.error("Error processing preview audio:", e);
        // Fallback to simple paused view if waveform fails
        this.drawPausedWaveform();
    }
  }

  private cleanupPreview(): void {
      this.stopPreviewAnimation();
      if (this.recordingPreviewPlayer.src) {
          URL.revokeObjectURL(this.recordingPreviewPlayer.src);
          this.recordingPreviewPlayer.src = '';
          this.recordingPreviewPlayer.onloadedmetadata = null;
      }
      this.previewAudioBuffer = null;
      this.clearLiveWaveform();
      this.recordingInterface.classList.remove('playback-mode');
  }
  
  private startPreviewAnimation = (): void => {
      this.stopPreviewAnimation();
      
      const animate = () => {
          if (!this.isPlaybackActive) return;
          this.updatePreviewPlayhead(this.recordingPreviewPlayer.currentTime);
          this.previewAnimationId = requestAnimationFrame(animate);
      };
      animate();
  }

  private stopPreviewAnimation = (): void => {
      if (this.previewAnimationId) {
          cancelAnimationFrame(this.previewAnimationId);
          this.previewAnimationId = null;
      }
  }

  private updatePreviewPlayhead = (time: number): void => {
      if (isNaN(time)) return;
      const duration = this.recordingPreviewPlayer.duration;
      if (isNaN(duration) || duration === 0) {
          this.liveRecordingTimerDisplay.textContent = this.formatTime(0, true);
          return;
      };

      const progress = time / duration;
      const canvasWidth = this.liveWaveformCanvas.clientWidth;
      
      this.previewPlayhead.style.transform = `translateX(${progress * canvasWidth}px)`;
      this.liveRecordingTimerDisplay.textContent = `${this.formatTime(time * 1000, true)} / ${this.formatTime(duration * 1000, true)}`;
  }
  
  private handlePreviewScrubStart = (e: MouseEvent | TouchEvent): void => {
      if (!this.isPaused || this.isScrubbingPreview || (e instanceof MouseEvent && e.button !== 0)) return;
      e.preventDefault();
      
      this.isScrubbingPreview = true;
      this.recordingPreviewPlayer.pause();
      this.liveWaveformContainer.style.cursor = 'grabbing';
      
      document.addEventListener('mousemove', this.handlePreviewScrubMove);
      document.addEventListener('touchmove', this.handlePreviewScrubMove, { passive: false });
      document.addEventListener('mouseup', this.handlePreviewScrubEnd);
      document.addEventListener('touchend', this.handlePreviewScrubEnd);
      
      this.handlePreviewScrubMove(e);
  }

  private handlePreviewScrubMove = (e: MouseEvent | TouchEvent): void => {
      if (!this.isScrubbingPreview) return;
      
      const rect = this.liveWaveformContainer.getBoundingClientRect();
      if (rect.width === 0) return; // Prevent division by zero if element isn't rendered
      const x = this.getPointerX(e);
      const progress = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
      const duration = this.recordingPreviewPlayer.duration;

      if (!isNaN(duration) && duration > 0) {
          const newTime = progress * duration;
          if (isFinite(newTime)) { // Add final guard before setting currentTime
            this.recordingPreviewPlayer.currentTime = newTime;
            this.updatePreviewPlayhead(newTime);
          }
      }
  }
  
  private handlePreviewScrubEnd = (): void => {
      if (!this.isScrubbingPreview) return;
      
      this.isScrubbingPreview = false;
      this.liveWaveformContainer.style.cursor = 'grab';

      document.removeEventListener('mousemove', this.handlePreviewScrubMove);
      document.removeEventListener('touchmove', this.handlePreviewScrubMove);
      document.removeEventListener('mouseup', this.handlePreviewScrubEnd);
      document.removeEventListener('touchend', this.handlePreviewScrubEnd);
  }

  private drawPausedWaveform(): void {
    // This is now a fallback. The main paused view is the rendered waveform.
    if (!this.liveWaveformCtx) return;
    const canvas = this.liveWaveformCtx.canvas;
    this.liveWaveformCtx.clearRect(0, 0, canvas.width, canvas.height);
    const isDarkMode = !document.body.classList.contains('light-mode');
    const centerY = canvas.height / 2;

    this.liveWaveformCtx.strokeStyle = isDarkMode ? '#555' : '#ccc';
    this.liveWaveformCtx.lineWidth = 1;
    this.liveWaveformCtx.setLineDash([2, 4]);
    this.liveWaveformCtx.beginPath();
    this.liveWaveformCtx.moveTo(0, centerY);
    this.liveWaveformCtx.lineTo(canvas.width, centerY);
    this.liveWaveformCtx.stroke();
    this.liveWaveformCtx.setLineDash([]);
  }
  
  // --- Timers ---
  private startTimer(): void {
    this.stopTimer(); // Clear any existing timer
    this.recordingStartTime = Date.now();

    this.timerIntervalId = window.setInterval(() => {
      const elapsedTime = Date.now() - this.recordingStartTime;
      
      if (this.activeView === 'editor') {
        const formattedTimeMs = this.formatTime(elapsedTime, true);
        this.liveRecordingTimerDisplay.textContent = formattedTimeMs;
      } else if (this.activeView === 'lyriq' && this.isRecording) {
        // When recording in Lyriq, if no audio is playing alongside,
        // we drive the playhead and timer with the elapsed recording time.
        if (!this.lyriqIsPlaying) {
          const elapsedSeconds = elapsedTime / 1000;
          this.updatePlayheadVisuals(elapsedSeconds);
        }
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
  private getLyriqAudioContext(): AudioContext | null {
    if (!this.lyriqAudioContext || this.lyriqAudioContext.state === 'closed') {
      try {
        this.lyriqAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      } catch (e) {
        console.error("Failed to create AudioContext for Lyriq", e);
        return null;
      }
    }
    if (this.lyriqAudioContext.state === 'suspended') {
      this.lyriqAudioContext.resume().catch(e => console.error("Error resuming Lyriq audio context", e));
    }
    return this.lyriqAudioContext;
  }

  private initLyriqAudioContext(): AudioContext | null {
      const audioContext = this.getLyriqAudioContext();
      if (!audioContext) return null;

      if (this.lyriqAudioPlayer && !this.lyriqBeatSourceNode) {
          try {
              this.lyriqBeatSourceNode = audioContext.createMediaElementSource(this.lyriqAudioPlayer);
              this.lyriqBeatSourceNode.connect(audioContext.destination);
          } catch (e) {
              if ((e as Error).name !== 'InvalidStateError') {
                  console.warn("Could not create beat source node", e);
              }
          }
      }
      if (this.lyriqVocalAudioPlayer && !this.lyriqVocalSourceNode) {
          try {
              this.lyriqVocalSourceNode = audioContext.createMediaElementSource(this.lyriqVocalAudioPlayer);
              this.lyriqVocalSourceNode.connect(audioContext.destination);
          } catch (e) {
               if ((e as Error).name !== 'InvalidStateError') {
                  console.warn("Could not create vocal source node", e);
               }
          }
      }
      return audioContext;
  }

  private toggleLyriqMode(): void {
      this.lyriqMode = this.lyriqMode === 'karaoke' ? 'editor' : 'karaoke';
      this.lyriqLyricsAreDirty = false; // Reset dirty flag on every toggle
      const icon = this.lyriqModeToggleBtn.querySelector('i')!;
  
      if (this.lyriqMode === 'editor') {
          this.lyriqPlayerView.classList.add('editor-mode');
          icon.className = 'fas fa-microphone-alt';
          this.lyriqModeToggleBtn.title = 'Karaoke Mode';
          this.lyricsContainer.contentEditable = 'true';
          this.lyricsContainer.addEventListener('input', this.handleLyriqEdit);
          // Set focus to the editor
          this.lyricsContainer.focus();
      } else {
          // Save any pending changes before switching out of editor mode
          this.updateNoteFromLyriqEditor();
          this.lyriqPlayerView.classList.remove('editor-mode');
          icon.className = 'fas fa-edit';
          this.lyriqModeToggleBtn.title = 'Editor Mode';
          this.lyricsContainer.contentEditable = 'false';
          this.lyricsContainer.removeEventListener('input', this.handleLyriqEdit);
          // Reload the note to ensure karaoke view has correct (potentially un-synced) text
          this.loadNoteIntoLyriqPlayer();
      }
  }

  private handleLyriqEdit = (): void => {
      this.lyriqLyricsAreDirty = true;
      // Debounce the save operation to avoid excessive writes
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = window.setTimeout(() => {
          this.updateNoteFromLyriqEditor();
      }, 800);
  }

  private updateNoteFromLyriqEditor = (): void => {
      if (!this.currentNoteId || this.lyriqMode !== 'editor') return;
      const note = this.notes.get(this.currentNoteId);
      if (!note) return;

      const newText = this.lyricsContainer.innerText;

      const currentTextInEditor = (note.syncedLines && note.syncedLines.length > 0)
          ? note.syncedLines.map(l => l.editedText || l.text).join('\n')
          : this.flattenSections(note.sections);

      if (currentTextInEditor === newText) {
          return;
      }

      note.polishedNote = newText;
      note.sections = [{ type: 'Verse', content: newText, takes: [] }];
      note.timestamp = Date.now();
      
      if (this.lyriqLyricsAreDirty && note.syncedLines) {
          const newLines = newText.split('\n');
          
          // If the number of lines has changed, the timing data is no longer valid.
          if (newLines.length !== note.syncedLines.length) {
              console.warn('Lyric line count changed. Detaching sync data.');
              note.syncedLines = null;
              note.syncedWords = null; // Also clear word-level sync
          } else {
              // Line count is the same, update the text but keep the timing.
              note.syncedLines.forEach((line, index) => {
                  const newLineText = newLines[index];
                  if (newLineText !== undefined) {
                      if (newLineText.trim() !== line.text.trim()) {
                          line.editedText = newLineText;
                      } else {
                          // If the text is reverted to original, clear the edit flag
                          delete line.editedText;
                      }
                  }
              });
          }
          this.lyriqLyricsAreDirty = false;
      }
      
      this.saveDataToStorage();
  }

  private updateLyriqControlsState(): void {
      const hasAudio = !!(this.beatAudioBuffer || this.vocalAudioBuffer);
      const isRecordingInLyriq = this.isRecording && this.activeView === 'lyriq';
      const controlsEnabled = (hasAudio || isRecordingInLyriq) && !this.isProcessing;

      // Peek controls
      this.lyriqModalPeekPlayBtn.disabled = !controlsEnabled;
      this.lyriqModalRewindBtn.disabled = !controlsEnabled;
      this.lyriqModalForwardBtn.disabled = !controlsEnabled;

      // Expanded controls
      this.lyriqExpandedPlayBtn.disabled = !controlsEnabled;
      this.lyriqExpandedVolumeBtn.disabled = !controlsEnabled;
      this.lyriqExpandedRecordBtn.disabled = this.isProcessing;
  }

  private async toggleLyriqRecording(): Promise<void> {
    if (this.isProcessing) return;

    this.setActiveMixerTrack('vocal');

    if (this.isRecording) {
        this.mediaRecorder?.stop();
        this.stopTimer();
        this.stopLyriqLiveWaveform();
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
            this.updatePlayheadVisuals(0);
            this.lyriqWaveforms.scrollLeft = 0;
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
    this.updateLyriqControlsState();
  }

  private handleBeatButtonClick(): void {
    this.setActiveMixerTrack('beat');
    if (!this.beatAudioBuffer) {
      this.audioUploadInput.click();
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
      this.lyriqModalPeekTitle.textContent = note.title;
      this.lyricsContainer.innerHTML = ''; // Clear existing
      this.lyriqLineElements = null;

      if (note.syncedWords && note.syncedWords.length > 0 && note.syncedLines && note.syncedLines.length > 0) {
          this.renderSyncedLyrics(note);
      } else {
          const lyricsText = this.flattenSections(note.sections);

          if (lyricsText.trim()) {
              lyricsText.split('\n').forEach(line => {
                  if (line.trim()) { // Don't create elements for empty lines between sections
                    const lineEl = document.createElement('p');
                    lineEl.className = 'lyriq-line';
                    lineEl.innerText = line;
                    this.lyricsContainer.appendChild(lineEl);
                  }
              });
              this.lyriqLineElements = Array.from(this.lyricsContainer.querySelectorAll('.lyriq-line'));
          } else {
              this.lyricsContainer.innerHTML = '<p class="lyriq-line placeholder">This note has no lyrics. Try recording some vocals.</p>';
          }
      }
      this.lyriqCurrentLineIndex = -1; // Reset line tracking
  }
  
  private renderSyncedLyrics(note: Note): void {
      this.lyricsContainer.innerHTML = '';
      let wordIndex = 0;
  
      note.syncedLines?.forEach(line => {
          const lineEl = document.createElement('p');
          lineEl.className = 'lyriq-line';
  
          const lineText = line.editedText ?? line.text;
          const wordsInLine = lineText.split(' ');
          
          let lineContent = '';
          for (let i = 0; i < wordsInLine.length; i++) {
              const timedWord = note.syncedWords?.[wordIndex];
              if (timedWord) {
                  lineContent += `<span class="lyriq-word" data-start="${timedWord.start}" data-end="${timedWord.end}">${timedWord.word}</span> `;
                  wordIndex++;
              }
          }
          lineEl.innerHTML = lineContent.trim();
          this.lyricsContainer.appendChild(lineEl);
      });
      this.lyriqLineElements = Array.from(this.lyricsContainer.querySelectorAll('.lyriq-line'));
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
        const audioContext = this.getAudioContext();
        if (!audioContext) {
            console.error("AudioContext not available for file processing.");
            return;
        }
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
        this.updatePlayheadVisuals(0);
        this.setLyriqModalState('visible');
        this.updateLyriqControlsState();
        this.triggerHapticFeedback(20); // Success feedback

      } catch (e) {
        console.error("Error processing audio file:", e);
        this.triggerHapticFeedback([40, 30, 40]); // Error feedback
      }
    }
  }

  private toggleLyriqPlayback(): void {
    if (!this.lyriqAudioPlayer.src) return;

    const audioContext = this.initLyriqAudioContext();
    if (!audioContext) {
        console.error("AudioContext is not available for playback.");
        return;
    }

    // Toggle state immediately to fix race condition with animation loop
    this.lyriqIsPlaying = !this.lyriqIsPlaying;

    const iconClass = this.lyriqIsPlaying ? 'fas fa-pause' : 'fas fa-play';
    
    const expandedIcon = this.lyriqExpandedPlayBtn.querySelector('i');
    if (expandedIcon) expandedIcon.className = iconClass;
    
    const peekIcon = this.lyriqModalPeekPlayBtn.querySelector('i');
    if (peekIcon) peekIcon.className = iconClass;

    if (this.lyriqIsPlaying) {
        // PLAY LOGIC
        // Sync vocal track to beat track before playing
        if (this.lyriqVocalAudioPlayer.src) {
            this.lyriqVocalAudioPlayer.currentTime = this.lyriqAudioPlayer.currentTime;
        }
        // Establish the time offset between the AudioContext's clock and the
        // media element's clock. This is the key to high-precision timing.
        this.lyriqPlaybackStartTime = audioContext.currentTime - this.lyriqAudioPlayer.currentTime;
        this.lyriqAudioPlayer.play();
        if (this.lyriqVocalAudioPlayer.src) this.lyriqVocalAudioPlayer.play();
        this.startLyriqAnimation();
    } else {
        // PAUSE LOGIC
        this.lyriqAudioPlayer.pause();
        if (this.lyriqVocalAudioPlayer.src) this.lyriqVocalAudioPlayer.pause();
        this.stopLyriqAnimation();
        this.clearLyricHighlight();
    }
  }
  
  private handleRewind = (): void => {
      if (!this.lyriqAudioPlayer || isNaN(this.lyriqAudioPlayer.currentTime)) return;
      const newTime = Math.max(0, this.lyriqAudioPlayer.currentTime - 15);
      this.setAudioTime(newTime);
      this.updatePlayheadVisuals(newTime);
  }

  private handleForward = (): void => {
      if (!this.lyriqAudioPlayer || isNaN(this.lyriqAudioPlayer.duration) || isNaN(this.lyriqAudioPlayer.currentTime)) return;
      const newTime = Math.min(this.lyriqAudioPlayer.duration, this.lyriqAudioPlayer.currentTime + 15);
      this.setAudioTime(newTime);
      this.updatePlayheadVisuals(newTime);
  }

  private handleLyriqMetadataLoaded(): void {
    this.updatePlayheadVisuals(this.lyriqAudioPlayer.currentTime);
  }

  private findLineIndexAtTime(time: number, lines: TimedLine[]): number {
      if (!lines || lines.length === 0) {
          return -1;
      }
      for (let i = lines.length - 1; i >= 0; i--) {
          if (lines[i].start <= time) {
              if (lines[i].end && time > lines[i].end!) {
                  continue;
              }
              return i;
          }
      }
      return -1;
  }

  private updateLyricHighlighting(currentTime: number): void {
    const note = this.currentNoteId ? this.notes.get(this.currentNoteId) : null;
    const lookaheadTime = currentTime + this.LYRIQ_HIGHLIGHT_OFFSET;

    if (!note || !note.syncedLines || !this.lyriqLineElements || this.lyriqLineElements.length === 0) {
        this.clearLyricHighlight();
        return;
    }

    const newHighlightIndex = this.findLineIndexAtTime(lookaheadTime, note.syncedLines);

    if (newHighlightIndex !== this.lyriqCurrentLineIndex) {
      // Line change logic
      const previousLine = this.lyriqLineElements[this.lyriqCurrentLineIndex];
      if (previousLine) {
        previousLine.classList.remove('highlighted-line');
        previousLine.classList.add('past-line');
        // Mark all words in the old line as past
        previousLine.querySelectorAll('.lyriq-word').forEach(wordEl => wordEl.classList.add('past-word'));
      }
      
      const activeLine = this.lyriqLineElements[newHighlightIndex];
      if (activeLine) {
        activeLine.classList.remove('past-line');
        activeLine.classList.add('highlighted-line');

        // Auto-scroll logic using modern scrollIntoView with CSS scroll-padding
        if (this.lyriqAutoScrollEnabled && this.lyriqIsPlaying) {
          activeLine.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }

      this.lyriqCurrentLineIndex = newHighlightIndex;
    }
    
    // Word-by-word highlighting within the current line
    const currentLineEl = this.lyriqLineElements[this.lyriqCurrentLineIndex];
    if (currentLineEl && note.syncedWords) {
        const wordElements = currentLineEl.querySelectorAll('.lyriq-word');
        wordElements.forEach(wordEl => {
            const wordStart = parseFloat((wordEl as HTMLElement).dataset.start!);
            if (currentTime >= wordStart) {
                wordEl.classList.add('highlighted-word');
            } else {
                wordEl.classList.remove('highlighted-word');
            }
        });
    }

    if (newHighlightIndex === -1) {
        this.clearLyricHighlight();
    }
  }

  private clearLyricHighlight(): void {
      this.lyriqLineElements?.forEach(line => {
          line.classList.remove('highlighted-line', 'past-line');
          line.querySelectorAll('.lyriq-word').forEach(word => {
            word.classList.remove('highlighted-word', 'past-word');
          });
      });
      this.lyriqCurrentLineIndex = -1;
  }

  private handleLyriqEnded(): void {
    this.lyriqIsPlaying = false;
    if (this.isRecording) {
      this.toggleLyriqRecording();
    }
    this.stopLyriqAnimation();
    this.clearLyricHighlight();
    const expandedIcon = this.lyriqExpandedPlayBtn.querySelector('i');
    if (expandedIcon) expandedIcon.className = 'fas fa-play';
    const peekIcon = this.lyriqModalPeekPlayBtn.querySelector('i');
    if (peekIcon) peekIcon.className = 'fas fa-play';
    
    this.lyriqAudioPlayer.currentTime = 0;
    if (this.lyriqVocalAudioPlayer.src) this.lyriqVocalAudioPlayer.currentTime = 0;
    this.lyriqWaveforms.scrollLeft = 0;
    this.updatePlayheadVisuals(0);
  }
  
  private setActiveMixerTrack(track: MixerTrack): void {
      this.activeMixerTrack = track;
      this.lyriqExpandedAddBeatBtn.classList.toggle('active', track === 'beat');
      this.lyriqExpandedVocalBtn.classList.toggle('active', track === 'vocal');
  }

  private toggleVolumeView(): void {
    this.isVolumeViewActive = !this.isVolumeViewActive;
    this.lyriqControlsModal.classList.toggle('volume-view-active', this.isVolumeViewActive);
    if (this.isVolumeViewActive) {
      this.updateVolumeMixerUI();
    }
  }
  
  private handleVolumeDragStart = (e: MouseEvent | TouchEvent, track: MixerTrack): void => {
      e.preventDefault();
      if (this.draggingVolumeTrack) return;

      this.draggingVolumeTrack = track;
      document.addEventListener('mousemove', this.handleVolumeDragMove);
      document.addEventListener('touchmove', this.handleVolumeDragMove, { passive: false });
      document.addEventListener('mouseup', this.handleVolumeDragEnd);
      document.addEventListener('touchend', this.handleVolumeDragEnd);
      
      this.handleVolumeDragMove(e); // Handle initial click
  }
  
  private handleVolumeDragMove = (e: MouseEvent | TouchEvent): void => {
      if (!this.draggingVolumeTrack) return;
  
      const container = this.draggingVolumeTrack === 'beat' 
          ? this.beatVolumeSliderContainer 
          : this.vocalVolumeSliderContainer;
      
      const rect = container.getBoundingClientRect();
      const x = this.getPointerX(e);
      const newVolume = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
  
      if (this.draggingVolumeTrack === 'beat') {
          this.beatVolume = newVolume;
          this.lyriqAudioPlayer.volume = this.beatVolume;
          this.lyriqAudioPlayer.muted = this.beatVolume === 0;
      } else {
          this.vocalVolume = newVolume;
          this.lyriqVocalAudioPlayer.volume = this.vocalVolume;
          this.lyriqVocalAudioPlayer.muted = this.vocalVolume === 0;
      }
      this.updateVolumeMixerUI();
  }
  
  private handleVolumeDragEnd = (): void => {
      if (!this.draggingVolumeTrack) return;
      
      document.removeEventListener('mousemove', this.handleVolumeDragMove);
      document.removeEventListener('touchmove', this.handleVolumeDragMove);
      document.removeEventListener('mouseup', this.handleVolumeDragEnd);
      document.removeEventListener('touchend', this.handleVolumeDragEnd);
      
      this.draggingVolumeTrack = null;
  }
  
  private updateVolumeMixerUI(): void {
      const beatVolume = this.beatVolume;
      const vocalVolume = this.vocalVolume;
  
      this.beatVolumeFill.style.width = `${beatVolume * 100}%`;
      this.beatVolumePercentage.textContent = `${Math.round(beatVolume * 100)}%`;
  
      this.vocalVolumeFill.style.width = `${vocalVolume * 100}%`;
      this.vocalVolumePercentage.textContent = `${Math.round(vocalVolume * 100)}%`;

      const icon = this.lyriqExpandedVolumeBtn.querySelector('i')!;
      if (beatVolume === 0 && vocalVolume === 0) {
        icon.className = 'fas fa-volume-mute';
      } else if (beatVolume < 0.5 && vocalVolume < 0.5) {
          icon.className = 'fas fa-volume-down';
      } else {
          icon.className = 'fas fa-volume-up';
      }
  }

  // --- Context Menu ---
  private handleProjectContextMenu(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();

    const target = e.target as HTMLElement;
    const projectButton = target.closest<HTMLButtonElement>('.sidebar-link');
    const projectId = projectButton?.dataset.projectId;

    if (!projectId) return;

    this.contextMenu.style.top = `${e.clientY}px`;
    this.contextMenu.style.left = `${e.clientX}px`;
    this.contextMenu.style.display = 'block';

    this.contextMenu.innerHTML = `
      <ul class="context-menu-list">
        <li><button class="context-menu-item" data-action="rename"><i class="fas fa-pencil-alt"></i>Rename</button></li>
        <li class="context-menu-separator"></li>
        <li><button class="context-menu-item delete" data-action="delete"><i class="fas fa-trash-alt"></i>Delete Project</button></li>
      </ul>
    `;

    this.contextMenu.onclick = (event) => {
        const actionTarget = (event.target as HTMLElement).closest<HTMLButtonElement>('.context-menu-item');
        if (actionTarget) {
            this.triggerHapticFeedback();
            const action = actionTarget.dataset.action;
            if (action === 'delete') {
                if (confirm('Are you sure you want to delete this project? This will not delete the notes inside it.')) {
                    this.deleteProject(projectId);
                }
            } else if (action === 'rename') {
                this.renameProject(projectId);
            }
            this.hideContextMenu();
        }
    };
  }

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
            <li><button class="context-menu-item" data-action="duplicate"><i class="fas fa-copy"></i>Duplicate</button></li>
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
                      this.deleteNote(noteId);
                  }
              } else if (action === 'rename') {
                  this.renameNote(noteId);
              } else if (action === 'duplicate') {
                  // this.duplicateNote(noteId); // Implementation needed
              }
              this.hideContextMenu();
          }
      };
  }
  
  // --- Start of Added Methods ---

  private setAppHeight(): void {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
  }

  private triggerHapticFeedback(pattern: number | number[] = 5): void {
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch (e) {
        // Can fail if user has disabled vibration
      }
    }
  }

  private getNoteState(note: Note): NoteState {
    return JSON.parse(JSON.stringify({
      title: note.title,
      sections: note.sections,
      polishedNote: note.polishedNote,
      editorFormat: note.editorFormat
    }));
  }

  private saveNoteState(): void {
    if (!this.currentNoteId) return;
    const history = this.noteHistories.get(this.currentNoteId);
    const note = this.notes.get(this.currentNoteId);
    if (!history || !note) return;

    const currentState = this.getNoteState(note);
    const lastState = history.undo[history.undo.length - 1];

    if (JSON.stringify(currentState) === JSON.stringify(lastState)) {
      return;
    }

    history.undo.push(currentState);
    history.redo = [];
    
    if (history.undo.length > 50) {
        history.undo.shift();
    }

    this.updateUndoRedoButtons();
    this.saveDataToStorage();
  }

  private debouncedSaveState = (): void => {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => {
        this.updateCurrentNoteContent();
        this.saveNoteState();
    }, 800);
  }

  private undo(): void {
    if (!this.currentNoteId) return;
    const history = this.noteHistories.get(this.currentNoteId);
    if (!history || history.undo.length <= 1) return;

    const currentState = history.undo.pop()!;
    history.redo.unshift(currentState);

    const prevState = history.undo[history.undo.length - 1];
    this.applyNoteState(prevState);
  }

  private redo(): void {
    if (!this.currentNoteId) return;
    const history = this.noteHistories.get(this.currentNoteId);
    if (!history || history.redo.length === 0) return;

    const nextState = history.redo.shift()!;
    history.undo.push(nextState);

    this.applyNoteState(nextState);
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
      this.updateUndoRedoButtons();
      this.saveDataToStorage();
      this.renderSidebar();
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
  
  private updatePlaceholderVisibility(element: HTMLElement): void {
      const hasContent = element.textContent && element.textContent.trim().length > 0;
      element.classList.toggle('is-empty', !hasContent);
  }

  private setRecordingModalState(state: 'visible' | 'peeking' | 'hidden'): void {
    this.recordingInterface.classList.remove('visible', 'peeking', 'hidden');
    this.recordingInterface.classList.add(state);
    
    if (state === 'hidden') {
      this.discardRecording(false);
    } else {
      this.updateRecordingStateUI();
    }
  }

  private toggleRecordingModalVisibility(): void {
    if (this.recordingInterface.classList.contains('visible')) {
      this.setRecordingModalState('peeking');
    } else {
      this.setRecordingModalState('visible');
    }
  }

  private setFinalStatus(message: string, isError = false): void {
      document.body.classList.remove('is-processing');
      this.isProcessing = false;
      this.recordingStatus.textContent = message;
      this.recordingStatus.classList.toggle('error', isError);
      
      setTimeout(() => {
          this.setRecordingModalState('hidden');
          this.recordingStatus.textContent = '';
          this.recordingStatus.classList.remove('error');
          this.updateRecordingStateUI();
      }, isError ? 2500 : 1500);
  }

  private showLyriqModal(expanded: boolean = false): void {
      this.lyriqPlayerView.classList.remove('empty-state');
      this.setLyriqModalState(expanded ? 'visible' : 'peeking');
  }
  
  private toggleLyriqModalVisibility(): void {
    if (this.lyriqControlsModal.classList.contains('visible')) {
      this.setLyriqModalState('peeking');
    } else {
      this.setLyriqModalState('visible');
    }
  }
  
  private setLyriqModalState(state: 'visible' | 'peeking' | 'hidden'): void {
      this.lyriqControlsModal.classList.remove('visible', 'peeking', 'hidden');
      if (state !== 'hidden') {
          this.lyriqControlsModal.style.display = 'flex';
          setTimeout(() => this.lyriqControlsModal.classList.add(state), 10);
      } else {
          setTimeout(() => {
              if (!this.lyriqControlsModal.classList.contains('visible') && !this.lyriqControlsModal.classList.contains('peeking')) {
                  this.lyriqControlsModal.style.display = 'none';
              }
          }, 300);
      }
      if (state !== 'visible' && this.isVolumeViewActive) {
          this.toggleVolumeView();
      }
  }

  private hideContextMenu(): void {
    if (this.contextMenu) {
        this.contextMenu.style.display = 'none';
        this.contextMenu.onclick = null;
    }
  }

  private hideTakesMenu(): void {
    const menu = document.querySelector('.takes-context-menu');
    menu?.remove();
  }
  
  private showTakesMenu(sectionIndex: number, badge: HTMLElement): void {
    this.hideTakesMenu();

    const note = this.notes.get(this.currentNoteId!);
    if (!note || !note.sections[sectionIndex]) return;

    const section = note.sections[sectionIndex];
    if (section.takes.length === 0) return;

    const menu = document.createElement('div');
    menu.className = 'takes-context-menu';

    const list = document.createElement('ul');
    section.takes.forEach(take => {
        const item = document.createElement('li');
        item.className = 'take-item';
        item.dataset.takeId = take.id;
        item.innerHTML = `
            <span>Take #${section.takes.indexOf(take) + 1}</span>
            <span class="take-duration">${this.formatTime(take.duration || 0, false)}</span>
            <button class="take-play-btn" data-src="${take.url}"><i class="fas fa-play"></i><i class="fas fa-pause"></i></button>
            <button class="take-delete-btn"><i class="fas fa-trash-alt"></i></button>
        `;
        list.appendChild(item);
    });
    menu.appendChild(list);

    document.body.appendChild(menu);

    const badgeRect = badge.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    
    let top = badgeRect.bottom + 8;
    let left = badgeRect.left;
    if (top + menuRect.height > window.innerHeight) {
        top = badgeRect.top - menuRect.height - 8;
    }
    if (left + menuRect.width > window.innerWidth) {
        left = window.innerWidth - menuRect.width - 16;
    }
    
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    menu.style.opacity = '1';

    menu.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const takeItem = target.closest<HTMLElement>('.take-item');
        if (!takeItem) return;
        
        const takeId = takeItem.dataset.takeId;
        const take = section.takes.find(t => t.id === takeId);
        if (!take) return;

        if (target.closest('.take-play-btn')) {
            this.toggleTakePlayback(take, target.closest('.take-play-btn')!);
        }
        if (target.closest('.take-delete-btn')) {
            if (confirm('Are you sure you want to delete this take?')) {
                this.deleteTake(sectionIndex, take.id);
                this.hideTakesMenu();
            }
        }
    });
  }

  private deleteTake(sectionIndex: number, takeId: string): void {
    const note = this.notes.get(this.currentNoteId!);
    if (!note || !note.sections[sectionIndex]) return;
    
    this.updateCurrentNoteContent();
    this.saveNoteState();
    
    const takeIndex = note.sections[sectionIndex].takes.findIndex(t => t.id === takeId);
    if (takeIndex > -1) {
        const [removedTake] = note.sections[sectionIndex].takes.splice(takeIndex, 1);
        if (removedTake.url) {
            URL.revokeObjectURL(removedTake.url);
        }
        this.saveDataToStorage();
        this.saveNoteState();
        this.renderNoteContent(note);
    }
  }

  private createProject(): void {
    const projectName = prompt("Enter new project name:");
    if (projectName && projectName.trim() !== '') {
        const newProject: Project = {
            id: `proj_${Date.now()}`,
            name: projectName.trim(),
        };
        this.projects.set(newProject.id, newProject);
        this.saveDataToStorage();
        this.renderSidebar();
        this.filterByProject(newProject.id);
    }
  }

  private deleteProject(projectId: string): void {
    if (!this.projects.has(projectId)) return;

    this.notes.forEach(note => {
      if (note.projectId === projectId) {
        note.projectId = null;
      }
    });

    this.projects.delete(projectId);

    if (this.currentFilter.type === 'project' && this.currentFilter.id === projectId) {
        this.currentFilter = { type: 'all', id: null };
        this.setActiveView('list');
    }

    this.saveDataToStorage();
    this.renderSidebar();
    if (this.appContainer.classList.contains('list-view-active')) {
      this.renderNotesList();
    }
  }

  private renameProject(projectId: string): void {
    const project = this.projects.get(projectId);
    if (!project) return;

    const newName = prompt("Enter new project name:", project.name);
    if (newName && newName.trim() !== '') {
      project.name = newName.trim();
      this.saveDataToStorage();
      this.renderSidebar();
      if (this.appContainer.classList.contains('list-view-active')) {
        this.renderNotesList();
      }
    }
  }

  private filterByProject(projectId: string): void {
    this.currentFilter = { type: 'project', id: projectId };
    this.setActiveView('list');
  }

  private handleProjectTouchStart(e: TouchEvent): void {
    const target = e.target as HTMLElement;
    const projectButton = target.closest<HTMLButtonElement>('.sidebar-link');
    if (projectButton) {
        this.handleNoteTouchStart(e);
    }
  }

  private handleNoteTouchStart(e: TouchEvent, explicitNoteId?: string): void {
    const target = e.target as HTMLElement;
    const noteItem = target.closest<HTMLElement>('.sidebar-note-item, .note-card');
    const noteId = explicitNoteId || noteItem?.dataset.noteId;
    const projectItem = target.closest<HTMLElement>('.sidebar-link');
    const projectId = projectItem?.dataset.projectId;

    if (noteId || projectId) {
        this.longPressTimer = window.setTimeout(() => {
            e.preventDefault();
            if (noteId) {
                this.showNoteContextMenu(e as unknown as MouseEvent, noteId);
            } else if (projectId) {
                this.handleProjectContextMenu(e as unknown as MouseEvent);
            }
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

  private setAudioTime(time: number): void {
    const duration = this.lyriqAudioPlayer.duration || Infinity;
    const clampedTime = Math.max(0, Math.min(time, duration));
    if (isFinite(clampedTime)) {
        if (this.lyriqAudioPlayer.readyState > 0) {
            this.lyriqAudioPlayer.currentTime = clampedTime;
        }
        if (this.lyriqVocalAudioPlayer.src && this.lyriqVocalAudioPlayer.readyState > 0) {
            this.lyriqVocalAudioPlayer.currentTime = clampedTime;
        }
    }
  }
  
  private debouncedSeek = (time: number): void => {
      if (this.seekDebounceTimer) clearTimeout(this.seekDebounceTimer);
      this.seekDebounceTimer = window.setTimeout(() => {
          this.setAudioTime(time);
      }, 50);
  }

  private cancelDebouncedSeek(): void {
      if (this.seekDebounceTimer) {
          clearTimeout(this.seekDebounceTimer);
          this.seekDebounceTimer = null;
      }
  }
  
  private handleScrubStart = (e: MouseEvent | TouchEvent): void => {
    if (e instanceof MouseEvent && e.button !== 0) return;
    if (!this.beatAudioBuffer && !this.vocalAudioBuffer) return;
    
    e.preventDefault();
    this.isScrubbing = true;
    this.lyriqAudioPlayer.pause();
    this.lyriqVocalAudioPlayer.pause();
    this.lyriqWaveforms.style.cursor = 'grabbing';

    document.addEventListener('mousemove', this.handleScrubMove);
    document.addEventListener('touchmove', this.handleScrubMove, { passive: false });
    document.addEventListener('mouseup', this.handleScrubEnd);
    document.addEventListener('touchend', this.handleScrubEnd);

    this.handleScrubMove(e);
  }

  private handleScrubMove = (e: MouseEvent | TouchEvent): void => {
    if (!this.isScrubbing) return;
    
    const x = this.getPointerX(e);
    const rect = this.lyriqWaveforms.getBoundingClientRect();
    const scrollLeft = this.lyriqWaveforms.scrollLeft;
    const newPosition = x - rect.left + scrollLeft;
    const newTime = newPosition / this.PIXELS_PER_SECOND;
    
    this.updatePlayheadVisuals(newTime);
    this.debouncedSeek(newTime);
  }

  private handleScrubEnd = (e: MouseEvent | TouchEvent): void => {
      if (!this.isScrubbing) return;
      
      this.cancelDebouncedSeek();

      const x = 'changedTouches' in e ? e.changedTouches[0].clientX : e.clientX;
      const rect = this.lyriqWaveforms.getBoundingClientRect();
      const scrollLeft = this.lyriqWaveforms.scrollLeft;
      const finalPosition = x - rect.left + scrollLeft;
      const finalTime = finalPosition / this.PIXELS_PER_SECOND;

      // Final, precise update
      this.setAudioTime(finalTime);
      this.updatePlayheadVisuals(finalTime);

      this.isScrubbing = false;
      this.lyriqWaveforms.style.cursor = 'grab';

      if (this.lyriqIsPlaying) {
          this.lyriqAudioPlayer.play();
          if (this.lyriqVocalAudioPlayer.src) this.lyriqVocalAudioPlayer.play();
      }

      document.removeEventListener('mousemove', this.handleScrubMove);
      document.removeEventListener('touchmove', this.handleScrubMove);
      document.removeEventListener('mouseup', this.handleScrubEnd);
      document.removeEventListener('touchend', this.handleScrubEnd);
  }

  private handleWaveformScroll = (): void => {
    if (this.isScrubbing) return;
    const scrollLeft = this.lyriqWaveforms.scrollLeft;
    const newTime = scrollLeft / this.PIXELS_PER_SECOND;
    
    // Immediate visual update, debounced audio seek for performance
    this.updatePlayheadVisuals(newTime);
    this.debouncedSeek(newTime);
  }
  
  private handleKeyDown(e: KeyboardEvent): void {
      if (e.metaKey || e.ctrlKey) {
          if (e.key === 'z') {
              e.preventDefault();
              if (e.shiftKey) {
                  this.redo();
              } else {
                  this.undo();
              }
          }
          if (e.key === 'y') {
              e.preventDefault();
              this.redo();
          }
      }
  }

  private async processAndRenderVocalWaveform(vocalBlob: Blob): Promise<void> {
    try {
      const arrayBuffer = await vocalBlob.arrayBuffer();
      const audioContext = this.getAudioContext();
      if (!audioContext) return;
      this.vocalAudioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      this.renderVocalWaveform();
      this.updateLyriqControlsState();
    } catch (e) {
      console.error("Error processing vocal waveform", e);
    }
  }

  private getAudioDuration(url: string): Promise<number> {
    return new Promise((resolve) => {
      const audio = new Audio();
      audio.onloadedmetadata = () => resolve(audio.duration * 1000);
      audio.onerror = () => resolve(0);
      audio.src = url;
    });
  }

  private drawWaveform(buffer: AudioBuffer, ctx: CanvasRenderingContext2D, color: string): void {
    if (!ctx) return;
    const data = buffer.getChannelData(0);
    const canvas = ctx.canvas;
    const width = canvas.width;
    const height = canvas.height;
    const step = Math.ceil(data.length / width);
    const amp = height / 2;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = color;
    
    for (let i = 0; i < width; i++) {
        let min = 1.0;
        let max = -1.0;
        for (let j = 0; j < step; j++) {
            const datum = data[(i * step) + j];
            if (datum < min) min = datum;
            if (datum > max) max = datum;
        }
        ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
    }
  }

  private formatTime(ms: number, showMs = false): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = Math.floor((ms % 1000) / 10);

    const paddedMinutes = String(minutes).padStart(2, '0');
    const paddedSeconds = String(seconds).padStart(2, '0');
    
    if (showMs) {
      const paddedMs = String(milliseconds).padStart(2, '0');
      return `${paddedMinutes}:${paddedSeconds}.${paddedMs}`;
    }
    return `${paddedMinutes}:${paddedSeconds}`;
  }
  
  private updatePlayheadVisuals(time: number): void {
    if (isNaN(time)) return;
    const duration = this.lyriqAudioPlayer.duration;
    if (isNaN(duration)) {
        this.lyriqModalTime.textContent = this.formatTime(0);
        this.lyriqExpandedTime.textContent = `${this.formatTime(0)} / ${this.formatTime(0)}`;
        return;
    };
    
    const clampedTime = Math.max(0, Math.min(time, duration));
    const formattedTime = this.formatTime(clampedTime * 1000);
    const formattedDuration = this.formatTime(duration * 1000);

    this.lyriqModalTime.textContent = formattedTime;
    this.lyriqExpandedTime.textContent = `${formattedTime} / ${formattedDuration}`;
    
    const newPosition = clampedTime * this.PIXELS_PER_SECOND;
    this.lyriqPlayhead.style.transform = `translateX(${newPosition}px)`;
    
    if (this.lyriqIsPlaying && !this.isScrubbing) {
        const container = this.lyriqWaveforms;
        const containerWidth = container.clientWidth;
        const scrollPosition = container.scrollLeft;
        const playheadCenter = newPosition - scrollPosition;

        if (playheadCenter > containerWidth * 0.6) {
            container.scrollLeft = newPosition - (containerWidth / 2);
        }
    }
    
    if (this.lyriqDebugMode) {
        this.debugTime.textContent = clampedTime.toFixed(3);
    }
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

  private renderBeatWaveform(): void {
      if (this.beatAudioBuffer && this.beatWaveformCtx) {
          this.drawWaveform(this.beatAudioBuffer, this.beatWaveformCtx, '#666');
      }
  }

  private renderVocalWaveform(): void {
      if (this.vocalAudioBuffer && this.vocalWaveformCtx) {
          this.drawWaveform(this.vocalAudioBuffer, this.vocalWaveformCtx, '#fff');
      }
  }
  
  private startLyriqAnimation(): void {
    this.stopLyriqAnimation();
    const animate = () => {
      if (!this.lyriqIsPlaying) return;
      
      const currentTime = this.lyriqAudioContext 
        ? this.lyriqPlaybackStartTime > 0 
          ? this.lyriqAudioContext.currentTime - this.lyriqPlaybackStartTime
          : this.lyriqAudioPlayer.currentTime
        : this.lyriqAudioPlayer.currentTime;
      
      this.updatePlayheadVisuals(currentTime);
      this.updateLyricHighlighting(currentTime);
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

  private getPointerX(e: MouseEvent | TouchEvent): number {
    return 'touches' in e ? e.touches[0].clientX : e.clientX;
  }

  private getPointerY(e: MouseEvent | TouchEvent): number {
    return 'touches' in e ? e.touches[0].clientY : e.clientY;
  }

  // --- End of Added Methods ---
}

// Initialize the app once the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new VoiceNotesApp();
});