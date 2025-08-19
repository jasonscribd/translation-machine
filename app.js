class TranslationMachine {
    constructor() {
        this.apiKey = '';
        this.currentFile = null;
        this.currentText = '';
        this.translationState = {
            isRunning: false,
            isPaused: false,
            chunks: [],
            currentChunk: 0,
            results: [],
            tokensUsed: 0,
            costSoFar: 0,
            sessionId: null,
            config: null
        };
        
        this.modelPricing = {
            'gpt-4o-mini': { input: 0.000150, output: 0.000600 }, // per 1K tokens
            'gpt-4o': { input: 0.0025, output: 0.01 }, // per 1K tokens  
            'gpt-4-turbo': { input: 0.01, output: 0.03 } // per 1K tokens
        };

        this.stylePresets = {
            formal: 'You are a professional translator. Translate the following text from its original language to English. Use a formal, professional tone. Maintain the original structure and formatting. Provide ONLY the English translation, do not include the original text. The output must be in English.',
            conversational: 'You are a professional translator. Translate the following text from its original language to English. Use a natural, conversational tone that sounds friendly and approachable. Provide ONLY the English translation, do not include the original text. The output must be in English.',
            academic: 'You are a professional translator. Translate the following text from its original language to English. Use an academic, scholarly tone with precise terminology and formal structure. Provide ONLY the English translation, do not include the original text. The output must be in English.',
            creative: 'You are a professional translator. Translate the following text from its original language to English. Use creative flair, adapting idioms and expressions to sound natural in English. Provide ONLY the English translation, do not include the original text. The output must be in English.',
            technical: 'You are a professional translator. Translate the following text from its original language to English. Maintain technical accuracy and specialized terminology. Provide ONLY the English translation, do not include the original text. The output must be in English.'
        };
        
        console.log('Style presets loaded. Checking all contain "English":');
        Object.keys(this.stylePresets).forEach(key => {
            const hasEnglish = this.stylePresets[key].toLowerCase().includes('english');
            console.log(`${key}: ${hasEnglish ? 'OK' : 'MISSING ENGLISH!'}`);
            if (!hasEnglish) {
                console.error(`Critical error in ${key} preset:`, this.stylePresets[key]);
            }
        });

        this.db = null;
        this.init();
    }

    async init() {
        await this.initDatabase();
        this.loadSettings();
        this.setupEventListeners();
        this.setupDragAndDrop();
        this.updateSystemPrompt();
        this.setupPageUnloadHandling();
        await this.checkForSavedSessions();
    }

    async initDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('TranslationMachine', 1);
            
            request.onerror = () => {
                console.warn('IndexedDB not available, persistence disabled');
                resolve();
            };
            
            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Create sessions store
                if (!db.objectStoreNames.contains('sessions')) {
                    const sessionStore = db.createObjectStore('sessions', { keyPath: 'id' });
                    sessionStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
    }

    async saveSession() {
        if (!this.db || !this.translationState.sessionId) return;

        const session = {
            id: this.translationState.sessionId,
            timestamp: Date.now(),
            fileName: this.currentFile?.name || 'Unknown',
            fileSize: this.currentFile?.size || 0,
            text: this.currentText,
            config: this.translationState.config,
            state: {
                chunks: this.translationState.chunks,
                currentChunk: this.translationState.currentChunk,
                results: this.translationState.results,
                tokensUsed: this.translationState.tokensUsed,
                costSoFar: this.translationState.costSoFar,
                isRunning: this.translationState.isRunning,
                isPaused: this.translationState.isPaused
            }
        };

        try {
            const transaction = this.db.transaction(['sessions'], 'readwrite');
            const store = transaction.objectStore('sessions');
            await store.put(session);
        } catch (error) {
            console.warn('Failed to save session:', error);
        }
    }

    startNewTranslation() {
        if (confirm('Start a new translation? This will clear the current document and translation.')) {
            console.log('Starting new translation - clearing all data');
            this.clearAllData();
            this.hideNewTranslationButton();
        }
    }

    showNewTranslationButton() {
        document.getElementById('newTranslationBtn').style.display = 'flex';
    }

    hideNewTranslationButton() {
        document.getElementById('newTranslationBtn').style.display = 'none';
    }

    async checkForSavedSessions() {
        // Check if we should clear data from a previous session
        const shouldClear = localStorage.getItem('translation-machine-should-clear');
        if (shouldClear === 'true') {
            console.log('Previous session requested clear - starting fresh');
            localStorage.removeItem('translation-machine-should-clear');
            await this.clearSavedSessions();
            return;
        }

        // Skip automatic session restoration for clean experience
        // Users can manually start new translations using the "New Translation" button
        console.log('Session auto-restore disabled for clean start experience');
        return;
    }

    showResumeDialog(sessions) {
        const latestSession = sessions.sort((a, b) => b.timestamp - a.timestamp)[0];
        const timeAgo = this.formatTimeAgo(latestSession.timestamp);
        
        if (confirm(`Resume previous translation of "${latestSession.fileName}" from ${timeAgo}?`)) {
            this.resumeSession(latestSession);
        }
    }

    async resumeSession(session) {
        // Restore file info
        this.currentText = session.text;
        this.currentFile = { name: session.fileName, size: session.fileSize };
        
        // Restore UI state
        this.showFileInfo(this.currentFile);
        this.showConfigSection();
        
        // Restore configuration
        if (session.config) {
            document.getElementById('modelSelect').value = session.config.model || 'gpt-4o-mini';
            document.getElementById('styleSelect').value = session.config.style || 'formal';
            document.getElementById('systemPrompt').value = session.config.systemPrompt || '';
            this.updateSystemPrompt();
        }
        
        // Restore translation state
        this.translationState = {
            ...this.translationState,
            sessionId: session.id,
            config: session.config,
            chunks: session.state.chunks || [],
            currentChunk: session.state.currentChunk || 0,
            results: session.state.results || [],
            tokensUsed: session.state.tokensUsed || 0,
            costSoFar: session.state.costSoFar || 0,
            isRunning: false,
            isPaused: false
        };
        
        // If there's progress, show the translation section
        if (this.translationState.results.some(result => result)) {
            this.showTranslationSection();
            this.updateProgress();
            this.updatePreview();
            
            const resumeBtn = document.createElement('button');
            resumeBtn.className = 'btn btn-primary';
            resumeBtn.innerHTML = '<i class="fas fa-play"></i> Resume Translation';
            resumeBtn.onclick = () => {
                resumeBtn.remove();
                this.continueTranslation();
            };
            
            document.querySelector('.progress-header').appendChild(resumeBtn);
        }
        
        this.updateCostEstimate();
    }

    async continueTranslation() {
        this.translationState.isRunning = true;
        this.translationState.isPaused = false;
        await this.processChunks();
    }

    formatTimeAgo(timestamp) {
        const minutes = Math.floor((Date.now() - timestamp) / (1000 * 60));
        if (minutes < 60) return `${minutes} minutes ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours} hours ago`;
        const days = Math.floor(hours / 24);
        return `${days} days ago`;
    }

    setupPageUnloadHandling() {
        // Clear data on page refresh or close
        window.addEventListener('beforeunload', (e) => {
            console.log('Page unloading - clearing data for fresh start');
            this.clearStoredData();
        });

        // Also clear when page becomes hidden (mobile browsers)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                console.log('Page hidden - clearing data for privacy');
                this.clearStoredData();
            }
        });

        // Ensure clean start on page load
        this.ensureCleanStart();
    }

    ensureCleanStart() {
        // Clear any session flag that indicates we should start fresh
        localStorage.removeItem('translation-machine-should-clear');
        console.log('Ensuring clean start - application ready for new translation');
    }

    clearStoredData() {
        // Mark that data should be cleared on next load
        localStorage.setItem('translation-machine-should-clear', 'true');
        
        // Clear saved sessions from IndexedDB immediately
        this.clearSavedSessions();
    }

    clearAllData() {
        console.log('Clearing all translation data for fresh start...');
        
        // Clear application state
        this.currentFile = null;
        this.currentText = '';
        this.translationState = {
            isRunning: false,
            isPaused: false,
            chunks: [],
            currentChunk: 0,
            results: [],
            tokensUsed: 0,
            costSoFar: 0,
            sessionId: null,
            config: null
        };

        // Clear UI state
        this.resetUI();
        
        // Clear saved sessions from IndexedDB
        this.clearSavedSessions();
    }

    resetUI() {
        // Hide all sections except upload
        document.getElementById('fileInfo').style.display = 'none';
        document.getElementById('uploadArea').style.display = 'block';
        document.getElementById('configSection').style.display = 'none';
        document.getElementById('translationSection').style.display = 'none';
        
        // Clear file input
        document.getElementById('fileInput').value = '';
        
        // Hide OCR progress
        this.hideOcrProgress();
        
        // Reset cost estimates
        document.getElementById('estimatedTokens').textContent = '-';
        document.getElementById('estimatedCost').textContent = '-';
        
        // Reset system prompt to default
        this.updateSystemPrompt();
        
        console.log('UI reset to initial state');
    }

    async clearSavedSessions() {
        if (!this.db) return;
        
        try {
            const transaction = this.db.transaction(['sessions'], 'readwrite');
            const store = transaction.objectStore('sessions');
            await store.clear();
            console.log('Cleared all saved sessions from IndexedDB');
        } catch (error) {
            console.warn('Failed to clear saved sessions:', error);
        }
    }

    loadSettings() {
        const saved = localStorage.getItem('translation-machine-settings');
        if (saved) {
            const settings = JSON.parse(saved);
            this.apiKey = settings.apiKey || '';
            document.getElementById('chunkSize').value = settings.chunkSize || '1500';
        }
    }

    saveSettings() {
        const settings = {
            apiKey: this.apiKey,
            chunkSize: document.getElementById('chunkSize').value
        };
        localStorage.setItem('translation-machine-settings', JSON.stringify(settings));
    }

    setupEventListeners() {
        // Settings modal
        document.getElementById('settingsBtn').addEventListener('click', this.openSettings.bind(this));
        document.getElementById('closeSettingsBtn').addEventListener('click', this.closeSettings.bind(this));
        document.getElementById('cancelSettingsBtn').addEventListener('click', this.closeSettings.bind(this));
        document.getElementById('saveSettingsBtn').addEventListener('click', this.saveSettingsModal.bind(this));
        document.getElementById('toggleApiKey').addEventListener('click', this.toggleApiKeyVisibility.bind(this));

        // New translation button
        document.getElementById('newTranslationBtn').addEventListener('click', this.startNewTranslation.bind(this));

        // File upload
        document.getElementById('fileInput').addEventListener('change', this.handleFileSelect.bind(this));
        document.getElementById('removeFile').addEventListener('click', this.removeFile.bind(this));

        // Configuration
        document.getElementById('modelSelect').addEventListener('change', this.updateCostEstimate.bind(this));
        document.getElementById('styleSelect').addEventListener('change', this.updateSystemPrompt.bind(this));
        document.getElementById('systemPrompt').addEventListener('input', this.debounce(this.updateCostEstimate.bind(this), 500));
        document.getElementById('debugPromptBtn').addEventListener('click', this.debugSystemPrompt.bind(this));

        // Translation controls
        document.getElementById('translateBtn').addEventListener('click', this.startTranslation.bind(this));
        document.getElementById('pauseBtn').addEventListener('click', this.pauseTranslation.bind(this));
        document.getElementById('resumeBtn').addEventListener('click', this.resumeTranslation.bind(this));
        document.getElementById('stopBtn').addEventListener('click', this.stopTranslation.bind(this));

        // Export
        document.getElementById('exportTxtBtn').addEventListener('click', this.exportTxt.bind(this));
        document.getElementById('exportDocxBtn').addEventListener('click', this.exportDocx.bind(this));

        // Modal backdrop
        document.getElementById('settingsModal').addEventListener('click', (e) => {
            if (e.target.id === 'settingsModal') {
                this.closeSettings();
            }
        });
    }

    setupDragAndDrop() {
        const uploadArea = document.getElementById('uploadArea');
        
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            uploadArea.addEventListener(eventName, this.preventDefaults, false);
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            uploadArea.addEventListener(eventName, () => uploadArea.classList.add('drag-over'), false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            uploadArea.addEventListener(eventName, () => uploadArea.classList.remove('drag-over'), false);
        });

        uploadArea.addEventListener('drop', this.handleDrop.bind(this), false);
    }

    preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        
        if (files.length > 0) {
            this.processFile(files[0]);
        }
    }

    handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) {
            this.processFile(file);
        }
    }

    async processFile(file) {
        const maxSize = 50 * 1024 * 1024; // 50MB
        if (file.size > maxSize) {
            alert('File size must be less than 50MB');
            return;
        }

        const allowedTypes = ['text/plain', 'application/pdf', 'application/epub+zip'];
        if (!allowedTypes.includes(file.type) && !file.name.toLowerCase().endsWith('.epub')) {
            alert('Please select a TXT, PDF, or EPUB file');
            return;
        }

        this.currentFile = file;
        this.showFileInfo(file);
        
        try {
            this.currentText = await this.extractText(file);
            this.updateCostEstimate();
            this.showConfigSection();
        } catch (error) {
            console.error('Error processing file:', error);
            
            // Show more specific error message
            let errorMessage = 'Error reading file:\n\n' + error.message;
            
            if (error.message.includes('PDF.js library not loaded')) {
                errorMessage += '\n\nPlease refresh the page and try again.';
            }
            
            alert(errorMessage);
            
            // Reset file selection
            this.removeFile();
        }
    }

    async extractText(file) {
        const type = file.type || this.getFileTypeFromName(file.name);
        
        switch (type) {
            case 'text/plain':
                return await file.text();
            case 'application/pdf':
                return await this.extractPdfText(file);
            case 'application/epub+zip':
                return await this.extractEpubText(file);
            default:
                throw new Error('Unsupported file type');
        }
    }

    getFileTypeFromName(filename) {
        const ext = filename.toLowerCase().split('.').pop();
        switch (ext) {
            case 'txt': return 'text/plain';
            case 'pdf': return 'application/pdf';
            case 'epub': return 'application/epub+zip';
            default: return '';
        }
    }

    async extractPdfText(file) {
        return new Promise((resolve, reject) => {
            // Check if PDF.js is available
            if (typeof pdfjsLib === 'undefined') {
                reject(new Error('PDF.js library not loaded. Please refresh the page and try again.'));
                return;
            }

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const typedarray = new Uint8Array(e.target.result);
                    
                    // Configure PDF.js worker with fallback
                    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
                        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                    }
                    
                    console.log('Loading PDF with', typedarray.length, 'bytes');
                    
                    const loadingTask = pdfjsLib.getDocument({
                        data: typedarray,
                        cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
                        cMapPacked: true
                    });
                    
                    const pdf = await loadingTask.promise;
                    console.log('PDF loaded successfully, pages:', pdf.numPages);
                    
                    let fullText = '';
                    
                    // Extract text from each page
                    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                        try {
                            const page = await pdf.getPage(pageNum);
                            const textContent = await page.getTextContent();
                            const pageText = textContent.items
                                .map(item => item.str)
                                .join(' ')
                                .replace(/\s+/g, ' ')
                                .trim();
                            
                            if (pageText) {
                                fullText += pageText + '\n\n';
                                console.log(`Page ${pageNum}: ${pageText.length} characters extracted`);
                            }
                        } catch (pageError) {
                            console.warn(`Error extracting text from page ${pageNum}:`, pageError);
                            // Continue with other pages
                        }
                    }
                    
                    if (!fullText.trim()) {
                        console.log('No text found, attempting OCR...');
                        // Try OCR for scanned PDFs
                        try {
                            const ocrText = await this.performOcrOnPdf(pdf);
                            if (ocrText.trim()) {
                                console.log('OCR extraction completed:', ocrText.length, 'characters');
                                resolve(ocrText.trim());
                            } else {
                                reject(new Error('No text could be extracted from this PDF, even with OCR. The PDF may be corrupted or contain no readable content.'));
                            }
                        } catch (ocrError) {
                            console.error('OCR failed:', ocrError);
                            reject(new Error('This appears to be a scanned PDF, but OCR processing failed:\n' + ocrError.message + '\n\nTry converting the PDF to text manually first.'));
                        }
                    } else {
                        console.log('PDF text extraction completed:', fullText.length, 'characters');
                        resolve(fullText.trim());
                    }
                } catch (error) {
                    console.error('PDF parsing error:', error);
                    let errorMessage = 'Error parsing PDF: ';
                    
                    if (error.message.includes('Invalid PDF')) {
                        errorMessage += 'The file appears to be corrupted or not a valid PDF.';
                    } else if (error.message.includes('Password')) {
                        errorMessage += 'This PDF is password protected.';
                    } else if (error.message.includes('NetworkError') || error.message.includes('fetch')) {
                        errorMessage += 'Could not load PDF.js library. Please check your internet connection and try again.';
                    } else {
                        errorMessage += error.message || 'Unknown error occurred.';
                    }
                    
                    reject(new Error(errorMessage));
                }
            };
            
            reader.onerror = function() {
                reject(new Error('Could not read the file. Please try again with a different PDF.'));
            };
            
            reader.readAsArrayBuffer(file);
        });
    }

    async performOcrOnPdf(pdf) {
        // Check if Tesseract is available
        if (typeof Tesseract === 'undefined') {
            throw new Error('OCR library (Tesseract.js) not loaded. Please refresh the page and try again.');
        }
        
        // Show OCR progress
        this.showOcrProgress();
        
        let fullText = '';
        const totalPages = pdf.numPages;
        
        try {
            for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
                this.updateOcrProgress(pageNum - 1, totalPages, `Processing page ${pageNum} of ${totalPages}...`);
                
                try {
                    // Get the page
                    const page = await pdf.getPage(pageNum);
                    
                    // Render page to canvas
                    const scale = 2.0; // Higher scale for better OCR accuracy
                    const viewport = page.getViewport({ scale });
                    
                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;
                    
                    const renderContext = {
                        canvasContext: context,
                        viewport: viewport
                    };
                    
                    await page.render(renderContext).promise;
                    
                    // Convert canvas to image data for OCR
                    const imageData = canvas.toDataURL('image/png');
                    
                    // Perform OCR on the page
                    const { data: { text } } = await Tesseract.recognize(imageData, 'eng', {
                        logger: (m) => {
                            if (m.status === 'recognizing text') {
                                const progress = Math.round(m.progress * 100);
                                this.updateOcrProgress(pageNum - 1 + m.progress, totalPages, 
                                    `OCR on page ${pageNum}: ${progress}%`);
                            }
                        }
                    });
                    
                    if (text.trim()) {
                        fullText += text.trim() + '\n\n';
                        console.log(`OCR Page ${pageNum}: ${text.length} characters extracted`);
                    }
                    
                } catch (pageError) {
                    console.warn(`OCR failed on page ${pageNum}:`, pageError);
                    // Continue with other pages
                }
            }
            
            this.updateOcrProgress(totalPages, totalPages, 'OCR completed!');
            
            // Hide OCR progress after a short delay
            setTimeout(() => this.hideOcrProgress(), 1500);
            
            return fullText;
            
        } catch (error) {
            this.hideOcrProgress();
            throw error;
        }
    }

    showOcrProgress() {
        document.getElementById('ocrProgress').style.display = 'block';
        document.getElementById('ocrProgressFill').style.width = '0%';
        document.getElementById('ocrProgressText').textContent = '0%';
        document.getElementById('ocrStatusText').textContent = 'Initializing OCR...';
    }

    updateOcrProgress(current, total, status) {
        const percentage = Math.round((current / total) * 100);
        document.getElementById('ocrProgressFill').style.width = percentage + '%';
        document.getElementById('ocrProgressText').textContent = percentage + '%';
        document.getElementById('ocrStatusText').textContent = status;
    }

    hideOcrProgress() {
        document.getElementById('ocrProgress').style.display = 'none';
    }

    async extractEpubText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const zip = await JSZip.loadAsync(e.target.result);
                    let fullText = '';
                    
                    // Find all XHTML files in the EPUB
                    const xhtmlFiles = [];
                    zip.forEach((relativePath, zipEntry) => {
                        if (relativePath.endsWith('.xhtml') || relativePath.endsWith('.html') || 
                            (relativePath.includes('OEBPS/') && relativePath.endsWith('.xml'))) {
                            xhtmlFiles.push(relativePath);
                        }
                    });
                    
                    // Sort files to maintain reading order (basic sorting)
                    xhtmlFiles.sort();
                    
                    // Extract text from each XHTML file
                    for (const filePath of xhtmlFiles) {
                        try {
                            const content = await zip.file(filePath).async('string');
                            const textContent = this.extractTextFromHtml(content);
                            if (textContent.trim()) {
                                fullText += textContent + '\n\n';
                            }
                        } catch (error) {
                            console.warn(`Failed to extract text from ${filePath}:`, error);
                        }
                    }
                    
                    if (!fullText.trim()) {
                        reject(new Error('No readable text found in EPUB file.'));
                    } else {
                        resolve(fullText.trim());
                    }
                } catch (error) {
                    reject(new Error(`Error parsing EPUB: ${error.message}`));
                }
            };
            reader.readAsArrayBuffer(file);
        });
    }

    extractTextFromHtml(htmlContent) {
        // Create a temporary DOM element to parse HTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlContent;
        
        // Remove script and style elements
        const scripts = tempDiv.querySelectorAll('script, style');
        scripts.forEach(el => el.remove());
        
        // Get text content and clean it up
        let text = tempDiv.textContent || tempDiv.innerText || '';
        
        // Clean up whitespace
        text = text.replace(/\s+/g, ' ').trim();
        
        // Add paragraph breaks for better formatting
        text = text.replace(/\. ([A-Z])/g, '.\n\n$1');
        
        return text;
    }

    showFileInfo(file) {
        document.getElementById('fileName').textContent = file.name;
        document.getElementById('fileSize').textContent = this.formatFileSize(file.size);
        document.getElementById('fileInfo').style.display = 'block';
        document.getElementById('uploadArea').style.display = 'none';
        this.showNewTranslationButton();
    }

    removeFile() {
        this.currentFile = null;
        this.currentText = '';
        document.getElementById('fileInfo').style.display = 'none';
        document.getElementById('uploadArea').style.display = 'block';
        document.getElementById('configSection').style.display = 'none';
        document.getElementById('fileInput').value = '';
        this.hideOcrProgress();
        this.hideNewTranslationButton();
    }

    showConfigSection() {
        document.getElementById('configSection').style.display = 'block';
        document.getElementById('configSection').classList.add('fade-in');
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    updateSystemPrompt() {
        const styleSelect = document.getElementById('styleSelect');
        const promptTextarea = document.getElementById('systemPrompt');
        
        console.log('=== SYSTEM PROMPT UPDATE ===');
        console.log('Style selected:', styleSelect.value);
        
        if (styleSelect.value !== 'custom') {
            let template = this.stylePresets[styleSelect.value];
            console.log('Template from preset:', template);
            
            // Ensure template contains English
            if (!template.toLowerCase().includes('english')) {
                console.error('CRITICAL: Template does not contain "English"!', template);
                // Fix the template
                template = template.replace(/to \{language\}/g, 'to English');
                console.log('Fixed template:', template);
            }
            
            promptTextarea.value = template;
            console.log('Final system prompt set to:', template);
            console.log('Prompt contains "English"?:', template.toLowerCase().includes('english'));
        } else {
            console.log('Using custom prompt:', promptTextarea.value);
        }
        
        // Update cost estimate when prompt changes
        if (this.currentText) {
            this.updateCostEstimate();
        }
        
        console.log('=== END SYSTEM PROMPT UPDATE ===');
    }

    debugSystemPrompt() {
        const promptTextarea = document.getElementById('systemPrompt');
        const promptStatus = document.getElementById('promptStatus');
        const promptStatusText = document.getElementById('promptStatusText');
        const currentPrompt = promptTextarea.value;
        
        console.log('=== SYSTEM PROMPT DEBUG ===');
        console.log('Current prompt:', currentPrompt);
        
        const issues = [];
        const suggestions = [];
        
        // Check if prompt contains "English"
        if (!currentPrompt.toLowerCase().includes('english')) {
            issues.push('❌ Prompt does not mention "English" as target language');
            suggestions.push('Add "to English" or "in English"');
        } else {
            console.log('✅ Prompt contains "English"');
        }
        
        // Check if prompt says "translate"
        if (!currentPrompt.toLowerCase().includes('translate')) {
            issues.push('❌ Prompt does not contain "translate" instruction');
            suggestions.push('Add translation instruction');
        } else {
            console.log('✅ Prompt contains translation instruction');
        }
        
        // Check for problematic language mentions
        if (currentPrompt.toLowerCase().includes('portuguese') || currentPrompt.toLowerCase().includes('português')) {
            issues.push('❌ Prompt mentions Portuguese as target (should only be source)');
            suggestions.push('Remove Portuguese as target language');
        }
        
        // Check if prompt says not to include original
        if (!currentPrompt.toLowerCase().includes('only') || !currentPrompt.toLowerCase().includes('not include')) {
            issues.push('❌ Prompt may allow original text in response');
            suggestions.push('Add "Provide ONLY the English translation, do not include the original text"');
        } else {
            console.log('✅ Prompt instructs to exclude original text');
        }
        
        console.log('Issues found:', issues);
        console.log('Suggestions:', suggestions);
        
        if (issues.length > 0) {
            promptStatus.style.display = 'block';
            promptStatusText.innerHTML = `<strong>Issues found:</strong><br>${issues.join('<br>')}<br><br><strong>Suggestions:</strong><br>${suggestions.join('<br>')}`;
            
            // Offer to fix automatically
            if (confirm('Issues found with system prompt. Would you like to automatically fix it?')) {
                this.fixSystemPrompt();
            }
        } else {
            promptStatus.style.display = 'block';
            promptStatusText.innerHTML = '✅ System prompt looks good for English translation!';
            setTimeout(() => {
                promptStatus.style.display = 'none';
            }, 3000);
        }
        
        console.log('=== END SYSTEM PROMPT DEBUG ===');
    }

    fixSystemPrompt() {
        const promptTextarea = document.getElementById('systemPrompt');
        const fixedPrompt = 'You are a professional translator. Translate the following text from its original language to English. Use a formal, professional tone. Provide ONLY the English translation, do not include the original text. The output must be in English.';
        
        promptTextarea.value = fixedPrompt;
        console.log('System prompt fixed to:', fixedPrompt);
        
        const promptStatus = document.getElementById('promptStatus');
        const promptStatusText = document.getElementById('promptStatusText');
        promptStatus.style.display = 'block';
        promptStatusText.innerHTML = '✅ System prompt has been fixed for English translation!';
        
        setTimeout(() => {
            promptStatus.style.display = 'none';
        }, 3000);
    }

    // Rough token estimation (approximate)
    estimateTokens(text) {
        // More conservative approximation: 1 token ≈ 0.75 words ≈ 3.5 characters
        // This accounts for punctuation and special characters
        return Math.ceil(text.length / 3.5);
    }

    updateCostEstimate() {
        if (!this.currentText) return;

        const model = document.getElementById('modelSelect').value;
        const systemPrompt = document.getElementById('systemPrompt').value;
        
        const inputTokens = this.estimateTokens(this.currentText + systemPrompt);
        const outputTokens = Math.ceil(inputTokens * 1.2); // Estimate output tokens
        
        const pricing = this.modelPricing[model];
        const inputCost = (inputTokens / 1000) * pricing.input;
        const outputCost = (outputTokens / 1000) * pricing.output;
        const totalCost = inputCost + outputCost;
        
        document.getElementById('estimatedTokens').textContent = inputTokens.toLocaleString();
        document.getElementById('estimatedCost').textContent = '$' + totalCost.toFixed(4);
    }

    async startTranslation() {
        if (!this.validateSettings()) return;

        // Create new session
        this.translationState.sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        this.translationState.config = {
            model: document.getElementById('modelSelect').value,
            style: document.getElementById('styleSelect').value,
            systemPrompt: document.getElementById('systemPrompt').value
        };

        this.translationState.isRunning = true;
        this.translationState.isPaused = false;
        this.translationState.currentChunk = 0;
        this.translationState.results = [];
        this.translationState.tokensUsed = 0;
        this.translationState.costSoFar = 0;

        this.setupChunks();
        this.showTranslationSection();
        this.updateProgress();
        
        // Save initial session
        await this.saveSession();
        
        await this.processChunks();
    }

    validateSettings() {
        if (!this.apiKey) {
            alert('Please enter your OpenAI API key in Settings');
            this.openSettings();
            return false;
        }

        if (!this.currentText) {
            alert('Please upload a file first');
            return false;
        }

        return true;
    }

    setupChunks() {
        const chunkSize = parseInt(document.getElementById('chunkSize').value);
        const systemPrompt = document.getElementById('systemPrompt').value;
        const systemPromptTokens = this.estimateTokens(systemPrompt);
        
        // Reserve tokens for system prompt and ensure we don't exceed output limits
        // Use conservative chunk size accounting for translation expansion (typically 1.2-1.5x)
        const maxInputTokens = Math.min(chunkSize - systemPromptTokens, 8000); // Cap input to 8K tokens
        
        console.log('Chunk setup - System prompt tokens:', systemPromptTokens, 'Max input tokens per chunk:', maxInputTokens);
        
        this.translationState.chunks = this.chunkText(this.currentText, maxInputTokens);
        
        document.getElementById('chunksProgress').textContent = `0 / ${this.translationState.chunks.length}`;
        
        console.log('Created', this.translationState.chunks.length, 'chunks');
    }

    chunkText(text, maxTokens) {
        const chunks = [];
        const paragraphs = text.split(/\n\s*\n/);
        let currentChunk = '';
        
        for (const paragraph of paragraphs) {
            const testChunk = currentChunk + (currentChunk ? '\n\n' : '') + paragraph;
            
            if (this.estimateTokens(testChunk) > maxTokens && currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = paragraph;
                
                // If a single paragraph is too large, split it further
                if (this.estimateTokens(paragraph) > maxTokens) {
                    const sentences = paragraph.split(/(?<=[.!?])\s+/);
                    let sentenceChunk = '';
                    
                    for (const sentence of sentences) {
                        const testSentence = sentenceChunk + (sentenceChunk ? ' ' : '') + sentence;
                        
                        if (this.estimateTokens(testSentence) > maxTokens && sentenceChunk) {
                            chunks.push(sentenceChunk.trim());
                            sentenceChunk = sentence;
                        } else {
                            sentenceChunk = testSentence;
                        }
                    }
                    
                    currentChunk = sentenceChunk;
                }
            } else {
                currentChunk = testChunk;
            }
        }
        
        if (currentChunk) {
            chunks.push(currentChunk.trim());
        }
        
        // Final validation - split any remaining chunks that are too large
        const validatedChunks = [];
        for (const chunk of chunks) {
            if (this.estimateTokens(chunk) > maxTokens) {
                // Force split by character count as last resort
                const words = chunk.split(' ');
                let wordChunk = '';
                
                for (const word of words) {
                    const testWord = wordChunk + (wordChunk ? ' ' : '') + word;
                    
                    if (this.estimateTokens(testWord) > maxTokens && wordChunk) {
                        validatedChunks.push(wordChunk.trim());
                        wordChunk = word;
                    } else {
                        wordChunk = testWord;
                    }
                }
                
                if (wordChunk) {
                    validatedChunks.push(wordChunk.trim());
                }
            } else {
                validatedChunks.push(chunk);
            }
        }
        
        return validatedChunks;
    }

    getMaxTokensForModel(model, inputText) {
        // Model limits for completion tokens (output)
        const modelLimits = {
            'gpt-4o-mini': 16384,
            'gpt-4o': 16384, 
            'gpt-4-turbo': 4096
        };
        
        const maxCompletionTokens = modelLimits[model] || 4096;
        
        // Estimate input tokens
        const inputTokens = this.estimateTokens(inputText);
        
        // For translation, output is typically 0.8-1.2x input size
        // Use conservative multiplier and cap at model limit
        const estimatedOutputTokens = Math.ceil(inputTokens * 1.2);
        const safeMaxTokens = Math.min(estimatedOutputTokens, maxCompletionTokens);
        
        // Ensure we have at least 1000 tokens for output, but not more than the limit
        const finalMaxTokens = Math.max(1000, Math.min(safeMaxTokens, maxCompletionTokens));
        
        console.log(`Model: ${model}, Input tokens: ${inputTokens}, Max completion tokens: ${finalMaxTokens}`);
        
        return finalMaxTokens;
    }

    showTranslationSection() {
        document.getElementById('translationSection').style.display = 'block';
        document.getElementById('translationSection').classList.add('fade-in');
        document.getElementById('previewContent').innerHTML = '<div class="preview-placeholder">Starting translation...</div>';
        this.showNewTranslationButton(); // Allow starting fresh even during translation
    }

    async processChunks() {
        const totalChunks = this.translationState.chunks.length;
        console.log(`Starting translation of ${totalChunks} chunks`);
        
        for (let i = this.translationState.currentChunk; i < totalChunks; i++) {
            if (!this.translationState.isRunning) break;
            
            while (this.translationState.isPaused) {
                await this.sleep(100);
            }
            
            console.log(`Processing chunk ${i + 1}/${totalChunks}`);
            console.log('Chunk content preview:', this.translationState.chunks[i].substring(0, 100) + '...');
            
            let retryCount = 0;
            const maxRetries = 3;
            let success = false;
            
            while (!success && retryCount < maxRetries && this.translationState.isRunning) {
                try {
                    const result = await this.translateChunk(this.translationState.chunks[i]);
                    this.translationState.results[i] = result.text;
                    this.translationState.tokensUsed += result.tokensUsed;
                    this.translationState.costSoFar += result.cost;
                    this.translationState.currentChunk = i + 1;
                    
                    console.log(`Chunk ${i + 1} translated successfully. Result preview:`, result.text.substring(0, 100) + '...');
                    
                    success = true;
                    
                    this.updateProgress();
                    this.updatePreview();
                    
                    // Save progress every few chunks
                    if ((i + 1) % 3 === 0) {
                        await this.saveSession();
                    }
                    
                } catch (error) {
                    retryCount++;
                    console.error(`Translation error for chunk ${i + 1} (attempt ${retryCount}):`, error);
                    
                    if (error.message.includes('rate limit') || error.message.includes('Rate limit')) {
                        const waitTime = Math.min(5000 * retryCount, 30000); // Wait 5s, 10s, 15s...
                        console.log(`Rate limited. Waiting ${waitTime/1000} seconds before retry...`);
                        await this.sleep(waitTime);
                    } else if (error.message.includes('max_tokens')) {
                        // If still hitting token limits, mark chunk as failed and continue
                        console.error(`Token limit error on chunk ${i + 1}, marking as failed`);
                        this.translationState.results[i] = `[TRANSLATION FAILED - CHUNK TOO LARGE: ${this.translationState.chunks[i].substring(0, 200)}...]`;
                        success = true; // Don't retry token limit errors
                    } else if (retryCount >= maxRetries) {
                        console.error(`Failed to translate chunk ${i + 1} after ${maxRetries} attempts`);
                        this.translationState.results[i] = `[TRANSLATION FAILED: ${this.translationState.chunks[i].substring(0, 200)}...]`;
                        success = true; // Move on to next chunk
                    } else {
                        // Wait before retry for other errors
                        await this.sleep(1000 * retryCount);
                    }
                }
            }
            
            if (!success) {
                console.error(`Chunk ${i + 1} failed completely, inserting original text`);
                this.translationState.results[i] = `[UNTRANSLATED: ${this.translationState.chunks[i]}]`;
            }
        }
        
        // Verify all chunks have results
        console.log('Translation complete. Verifying results...');
        const missingChunks = [];
        for (let i = 0; i < totalChunks; i++) {
            if (!this.translationState.results[i]) {
                missingChunks.push(i + 1);
                this.translationState.results[i] = `[MISSING TRANSLATION: ${this.translationState.chunks[i]}]`;
            }
        }
        
        if (missingChunks.length > 0) {
            console.warn('Missing translations for chunks:', missingChunks);
        }
        
        console.log('Final results array length:', this.translationState.results.length);
        console.log('Expected chunks:', totalChunks);
        
        if (this.translationState.currentChunk >= totalChunks) {
            await this.completeTranslation();
        }
    }

    async translateChunk(text) {
        const model = document.getElementById('modelSelect').value;
        const systemPrompt = document.getElementById('systemPrompt').value;
        
        console.log('=== TRANSLATION DEBUG INFO ===');
        console.log('Model:', model);
        console.log('System prompt being sent:', systemPrompt);
        console.log('Input text (first 200 chars):', text.substring(0, 200) + '...');
        console.log('System prompt contains "English"?:', systemPrompt.toLowerCase().includes('english'));
        console.log('System prompt contains "translate"?:', systemPrompt.toLowerCase().includes('translate'));
        
        // Double-check the system prompt is for English translation
        if (!systemPrompt.toLowerCase().includes('english')) {
            console.error('CRITICAL ERROR: System prompt does not contain "English"!');
            console.error('Current prompt:', systemPrompt);
            console.error('Forcing fallback to English translation prompt...');
            
            // Fallback to ensure English translation
            systemPrompt = 'You are a professional translator. Translate the following text to English. Provide only the English translation, do not include the original text.';
            console.log('Using fallback prompt:', systemPrompt);
        }
        
        // Additional safety check - make sure we're not accidentally asking for Portuguese
        if (systemPrompt.toLowerCase().includes('portuguese') || systemPrompt.toLowerCase().includes('português')) {
            console.error('CRITICAL ERROR: System prompt mentions Portuguese - this will cause wrong output!');
            console.error('Problematic prompt:', systemPrompt);
            
            // Force English-only prompt
            systemPrompt = 'You are a professional translator. Translate the following text from Portuguese to English. Use a formal, professional tone. Provide only the English translation, do not include the original Portuguese text.';
            console.log('Using corrected prompt:', systemPrompt);
        }
        
        // Create the API request body
        const requestBody = {
            model: model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `TRANSLATE TO ENGLISH: ${text}` }
            ],
            temperature: 0.1, // Lower temperature for more consistent translation
            max_tokens: this.getMaxTokensForModel(model, text)
        };

        console.log('=== FULL API REQUEST ===');
        console.log('Request body:', JSON.stringify(requestBody, null, 2));
        console.log('System message:', requestBody.messages[0].content);
        console.log('User message preview:', requestBody.messages[1].content.substring(0, 100) + '...');
        
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'API request failed');
        }

        const data = await response.json();
        const usage = data.usage;
        const pricing = this.modelPricing[model];
        
        console.log('=== FULL API RESPONSE ===');
        console.log('Complete response:', JSON.stringify(data, null, 2));
        console.log('Response finish reason:', data.choices[0].finish_reason);
        
        const translatedText = data.choices[0].message.content;
        console.log('=== TRANSLATION ANALYSIS ===');
        console.log('Translation result (first 300 chars):', translatedText.substring(0, 300) + '...');
        console.log('Full translation length:', translatedText.length, 'characters');
        
        // Enhanced language detection with more comprehensive word lists
        const portugueseWords = ['que', 'para', 'com', 'uma', 'como', 'mais', 'por', 'não', 'dos', 'da', 'de', 'do', 'ser', 'ter', 'este', 'essa', 'fazer', 'dizer', 'muito', 'sobre'];
        const englishWords = ['the', 'and', 'for', 'are', 'with', 'this', 'that', 'from', 'they', 'have', 'will', 'would', 'could', 'should', 'there', 'their', 'these', 'those', 'when', 'where'];
        
        const lowerText = translatedText.toLowerCase();
        const portugueseMatches = portugueseWords.filter(word => {
            const regex = new RegExp(`\\b${word}\\b`, 'g');
            return regex.test(lowerText);
        });
        const englishMatches = englishWords.filter(word => {
            const regex = new RegExp(`\\b${word}\\b`, 'g');
            return regex.test(lowerText);
        });
        
        console.log('Portuguese words found:', portugueseMatches.length, portugueseMatches);
        console.log('English words found:', englishMatches.length, englishMatches);
        
        const confidence = englishMatches.length / (englishMatches.length + portugueseMatches.length) * 100;
        console.log('English confidence:', confidence.toFixed(1) + '%');
        
        if (portugueseMatches.length > englishMatches.length && portugueseMatches.length > 2) {
            console.error('🚨 CRITICAL: Translation result is in Portuguese!');
            console.error('Portuguese words detected:', portugueseMatches);
            console.error('This means OpenAI is completely ignoring our English translation request');
            
            // Try to force a re-translation with an even stronger prompt
            console.warn('Attempting to force English translation...');
            return await this.forceEnglishTranslation(text, model);
        } else if (confidence < 70) {
            console.warn('⚠️ WARNING: Translation confidence is low (' + confidence.toFixed(1) + '%)');
            console.warn('Result may contain mixed languages or errors');
        } else {
            console.log('✅ Translation appears to be in English (confidence: ' + confidence.toFixed(1) + '%)');
        }
        
        const cost = (usage.prompt_tokens / 1000) * pricing.input + 
                    (usage.completion_tokens / 1000) * pricing.output;
        
        return {
            text: translatedText,
            tokensUsed: usage.total_tokens,
            cost: cost
        };
    }

    async forceEnglishTranslation(text, model) {
        console.log('🔧 FORCING ENGLISH TRANSLATION - Second attempt with stronger prompt');
        
        // Ultra-strong system prompt
        const forcePrompt = `CRITICAL INSTRUCTION: You MUST translate the following text to ENGLISH ONLY. 
DO NOT respond in Portuguese, Spanish, or any other language. 
Your response must be 100% in English language.
You are translating FROM Portuguese TO English.
ENGLISH OUTPUT REQUIRED. NO EXCEPTIONS.

Translate this text to English:`;

        // Even more explicit user message
        const userMessage = `TRANSLATE TO ENGLISH (NOT Portuguese): ${text}

IMPORTANT: Your response must be in English language only. Do not include any Portuguese text in your response.`;

        const requestBody = {
            model: model,
            messages: [
                { role: 'system', content: forcePrompt },
                { role: 'user', content: userMessage }
            ],
            temperature: 0.0, // Maximum consistency
            max_tokens: this.getMaxTokensForModel(model, text)
        };

        console.log('=== FORCE TRANSLATION REQUEST ===');
        console.log('Force system prompt:', forcePrompt);
        console.log('Force user message preview:', userMessage.substring(0, 150) + '...');
        
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            console.error('Force translation API request failed');
            throw new Error('Force translation failed - using original Portuguese result');
        }

        const data = await response.json();
        const translatedText = data.choices[0].message.content;
        const usage = data.usage;
        const pricing = this.modelPricing[model];
        
        console.log('=== FORCE TRANSLATION RESULT ===');
        console.log('Forced result (first 300 chars):', translatedText.substring(0, 300) + '...');
        
        // Re-check if it's now in English
        const lowerText = translatedText.toLowerCase();
        const portugueseTest = ['que', 'para', 'com', 'uma', 'não'].some(word => 
            new RegExp(`\\b${word}\\b`).test(lowerText)
        );
        
        if (portugueseTest) {
            console.error('🚨 FORCE TRANSLATION ALSO FAILED - OpenAI is not cooperating');
            console.error('This is likely a model issue or API problem');
            
            // Last resort: add warning prefix to the Portuguese result
            const warningText = `[WARNING: Translation failed - OpenAI returned Portuguese instead of English]\n\n${translatedText}`;
            return {
                text: warningText,
                tokensUsed: usage.total_tokens,
                cost: (usage.prompt_tokens / 1000) * pricing.input + (usage.completion_tokens / 1000) * pricing.output
            };
        } else {
            console.log('✅ FORCE TRANSLATION SUCCESSFUL - Now in English');
            return {
                text: translatedText,
                tokensUsed: usage.total_tokens,
                cost: (usage.prompt_tokens / 1000) * pricing.input + (usage.completion_tokens / 1000) * pricing.output
            };
        }
    }

    updateProgress() {
        const progress = (this.translationState.currentChunk / this.translationState.chunks.length) * 100;
        
        document.getElementById('progressFill').style.width = progress + '%';
        document.getElementById('progressText').textContent = Math.round(progress) + '%';
        document.getElementById('tokensUsed').textContent = this.translationState.tokensUsed.toLocaleString();
        document.getElementById('costSoFar').textContent = '$' + this.translationState.costSoFar.toFixed(4);
        document.getElementById('chunksProgress').textContent = 
            `${this.translationState.currentChunk} / ${this.translationState.chunks.length}`;
    }

    updatePreview() {
        const preview = document.getElementById('previewContent');
        const totalChunks = this.translationState.chunks.length;
        const completedChunks = this.translationState.results.filter(result => result).length;
        
        // Combine all results, including placeholders for missing chunks
        const allResults = [];
        for (let i = 0; i < totalChunks; i++) {
            if (this.translationState.results[i]) {
                allResults.push(this.translationState.results[i]);
            } else {
                allResults.push(`[Processing chunk ${i + 1}...]`);
            }
        }
        
        const combinedText = allResults.join('\n\n');
        
        if (combinedText) {
            let previewHtml = `<div style="white-space: pre-wrap; line-height: 1.6;">${this.escapeHtml(combinedText)}</div>`;
            
            // Add summary at the top if translation is in progress
            if (completedChunks < totalChunks) {
                const summaryHtml = `
                    <div style="background: var(--background-color); padding: 1rem; margin-bottom: 1rem; border-radius: var(--radius-md); border-left: 4px solid var(--primary-color);">
                        <strong>Translation Progress:</strong> ${completedChunks}/${totalChunks} chunks completed
                        <br><small>Scroll down to see translated content as it appears...</small>
                    </div>
                `;
                previewHtml = summaryHtml + previewHtml;
            }
            
            preview.innerHTML = previewHtml;
            preview.scrollTop = preview.scrollHeight;
        }
        
        console.log(`Preview updated: ${completedChunks}/${totalChunks} chunks completed`);
    }

    async completeTranslation() {
        this.translationState.isRunning = false;
        document.getElementById('pauseBtn').style.display = 'none';
        document.getElementById('resumeBtn').style.display = 'none';
        
        // Save final session state
        await this.saveSession();
        
        // Analyze translation completeness
        const totalChunks = this.translationState.chunks.length;
        const successfulChunks = this.translationState.results.filter(result => 
            result && !result.startsWith('[TRANSLATION FAILED') && !result.startsWith('[UNTRANSLATED') && !result.startsWith('[MISSING TRANSLATION')
        ).length;
        const failedChunks = totalChunks - successfulChunks;
        
        console.log(`Translation complete: ${successfulChunks}/${totalChunks} chunks successful, ${failedChunks} failed`);
        
        // Show completion message
        const preview = document.getElementById('previewContent');
        const completionBanner = document.createElement('div');
        
        if (failedChunks === 0) {
            completionBanner.style.cssText = 'background: var(--success-color); color: white; padding: 1rem; margin-bottom: 1rem; border-radius: var(--radius-md); text-align: center;';
            completionBanner.innerHTML = '<i class="fas fa-check-circle"></i> Translation completed successfully! All content translated.';
        } else {
            completionBanner.style.cssText = 'background: var(--warning-color); color: white; padding: 1rem; margin-bottom: 1rem; border-radius: var(--radius-md);';
            completionBanner.innerHTML = `
                <div style="text-align: center; margin-bottom: 1rem;">
                    <i class="fas fa-exclamation-triangle"></i> Translation completed with issues: ${successfulChunks}/${totalChunks} chunks translated successfully. ${failedChunks} chunks failed.
                </div>
                <div style="text-align: center;">
                    <button class="btn btn-secondary" onclick="window.translationMachine.retryFailedChunks()" style="margin-right: 0.5rem;">
                        <i class="fas fa-redo"></i> Retry Failed Chunks
                    </button>
                    <button class="btn btn-secondary" onclick="window.translationMachine.exportWithWarnings()">
                        <i class="fas fa-download"></i> Export Partial Translation
                    </button>
                </div>
            `;
        }
        
        preview.insertBefore(completionBanner, preview.firstChild);
        
        // Final preview update to remove processing placeholders
        this.updateFinalPreview();
    }

    updateFinalPreview() {
        const preview = document.getElementById('previewContent');
        const translatedText = this.translationState.results.join('\n\n');
        
        // Create final content with completion banner preserved
        const completionBanner = preview.querySelector('div[style*="background: var(--success-color)"], div[style*="background: var(--warning-color)"]');
        
        const finalContent = `<div style="white-space: pre-wrap; line-height: 1.6;">${this.escapeHtml(translatedText)}</div>`;
        
        if (completionBanner) {
            preview.innerHTML = '';
            preview.appendChild(completionBanner);
            preview.innerHTML += finalContent;
        } else {
            preview.innerHTML = finalContent;
        }
        
        console.log('Final preview updated with complete translation');
    }

    async retryFailedChunks() {
        console.log('Retrying failed chunks...');
        
        const failedIndices = [];
        for (let i = 0; i < this.translationState.results.length; i++) {
            const result = this.translationState.results[i];
            if (!result || result.startsWith('[TRANSLATION FAILED') || 
                result.startsWith('[UNTRANSLATED') || result.startsWith('[MISSING TRANSLATION')) {
                failedIndices.push(i);
            }
        }
        
        if (failedIndices.length === 0) {
            alert('No failed chunks to retry');
            return;
        }
        
        console.log(`Retrying ${failedIndices.length} failed chunks:`, failedIndices);
        
        // Re-enable controls
        this.translationState.isRunning = true;
        document.getElementById('pauseBtn').style.display = 'inline-flex';
        document.getElementById('resumeBtn').style.display = 'none';
        
        // Process only failed chunks
        for (const index of failedIndices) {
            if (!this.translationState.isRunning) break;
            
            console.log(`Retrying chunk ${index + 1}`);
            
            try {
                const result = await this.translateChunk(this.translationState.chunks[index]);
                this.translationState.results[index] = result.text;
                this.translationState.tokensUsed += result.tokensUsed;
                this.translationState.costSoFar += result.cost;
                
                console.log(`Chunk ${index + 1} retry successful`);
                this.updateProgress();
                this.updatePreview();
                
            } catch (error) {
                console.error(`Retry failed for chunk ${index + 1}:`, error);
                // Keep the existing failed marker
            }
            
            // Small delay between retries
            await this.sleep(1000);
        }
        
        // Complete translation again
        await this.completeTranslation();
    }

    exportWithWarnings() {
        const successfulChunks = this.translationState.results.filter(result => 
            result && !result.startsWith('[TRANSLATION FAILED') && 
            !result.startsWith('[UNTRANSLATED') && !result.startsWith('[MISSING TRANSLATION')
        ).length;
        const totalChunks = this.translationState.chunks.length;
        
        if (confirm(`Export partial translation? ${successfulChunks}/${totalChunks} chunks were successfully translated. Failed sections will be marked in the export.`)) {
            this.exportTxt();
        }
    }

    async pauseTranslation() {
        this.translationState.isPaused = true;
        document.getElementById('pauseBtn').style.display = 'none';
        document.getElementById('resumeBtn').style.display = 'inline-flex';
        
        // Save paused state
        await this.saveSession();
    }

    resumeTranslation() {
        this.translationState.isPaused = false;
        document.getElementById('pauseBtn').style.display = 'inline-flex';
        document.getElementById('resumeBtn').style.display = 'none';
    }

    async stopTranslation() {
        this.translationState.isRunning = false;
        this.translationState.isPaused = false;
        document.getElementById('pauseBtn').style.display = 'inline-flex';
        document.getElementById('resumeBtn').style.display = 'none';
        
        // Save stopped state
        await this.saveSession();
    }

    async exportTxt() {
        if (!this.translationState.results || this.translationState.results.length === 0) {
            alert('No translation results to export');
            return;
        }

        // Combine all results, including failed ones with markers
        const text = this.translationState.results.join('\n\n');
        
        if (!text) {
            alert('No content to export');
            return;
        }

        const blob = new Blob([text], { type: 'text/plain' });
        this.downloadBlob(blob, this.getExportFilename('txt'));
    }

    async exportDocx() {
        if (!this.translationState.results || this.translationState.results.length === 0) {
            alert('No translation results to export');
            return;
        }

        // Combine all results, including failed ones with markers
        const text = this.translationState.results.join('\n\n');
        
        if (!text) {
            alert('No content to export');
            return;
        }

        try {
            // Create a new document using docx library
            const doc = new docx.Document({
                sections: [{
                    properties: {},
                    children: this.createDocxParagraphs(text)
                }]
            });

            // Generate the document
            const buffer = await docx.Packer.toBuffer(doc);
            const blob = new Blob([buffer], { 
                type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' 
            });
            
            this.downloadBlob(blob, this.getExportFilename('docx'));
        } catch (error) {
            console.error('Error creating DOCX:', error);
            
            // Fallback to RTF format
            const rtfContent = this.createRtfContent(text);
            const blob = new Blob([rtfContent], { type: 'application/rtf' });
            this.downloadBlob(blob, this.getExportFilename('rtf'));
        }
    }

    createDocxParagraphs(text) {
        const paragraphs = text.split(/\n\s*\n/);
        return paragraphs.map(paragraph => {
            return new docx.Paragraph({
                children: [
                    new docx.TextRun({
                        text: paragraph.trim(),
                        font: "Arial",
                        size: 24 // 12pt font (size is in half-points)
                    })
                ],
                spacing: {
                    after: 200 // 10pt spacing after paragraph
                }
            });
        });
    }

    createRtfContent(text) {
        const rtfHeader = '{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Arial;}}';
        const rtfBody = text
            .replace(/\\/g, '\\\\')
            .replace(/\{/g, '\\{')
            .replace(/\}/g, '\\}')
            .replace(/\n\s*\n/g, '\\par\\par ')
            .replace(/\n/g, '\\line ');
        const rtfFooter = '}';
        
        return rtfHeader + '\\f0\\fs24 ' + rtfBody + rtfFooter;
    }

    getExportFilename(extension) {
        const baseName = this.currentFile ? 
            this.currentFile.name.replace(/\.[^/.]+$/, '') : 
            'translation';
        return `${baseName}-english.${extension}`;
    }

    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    openSettings() {
        document.getElementById('apiKey').value = this.apiKey;
        document.getElementById('settingsModal').classList.add('show');
    }

    closeSettings() {
        document.getElementById('settingsModal').classList.remove('show');
    }

    saveSettingsModal() {
        this.apiKey = document.getElementById('apiKey').value.trim();
        this.saveSettings();
        this.closeSettings();
        
        if (this.apiKey) {
            // Update UI to show API key is configured
            document.getElementById('settingsBtn').style.background = 'var(--success-color)';
            document.getElementById('settingsBtn').style.borderColor = 'var(--success-color)';
            document.getElementById('settingsBtn').style.color = 'white';
        }
    }

    toggleApiKeyVisibility() {
        const input = document.getElementById('apiKey');
        const icon = document.querySelector('#toggleApiKey i');
        
        if (input.type === 'password') {
            input.type = 'text';
            icon.className = 'fas fa-eye-slash';
        } else {
            input.type = 'password';
            icon.className = 'fas fa-eye';
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.translationMachine = new TranslationMachine();
});

// Register service worker for offline functionality (optional)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .catch(err => console.log('ServiceWorker registration failed: ', err));
    });
}
