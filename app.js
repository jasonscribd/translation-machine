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
            formal: 'Translate the following text to {language} using a formal, professional tone. Maintain the original structure and formatting.',
            conversational: 'Translate the following text to {language} using a natural, conversational tone that sounds friendly and approachable.',
            academic: 'Translate the following text to {language} using an academic, scholarly tone with precise terminology and formal structure.',
            creative: 'Translate the following text to {language} with creative flair, adapting idioms and expressions to feel natural in the target language.',
            technical: 'Translate the following text to {language} maintaining technical accuracy and specialized terminology.'
        };

        this.db = null;
        this.init();
    }

    async init() {
        await this.initDatabase();
        this.loadSettings();
        this.setupEventListeners();
        this.setupDragAndDrop();
        this.updateSystemPrompt();
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

    async checkForSavedSessions() {
        if (!this.db) return;

        try {
            const transaction = this.db.transaction(['sessions'], 'readonly');
            const store = transaction.objectStore('sessions');
            const request = store.getAll();
            
            request.onsuccess = (event) => {
                const sessions = event.target.result;
                if (sessions.length > 0) {
                    this.showResumeDialog(sessions);
                }
            };
        } catch (error) {
            console.warn('Failed to check for saved sessions:', error);
        }
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
            document.getElementById('targetLang').value = session.config.targetLang || 'spanish';
            document.getElementById('styleSelect').value = session.config.style || 'formal';
            document.getElementById('systemPrompt').value = session.config.systemPrompt || '';
            this.handleLanguageChange();
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

    loadSettings() {
        const saved = localStorage.getItem('translation-machine-settings');
        if (saved) {
            const settings = JSON.parse(saved);
            this.apiKey = settings.apiKey || '';
            document.getElementById('chunkSize').value = settings.chunkSize || '2000';
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

        // File upload
        document.getElementById('fileInput').addEventListener('change', this.handleFileSelect.bind(this));
        document.getElementById('removeFile').addEventListener('click', this.removeFile.bind(this));

        // Configuration
        document.getElementById('modelSelect').addEventListener('change', this.updateCostEstimate.bind(this));
        document.getElementById('targetLang').addEventListener('change', this.handleLanguageChange.bind(this));
        document.getElementById('styleSelect').addEventListener('change', this.updateSystemPrompt.bind(this));
        document.getElementById('systemPrompt').addEventListener('input', this.debounce(this.updateCostEstimate.bind(this), 500));

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
            alert('Error reading file. Please try again.');
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
            const reader = new FileReader();
            reader.onload = async function(e) {
                try {
                    const typedarray = new Uint8Array(e.target.result);
                    
                    // Configure PDF.js worker
                    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                    
                    const pdf = await pdfjsLib.getDocument(typedarray).promise;
                    let fullText = '';
                    
                    // Extract text from each page
                    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                        const page = await pdf.getPage(pageNum);
                        const textContent = await page.getTextContent();
                        const pageText = textContent.items.map(item => item.str).join(' ');
                        fullText += pageText + '\n\n';
                    }
                    
                    if (!fullText.trim()) {
                        reject(new Error('No text found in PDF. The PDF may contain only images or be password protected.'));
                    } else {
                        resolve(fullText.trim());
                    }
                } catch (error) {
                    reject(new Error(`Error parsing PDF: ${error.message}`));
                }
            };
            reader.readAsArrayBuffer(file);
        });
    }

    async extractEpubText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async function(e) {
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
    }

    removeFile() {
        this.currentFile = null;
        this.currentText = '';
        document.getElementById('fileInfo').style.display = 'none';
        document.getElementById('uploadArea').style.display = 'block';
        document.getElementById('configSection').style.display = 'none';
        document.getElementById('fileInput').value = '';
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

    handleLanguageChange() {
        const select = document.getElementById('targetLang');
        const customInput = document.getElementById('customLang');
        
        if (select.value === 'custom') {
            customInput.style.display = 'block';
            customInput.focus();
        } else {
            customInput.style.display = 'none';
        }
        
        this.updateSystemPrompt();
    }

    updateSystemPrompt() {
        const styleSelect = document.getElementById('styleSelect');
        const targetLang = this.getTargetLanguage();
        const promptTextarea = document.getElementById('systemPrompt');
        
        if (styleSelect.value !== 'custom' && targetLang) {
            const template = this.stylePresets[styleSelect.value];
            promptTextarea.value = template.replace('{language}', targetLang);
        }
    }

    getTargetLanguage() {
        const select = document.getElementById('targetLang');
        if (select.value === 'custom') {
            return document.getElementById('customLang').value.trim();
        }
        return select.options[select.selectedIndex].text;
    }

    // Rough token estimation (approximate)
    estimateTokens(text) {
        // Very rough approximation: 1 token ≈ 0.75 words ≈ 4 characters
        return Math.ceil(text.length / 4);
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
            targetLang: document.getElementById('targetLang').value,
            customLang: document.getElementById('customLang').value,
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

        const targetLang = this.getTargetLanguage();
        if (!targetLang) {
            alert('Please select or enter a target language');
            return false;
        }

        return true;
    }

    setupChunks() {
        const chunkSize = parseInt(document.getElementById('chunkSize').value);
        const systemPrompt = document.getElementById('systemPrompt').value;
        
        this.translationState.chunks = this.chunkText(this.currentText, chunkSize - this.estimateTokens(systemPrompt));
        
        document.getElementById('chunksProgress').textContent = `0 / ${this.translationState.chunks.length}`;
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
            } else {
                currentChunk = testChunk;
            }
        }
        
        if (currentChunk) {
            chunks.push(currentChunk.trim());
        }
        
        return chunks;
    }

    showTranslationSection() {
        document.getElementById('translationSection').style.display = 'block';
        document.getElementById('translationSection').classList.add('fade-in');
        document.getElementById('previewContent').innerHTML = '<div class="preview-placeholder">Starting translation...</div>';
    }

    async processChunks() {
        for (let i = this.translationState.currentChunk; i < this.translationState.chunks.length; i++) {
            if (!this.translationState.isRunning) break;
            
            while (this.translationState.isPaused) {
                await this.sleep(100);
            }
            
            try {
                const result = await this.translateChunk(this.translationState.chunks[i]);
                this.translationState.results[i] = result.text;
                this.translationState.tokensUsed += result.tokensUsed;
                this.translationState.costSoFar += result.cost;
                this.translationState.currentChunk = i + 1;
                
                this.updateProgress();
                this.updatePreview();
                
                // Save progress every few chunks
                if ((i + 1) % 3 === 0) {
                    await this.saveSession();
                }
                
            } catch (error) {
                console.error('Translation error:', error);
                // Handle rate limiting or other errors
                if (error.message.includes('rate limit')) {
                    await this.sleep(2000);
                    i--; // Retry the same chunk
                } else {
                    alert('Translation error: ' + error.message);
                    break;
                }
            }
        }
        
        if (this.translationState.currentChunk >= this.translationState.chunks.length) {
            await this.completeTranslation();
        }
    }

    async translateChunk(text) {
        const model = document.getElementById('modelSelect').value;
        const systemPrompt = document.getElementById('systemPrompt').value;
        
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: text }
                ],
                temperature: 0.3,
                max_tokens: Math.ceil(this.estimateTokens(text) * 1.5)
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'API request failed');
        }

        const data = await response.json();
        const usage = data.usage;
        const pricing = this.modelPricing[model];
        
        const cost = (usage.prompt_tokens / 1000) * pricing.input + 
                    (usage.completion_tokens / 1000) * pricing.output;
        
        return {
            text: data.choices[0].message.content,
            tokensUsed: usage.total_tokens,
            cost: cost
        };
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
        const translatedText = this.translationState.results
            .filter(result => result)
            .join('\n\n');
        
        if (translatedText) {
            preview.innerHTML = `<div style="white-space: pre-wrap; line-height: 1.6;">${this.escapeHtml(translatedText)}</div>`;
            preview.scrollTop = preview.scrollHeight;
        }
    }

    async completeTranslation() {
        this.translationState.isRunning = false;
        document.getElementById('pauseBtn').style.display = 'none';
        document.getElementById('resumeBtn').style.display = 'none';
        
        // Save final session state
        await this.saveSession();
        
        // Show success message
        const preview = document.getElementById('previewContent');
        const successBanner = document.createElement('div');
        successBanner.style.cssText = 'background: var(--success-color); color: white; padding: 1rem; margin-bottom: 1rem; border-radius: var(--radius-md); text-align: center;';
        successBanner.innerHTML = '<i class="fas fa-check-circle"></i> Translation completed successfully!';
        preview.insertBefore(successBanner, preview.firstChild);
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
        const text = this.translationState.results
            .filter(result => result)
            .join('\n\n');
        
        if (!text) {
            alert('No translated text to export');
            return;
        }

        const blob = new Blob([text], { type: 'text/plain' });
        this.downloadBlob(blob, this.getExportFilename('txt'));
    }

    async exportDocx() {
        const text = this.translationState.results
            .filter(result => result)
            .join('\n\n');
        
        if (!text) {
            alert('No translated text to export');
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
        const targetLang = this.getTargetLanguage().toLowerCase().replace(/\s+/g, '-');
        return `${baseName}-${targetLang}.${extension}`;
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
