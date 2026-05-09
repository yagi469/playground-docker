import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { Readable } from 'stream';
import Busboy from 'busboy';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { PDFDocument } from 'pdf-lib';

const MAX_PDF_SIZE = 45 * 1024 * 1024; // 45MB safe limit (API limit is 50MB)
const PAGES_PER_CHUNK = 30; // Process 30 pages at a time for large PDFs

/**
 * Split a large PDF into smaller chunks that fit within Gemini's size limit.
 * Returns an array of temporary file paths for each chunk.
 */
async function splitPdf(filePath: string, pageRange?: string): Promise<string[]> {
  const pdfBytes = fs.readFileSync(filePath);
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const totalPages = pdfDoc.getPageCount();

  // Determine which pages to process
  let pagesToProcess: number[] = [];
  if (pageRange) {
    pagesToProcess = parsePageRange(pageRange, totalPages);
  } else {
    pagesToProcess = Array.from({ length: totalPages }, (_, i) => i);
  }

  console.log(`PDF has ${totalPages} pages, processing ${pagesToProcess.length} pages`);

  // If the file is small enough, return it as-is
  if (pdfBytes.length <= MAX_PDF_SIZE && !pageRange) {
    return [filePath];
  }

  // Split into chunks
  const chunks: string[] = [];
  for (let i = 0; i < pagesToProcess.length; i += PAGES_PER_CHUNK) {
    const chunkPages = pagesToProcess.slice(i, i + PAGES_PER_CHUNK);
    const newPdf = await PDFDocument.create();
    const copiedPages = await newPdf.copyPages(pdfDoc, chunkPages);
    copiedPages.forEach(page => newPdf.addPage(page));
    
    const chunkBytes = await newPdf.save();
    const chunkPath = path.join(os.tmpdir(), `pdf-chunk-${Date.now()}-${i}.pdf`);
    fs.writeFileSync(chunkPath, chunkBytes);
    chunks.push(chunkPath);
    
    console.log(`Created chunk ${chunks.length}: pages ${chunkPages[0] + 1}-${chunkPages[chunkPages.length - 1] + 1}, size: ${(chunkBytes.length / 1024 / 1024).toFixed(1)}MB`);
  }

  return chunks;
}

/**
 * Parse a page range string like "1, 3-5, 10" into zero-indexed page numbers.
 */
function parsePageRange(range: string, totalPages: number): number[] {
  const pages: Set<number> = new Set();
  const parts = range.split(',').map(s => s.trim());
  
  for (const part of parts) {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(s => parseInt(s.trim()));
      for (let i = Math.max(1, start); i <= Math.min(totalPages, end); i++) {
        pages.add(i - 1); // Convert to zero-indexed
      }
    } else {
      const num = parseInt(part);
      if (num >= 1 && num <= totalPages) {
        pages.add(num - 1); // Convert to zero-indexed
      }
    }
  }
  
  return Array.from(pages).sort((a, b) => a - b);
}

