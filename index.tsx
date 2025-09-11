

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/* tslint:disable */

import {GoogleGenAI} from '@google/genai';
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
        if (window.innerWidth <= 1024) {
            this.appContainer.classList.add('sidebar-collapsed');
        }
    });
    this.allNotesButton.addEventListener('click', (e) => {
        e.preventDefault();
        this.showNotesList();
    });

    // Editor controls
    this.editorTitle.addEventListener('blur', () => this.updateCurrentNoteContent());
    this.polishedNote.addEventListener('blur', () => this.updateCurrentNoteContent());
    this.rawTranscription.addEventListener('blur', () => this.updateCurrentNoteContent());

    this.polishedNote.addEventListener('input', () => this.updatePlaceholderVisibility(this.polishedNote));
    this.rawTranscription.addEventListener('input', () => this.updatePlaceholderVisibility(this.rawTranscription));
    this.editorTitle.addEventListener('input', () => this.updatePlaceholderVisibility(this.editorTitle));
    
    // Notes list view controls
    this.ideasTabsContainer.addEventListener('click', (e) => this.handleIdeaTabClick(e));
    this.listViewNewNoteFab.addEventListener('click', async () => {
        await this.createNewNote();
        this.hideNotesList();
    });

    // Window and global listeners
    window.addEventListener('resize', () => { this.isMobile = window.innerWidth <= 1024; });
    document.addEventListener('click', () => this.hideContextMenu());
    
    // Context Menu Listeners (Desktop Right-Click + Mobile Long-Press)
    this.recentNotesList.addEventListener('contextmenu', (e) => this.showNoteContextMenu(e));
    this.recentNotesList.addEventListener('touchstart', (e) => this.handleNoteTouchStart(e), { passive: false });
    this.recentNotesList.addEventListener('touchend', () => this.handleNoteTouchEnd());
    this.recentNotesList.addEventListener('touchmove', () => this.handleNoteTouchEnd());
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
        button.className = `sidebar-note-item ${note.id === this.currentNoteId ? 'active' : ''}`;
        button.textContent = note.title;
        button.dataset.noteId = note.id;
        button.addEventListener('click', () => {
            this.setActiveNote(note.id);
            if (this.isMobile) {
              this.appContainer.classList.add('sidebar-collapsed');
            }
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

      // Update active state in sidebar
      document.querySelectorAll('.sidebar-note-item').forEach(item => {
        item.classList.toggle('active', (item as HTMLElement).dataset.noteId === noteId);
      });
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
    this.recordButton.title = 'Stop Recording';
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
      this.recordButton.title = 'Start Recording';
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
    this.liveWaveformCtx.lineTo(width, height / 2);
    this.liveWaveformCtx.stroke();
  }

  private updateTimer(): void {
    const elapsed = Date.now() - this.recordingStartTime;
    const minutes = String(Math.floor(elapsed / 60000)).padStart(2, '0');
    const seconds = String(Math.floor((elapsed % 60000) / 1000)).padStart(2, '0');
    const milliseconds = String(Math.floor((elapsed % 1000) / 10)).padStart(2, '0');
    this.liveRecordingTimerDisplay.textContent = `${minutes}:${seconds}.${milliseconds}`;
  }

  // --- Notes List View ---
  private showNotesList(): void {
    this.appContainer.classList.add('list-view-active');
    this.switchIdeaTab(this.activeIdeaTab);
    if(this.isMobile) {
      this.appContainer.classList.add('sidebar-collapsed');
    }
  }

  private hideNotesList(): void {
    this.appContainer.classList.remove('list-view-active');
  }

  private handleIdeaTabClick(e: MouseEvent): void {
      const target = (e.target as HTMLElement).closest('.idea-tab-btn');
      if (!target) return;

      const tabName = (target as HTMLElement).dataset.tab;
      if (tabName && tabName !== this.activeIdeaTab) {
          this.switchIdeaTab(tabName);
      }
  }

  private switchIdeaTab(tabName: string): void {
      this.activeIdeaTab = tabName;
      
      this.ideasTabsContainer.querySelectorAll('.idea-tab-btn').forEach(btn => {
          btn.classList.toggle('active', (btn as HTMLElement).dataset.tab === tabName);
      });

      switch (tabName) {
          case 'songs':
              this.renderNotesList();
              break;
          case 'verses':
              this.renderPlaceholder('Verses');
              break;
          case 'takes':
              this.renderPlaceholder('Takes');
              break;
      }
  }

  private renderPlaceholder(contentType: string): void {
      this.notesListContent.innerHTML = `
          <div class="placeholder-content">
              <p>Your ${contentType} will appear here.</p>
              <span>This is a placeholder. Functionality for ${contentType} can be added in the future.</span>
          </div>
      `;
  }

  private renderNotesList(): void {
    this.notesListContent.innerHTML = '';
    
    const notesArray = [...this.notes.values()].sort((a,b) => b.timestamp - a.timestamp);
    if(notesArray.length === 0) {
        this.notesListContent.innerHTML = `
          <div class="placeholder-content">
            <p>No songs yet.</p>
            <span>Click the '+' button to create a new one.</span>
          </div>
        `;
        return;
    }
    
    const groupedNotes = this.groupNotesByDate(notesArray);
    
    const groupOrder = ['Today', 'Previous 7 Days', 'Previous 30 Days'];
    const otherGroups = Object.keys(groupedNotes).filter(key => !groupOrder.includes(key));
    
    const allGroupKeys = [...groupOrder.filter(key => groupedNotes[key]), ...otherGroups.sort()];

    for (const groupKey of allGroupKeys) {
        const notesInGroup = groupedNotes[groupKey];

        const groupContainer = document.createElement('div');
        groupContainer.className = 'notes-group';

        const groupTitle = document.createElement('h2');
        groupTitle.className = 'notes-group-title';
        groupTitle.textContent = groupKey;
        groupContainer.appendChild(groupTitle);

        const notesGrid = document.createElement('div');
        notesGrid.className = 'notes-grid';
        
        notesInGroup.forEach(note => {
            const card = document.createElement('div');
            card.className = 'note-card';
            card.dataset.noteId = note.id;

            const titleEl = document.createElement('h3');
            titleEl.className = 'note-card-title';
            titleEl.textContent = note.title;

            const snippetEl = document.createElement('p');
            snippetEl.className = 'note-card-snippet';
            const snippetText = note.polishedNote || note.rawTranscription;
            snippetEl.textContent = snippetText.substring(0, 100) + (snippetText.length > 100 ? '...' : '');
            if (!snippetText) {
                snippetEl.textContent = 'No content...';
                snippetEl.style.fontStyle = 'italic';
            }
            
            card.appendChild(titleEl);
            card.appendChild(snippetEl);

            card.addEventListener('click', () => {
                this.setActiveNote(note.id);
                this.hideNotesList();
            });
            
            notesGrid.appendChild(card);
        });
        
        groupContainer.appendChild(notesGrid);
        this.notesListContent.appendChild(groupContainer);
    }
  }

  private groupNotesByDate(notes: Note[]): { [key: string]: Note[] } {
    const groups: { [key: string]: Note[] } = {};
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);

    notes.forEach(note => {
      const noteDate = new Date(note.timestamp);
      let groupKey: string;
      if (noteDate >= today) {
        groupKey = 'Today';
      } else if (noteDate >= sevenDaysAgo) {
        groupKey = 'Previous 7 Days';
      } else if (noteDate >= thirtyDaysAgo) {
        groupKey = 'Previous 30 Days';
      } else {
        groupKey = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(noteDate);
      }

      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(note);
    });
    return groups;
  }
  
  // --- Context Menu & Long Press ---
  private handleNoteTouchStart(e: TouchEvent): void {
    const target = (e.target as HTMLElement).closest('.sidebar-note-item');
    if (!target) return;
    
    this.clearLongPressTimer();

    this.longPressTimer = window.setTimeout(() => {
        this.longPressTimer = null; // Timer has fired
        this.showNoteContextMenu(e);
        e.preventDefault(); // Prevent scrolling/clicking after menu shows
    }, this.LONG_PRESS_DURATION);
  }

  private handleNoteTouchEnd(): void {
    this.clearLongPressTimer();
  }

  private clearLongPressTimer(): void {
    if (this.longPressTimer) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
    }
  }

  private showNoteContextMenu(e: MouseEvent | TouchEvent): void {
    e.preventDefault();
    e.stopPropagation();

    const target = (e.target as HTMLElement).closest('.sidebar-note-item');
    if (!target) return;
    const noteId = (target as HTMLElement).dataset.noteId;
    if (!noteId) return;

    let projectsHTML = '';
    if (this.projects.size > 0) {
        [...this.projects.values()].sort((a,b) => a.name.localeCompare(b.name)).forEach(proj => {
            projectsHTML += `<li><button class="context-menu-item" data-action="add-to-project" data-note-id="${noteId}" data-project-id="${proj.id}">${proj.name}</button></li>`;
        });
        projectsHTML += `<li class="context-menu-separator"></li>`;
    }

    this.contextMenu.innerHTML = `
        <ul class="context-menu-list">
            <li><button class="context-menu-item" data-action="rename" data-note-id="${noteId}"><i class="fas fa-edit"></i> Rename</button></li>
            <li class="context-menu-separator"></li>
            <li>
                <div class="context-menu-item chevron"><i class="fas fa-folder-plus"></i> Add to Project</div>
                <div class="context-submenu">
                    <ul class="context-menu-list">
                        ${projectsHTML}
                        <li><button class="context-menu-item" data-action="new-project" data-note-id="${noteId}"><i class="fas fa-plus"></i> New Project</button></li>
                    </ul>
                </div>
            </li>
            <li class="context-menu-separator"></li>
            <li><button class="context-menu-item delete" data-action="delete" data-note-id="${noteId}"><i class="fas fa-trash-alt"></i> Delete Note</button></li>
        </ul>
    `;

    let pageX, pageY;
    if (e instanceof MouseEvent) {
        pageX = e.pageX;
        pageY = e.pageY;
    } else { // TouchEvent
        if (e.touches.length > 0) {
            pageX = e.touches[0].pageX;
            pageY = e.touches[0].pageY;
        } else {
            this.hideContextMenu();
            return;
        }
    }
    
    this.contextMenu.style.display = 'block';

    const menuWidth = this.contextMenu.offsetWidth;
    const menuHeight = this.contextMenu.offsetHeight;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    let left = pageX + 5;
    let top = pageY + 5;
    
    if (left + menuWidth > windowWidth) {
        left = windowWidth - menuWidth - 5;
    }
    if (top + menuHeight > windowHeight) {
        top = windowHeight - menuHeight - 5;
    }

    this.contextMenu.style.left = `${left}px`;
    this.contextMenu.style.top = `${top}px`;
    
    // Add event listeners for new actions
    this.contextMenu.querySelector('[data-action="rename"]')?.addEventListener('click', () => {
        this.renameNote(noteId);
        this.hideContextMenu();
    });

    this.contextMenu.querySelectorAll('[data-action="add-to-project"]').forEach(button => {
        button.addEventListener('click', (ev) => {
            const target = ev.currentTarget as HTMLButtonElement;
            const noteIdToAdd = target.dataset.noteId;
            const projectId = target.dataset.projectId;
            if(noteIdToAdd && projectId) {
                this.addNoteToProject(noteIdToAdd, projectId);
            }
            this.hideContextMenu();
        });
    });

    this.contextMenu.querySelector('[data-action="new-project"]')?.addEventListener('click', () => {
        this.createNewProjectFromContext(noteId);
        this.hideContextMenu();
    });

    this.contextMenu.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
        if(confirm('Are you sure you want to delete this note?')) {
            this.deleteNote(noteId);
        }
        this.hideContextMenu();
    });
  }

  private hideContextMenu(): void {
    this.contextMenu.style.display = 'none';
  }

}

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
  new VoiceNotesApp();
});