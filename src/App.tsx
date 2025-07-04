import { useState } from 'react';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import axios from 'axios';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.js`;

interface TextItem {
  str: string;
  x: number;
  y: number;
  fontHeight: number;
  page: number;
}

async function extractText(file: File): Promise<TextItem[]> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const items: TextItem[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    content.items.forEach((token: any) => {
      const transform = token.transform;
      const fontHeight = Math.hypot(transform[2], transform[3]);
      const x = transform[4];
      const y = viewport.height - transform[5];
      items.push({
        str: token.str,
        x,
        y,
        fontHeight,
        page: i - 1,
      });
    });
  }

  return items;
}

async function translateChunks(texts: string[], targetLang: string): Promise<string[]> {
  const chunkSize = 1000;
  const translated: string[] = [];

  for (let i = 0; i < texts.length; i += chunkSize) {
    const chunk = texts.slice(i, i + chunkSize).join('\n');
    const response = await axios.post(
      'https://api-free.deepl.com/v2/translate',
      new URLSearchParams({
        auth_key: 'YOUR_DEEPL_API_KEY',
        text: chunk,
        target_lang: targetLang,
      }),
    );
    const results = response.data.translations.map((t: any) => t.text);
    translated.push(...results);
  }

  return translated;
}

async function rebuildPDF(file: File, items: TextItem[], translations: string[]): Promise<Uint8Array> {
  const existingPdfBytes = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(existingPdfBytes);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

  items.forEach((item, idx) => {
    const page = pdfDoc.getPage(item.page);
    page.drawRectangle({
      x: item.x,
      y: item.y - item.fontHeight,
      width: helvetica.widthOfTextAtSize(item.str, item.fontHeight),
      height: item.fontHeight,
      color: rgb(1, 1, 1),
    });
    page.drawText(translations[idx] || '', {
      x: item.x,
      y: item.y - item.fontHeight,
      size: item.fontHeight,
      font: helvetica,
      color: rgb(0, 0, 0),
    });
  });

  return pdfDoc.save();
}

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [output, setOutput] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files ? e.target.files[0] : null);
    setProgress(0);
    setOutput(null);
    setError(null);
  };

  const handleTranslate = async () => {
    if (!file) return;
    try {
      setProgress(0.1);
      const items = await extractText(file);
      setProgress(0.4);

      const texts = items.map(i => i.str);
      const translations = await translateChunks(texts, 'JA');
      setProgress(0.7);

      const bytes = await rebuildPDF(file, items, translations);
      setProgress(1);
      setOutput(bytes);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleDownload = () => {
    if (!output) return;
    const blob = new Blob([output], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'translated.pdf';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container">
      <h1>PDF Translator</h1>
      <input type="file" accept="application/pdf" onChange={handleFileChange} />
      <button onClick={handleTranslate} disabled={!file}>Translate</button>
      {progress > 0 && (
        <div className="progress-bar" style={{ width: '100%' }}>
          <div style={{ width: `${progress * 100}%` }} />
        </div>
      )}
      {output && <button onClick={handleDownload}>Download PDF</button>}
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}

export default App;