export async function POST(req: NextRequest) {
  let tempFilePath: string | null = null;
  const chunkPaths: string[] = [];
  
  try {
    const contentType = req.headers.get('content-type') || '';
    let image: string | undefined;
    let translate = false;
    let mimeType = 'image/png';
    let pageRange: string | undefined;
    let previousContext: string | undefined;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY is not configured' }, { status: 500 });
    }

    if (contentType.includes('multipart/form-data')) {
      // Handle multipart/form-data for large files
      const busboy = Busboy({ headers: { 'content-type': contentType } });
      const fields: Record<string, string> = {};
      
      const uploadPromise = new Promise<{ tempPath: string | null }>((resolve, reject) => {
        let currentTempPath: string | null = null;
        
        busboy.on('file', (name, file, info) => {
          const { filename, mimeType: fileMimeType } = info;
          mimeType = fileMimeType;
          currentTempPath = path.join(os.tmpdir(), `upload-${Date.now()}-${filename}`);
          const writeStream = fs.createWriteStream(currentTempPath);
          file.pipe(writeStream);
          writeStream.on('finish', () => {});
          writeStream.on('error', reject);
        });

        busboy.on('field', (name, val) => {
          fields[name] = val;
        });

        busboy.on('finish', () => {
          resolve({ tempPath: currentTempPath });
        });

        busboy.on('error', reject);
      });

      // Convert Web Request body to Node.js Readable stream for busboy
      if (!req.body) {
        throw new Error('No request body');
      }
      const nodeStream = Readable.fromWeb(req.body as any);
      nodeStream.pipe(busboy);

      const result = await uploadPromise;
      tempFilePath = result.tempPath;
      translate = fields.translate === 'true';
      mimeType = fields.mimeType || mimeType;
      pageRange = fields.pageRange;
      previousContext = fields.previousContext;
    } else {
      // Handle JSON for existing small captures
      const data = await req.json();
      image = data.image;
      translate = data.translate;
      mimeType = data.mimeType || 'image/png';
      pageRange = data.pageRange;
      previousContext = data.previousContext;
      
      if (!image) {
        return NextResponse.json({ error: 'No content provided' }, { status: 400 });
      }
    }

    console.log('Vision API Request: translate =', translate, 'mimeType =', mimeType, 'method =', tempFilePath ? 'FileAPI' : 'InlineData');

    const ai = new GoogleGenAI({ apiKey });

    // Prepare prompt
    let rangeInstruction = '';
    if (pageRange && mimeType === 'application/pdf') {
      rangeInstruction = `\n以下のページのみを処理してください: ${pageRange}。それ以外のページは無視してください。`;
    }

    let contextInstruction = '';
    if (previousContext) {
      contextInstruction = `\n\n【前ページのコンテキスト】:\n"""\n${previousContext}\n"""\n上記のコンテキストを使用して連続性を確保してください。前のページが不完全な文で終わっている場合は、このページの出力の冒頭で自然に完成させてください。すでにコンテキスト内で処理された内容を繰り返さないようにし、シームレスな繋がりを確保してください。`;
    }

    let prompt = `このドキュメントの内容を構造化されたMarkdownに変換してください。元の言語を維持し、画像が日本語の場合は必ず日本語で出力してください。${rangeInstruction}${contextInstruction}
    1. テキスト、見出し、リストを正確に抽出することに注力してください。
    2. Markdownの出力のみを提供してください。英語などの他の言語を無断で混ぜないでください。`;

    if (mimeType === 'image/png') {
       prompt += `\n重要: これは複数ページのドキュメントキャプチャの一部です。
       この画像の上部または下部に、前後のページと重複する可能性のあるテキストがある場合は、重複部分を除外してください。`;
    }

    if (translate) {
      prompt = `このドキュメントの内容を構造化されたMarkdownに変換し、日本語に翻訳してください。${rangeInstruction}${contextInstruction}
      1. テキスト、見出し、リストを正確に抽出することに注力してください。
      2. すべてを自然で高品質な日本語に翻訳してください。
      3. 日本語のMarkdown出力のみを提供してください。
      4. 出力が完全に日本語であることを確実にしてください。
      5. PDFの場合は、翻訳においてもドキュメントの構造（見出し、表など）を維持してください。`;
    }

    // Handle PDF files - potentially split if too large
    if (tempFilePath && mimeType === 'application/pdf') {
      const fileSize = fs.statSync(tempFilePath).size;
      console.log(`PDF file size: ${(fileSize / 1024 / 1024).toFixed(1)}MB`);

      // Split PDF into processable chunks
      const chunks = await splitPdf(tempFilePath, pageRange || undefined);
      chunkPaths.push(...chunks.filter(p => p !== tempFilePath));

      const allResults: string[] = [];

      for (let i = 0; i < chunks.length; i++) {
        const chunkPath = chunks[i];
        const chunkBuffer = fs.readFileSync(chunkPath);
        
        console.log(`Processing chunk ${i + 1}/${chunks.length}, size: ${(chunkBuffer.length / 1024 / 1024).toFixed(1)}MB`);

        // Upload chunk to Gemini File API
        const uploadResponse = await ai.files.upload({
          file: new Blob([chunkBuffer], { type: 'application/pdf' }),
          config: {
            mimeType: 'application/pdf',
            displayName: `chunk-${i + 1}-of-${chunks.length}`,
          },
        });

        console.log('Chunk uploaded:', uploadResponse.name, 'state:', uploadResponse.state);

        // Wait for processing
        let fileStatus = uploadResponse;
        while (fileStatus.state === 'PROCESSING') {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          fileStatus = await ai.files.get({ name: fileStatus.name! });
        }

        if (fileStatus.state === 'FAILED') {
          throw new Error(`Gemini File processing failed for chunk ${i + 1}`);
        }

        // Build chunk-specific prompt
        let chunkPrompt = prompt;
        // Always remove the page range instruction since splitPdf already extracted the requested pages.
        // The extracted PDF has pages renumbered from 1, so the original range would confuse the model.
        if (rangeInstruction) {
          chunkPrompt = chunkPrompt.replace(rangeInstruction, '');
        }
        if (chunks.length > 1) {
          chunkPrompt += `\nこれはドキュメントのパート ${i + 1}/${chunks.length} です。`;
          
          if (i > 0 && allResults.length > 0) {
            const prevContext = allResults[allResults.length - 1].slice(-500);
            chunkPrompt += `\n\n【前パートの末尾】:\n"""\n${prevContext}\n"""\n前のパートと自然に繋がるように出力してください。重複する内容は避けてください。`;
          }
        }

        const chunkContents: Array<{ text: string } | { fileData: { mimeType: string; fileUri: string } }> = [
          {
            fileData: {
              mimeType: fileStatus.mimeType!,
              fileUri: fileStatus.uri!,
            },
          },
          { text: chunkPrompt },
        ];

        const result = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: chunkContents,
        });

        allResults.push(result.text ?? '');
        console.log(`Chunk ${i + 1} completed, result length: ${allResults[allResults.length - 1].length}`);
      }

      const combinedText = allResults.join('\n\n---\n\n');
      return NextResponse.json({ markdown: combinedText });
    }

    // Handle non-PDF files (images) or small files
    const contents: Array<{ text: string } | { inlineData: { mimeType: string; data: string } } | { fileData: { mimeType: string; fileUri: string } }> = [];

    if (tempFilePath) {
      // Non-PDF large file
      const fileBuffer = fs.readFileSync(tempFilePath);
      const uploadResponse = await ai.files.upload({
        file: new Blob([fileBuffer], { type: mimeType }),
        config: {
          mimeType: mimeType,
          displayName: path.basename(tempFilePath),
        },
      });

      let fileStatus = uploadResponse;
      while (fileStatus.state === 'PROCESSING') {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        fileStatus = await ai.files.get({ name: fileStatus.name! });
      }

      if (fileStatus.state === 'FAILED') {
        throw new Error('Gemini File processing failed');
      }

      contents.push({
        fileData: {
          mimeType: fileStatus.mimeType!,
          fileUri: fileStatus.uri!,
        },
      });
    } else if (image) {
      // Use Inline Data for small images
      const base64Data = image.split(',')[1] || image;
      contents.push({
        inlineData: {
          mimeType: mimeType,
          data: base64Data,
        },
      });
    }

    // Add the text prompt
    contents.push({ text: prompt });

    console.log('Sending to Gemini model: gemini-2.5-flash, parts count:', contents.length);

    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: contents,
    });

    const text = result.text ?? '';

    return NextResponse.json({ markdown: text });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    console.error('Vision API Error:', error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  } finally {
    // Cleanup temporary files
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (err) {
        console.error('Failed to cleanup temp file:', err);
      }
    }
    // Cleanup chunk files
    for (const chunkPath of chunkPaths) {
      if (fs.existsSync(chunkPath)) {
        try {
          fs.unlinkSync(chunkPath);
        } catch (err) {
          console.error('Failed to cleanup chunk file:', err);
        }
      }
    }
  }
}
