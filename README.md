# Translation Machine

A modern, responsive translation application that runs entirely in your browser. Translate documents from any language to English using OpenAI's GPT models with OCR support for scanned PDFs.

## 🚀 Features

- **Multiple File Formats**: Support for TXT, PDF, and EPUB files
- **Cost Estimation**: Real-time token counting and cost estimation before translation
- **Multiple AI Models**: Choose from cost-effective OpenAI models (GPT-4o Mini, GPT-4o, GPT-4 Turbo)
- **Custom System Prompts**: Built-in presets (Formal, Conversational, Academic, Creative, Technical) or write your own
- **Chunked Translation**: Handles large documents by breaking them into manageable chunks
- **Live Progress**: Real-time progress tracking with token usage and cost monitoring
- **Streaming Preview**: Watch translations appear in real-time
- **Export Options**: Download results as TXT or DOCX files
- **Responsive Design**: Works seamlessly on mobile and desktop
- **Offline Ready**: Cached for offline use after first visit
- **Privacy First**: Your API key is stored locally, never sent to our servers

## 🛠️ Setup

### For GitHub Pages Deployment

1. Fork or download this repository
2. Enable GitHub Pages in your repository settings
3. Your app will be available at `https://yourusername.github.io/repository-name`

### For Local Development

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd translation-machine
   ```

2. Serve the files using any local server (Python, Node.js, etc.):
   ```bash
   # Python 3
   python -m http.server 8000
   
   # Node.js (with http-server)
   npx http-server
   ```

3. Open `http://localhost:8000` in your browser

## 📖 Usage

### Getting Started

1. **Configure API Key**: Click the Settings button and enter your OpenAI API key
2. **Upload File**: Drag and drop or select a TXT, PDF, or EPUB file
3. **Choose Settings**: Select your target language, AI model, and translation style
4. **Review Cost**: Check the estimated tokens and cost before starting
5. **Translate**: Click "Start Translation" to begin
6. **Monitor Progress**: Watch real-time progress and preview the translation
7. **Export**: Download your translated document as TXT or DOCX

### AI Models Available

- **GPT-4o Mini**: Most cost-effective option ($0.150 per 1M input tokens)
- **GPT-4o**: Balanced performance and cost ($2.50 per 1M input tokens)  
- **GPT-4 Turbo**: Highest quality ($10.00 per 1M input tokens)

### Translation Styles

- **Formal**: Professional, business-appropriate tone
- **Conversational**: Natural, friendly tone
- **Academic**: Scholarly tone with precise terminology
- **Creative**: Adaptive translation with cultural context
- **Technical**: Maintains technical accuracy and terminology
- **Custom**: Write your own system prompt

### Chunking

Large documents are automatically split into chunks to:
- Avoid API token limits
- Provide better error recovery
- Enable progress tracking
- Allow pause/resume functionality

## 🔒 Privacy & Security

- **Local Storage**: Your API key is stored only in your browser's local storage
- **No Server**: Everything runs client-side, no data sent to our servers
- **Direct API**: Translations go directly from your browser to OpenAI
- **Open Source**: Full transparency - inspect the code yourself

## 🌐 Browser Compatibility

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers supported

## 🛠️ Technical Details

### File Processing
- **TXT**: Direct text reading
- **PDF**: Text extraction (currently basic implementation)
- **EPUB**: Text extraction from EPUB structure

### Token Estimation
Uses a rough approximation of 1 token ≈ 4 characters for cost estimation. Actual usage may vary slightly.

### Error Handling
- Automatic retry for rate limits
- Graceful handling of API errors
- Progress preservation for interrupted translations

## 🤝 Contributing

This is a static web application perfect for GitHub Pages. To contribute:

1. Fork the repository
2. Make your changes
3. Test locally
4. Submit a pull request

## 📄 License

MIT License - feel free to use this project for personal or commercial purposes.

## ⚠️ Disclaimer

This tool requires an OpenAI API key and will incur costs based on your usage. Always review cost estimates before starting large translations. The cost estimates are approximations - actual costs may vary.
