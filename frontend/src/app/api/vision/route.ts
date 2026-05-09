import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import { Readable } from 'stream';
import Busboy from 'busboy';
import fs from 'fs';
import path from 'path';
import os from 'os';

export async function POST(req: NextRequest) {
  let tempFilePath: string | null = null;
  let fileUri: string | null = null;
  
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

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

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

    const contentParts: (string | { inlineData: { data: string; mimeType: string } } | { fileData: { fileUri: string; mimeType: string } })[] = [prompt];

    if (tempFilePath) {
      // Use File API for large files
      const fileManager = new GoogleAIFileManager(apiKey);
      const uploadResponse = await fileManager.uploadFile(tempFilePath, {
        mimeType: mimeType,
        displayName: path.basename(tempFilePath),
      });
      fileUri = uploadResponse.file.uri;
      
      // Wait for the file to be processed (active state)
      let file = await fileManager.getFile(uploadResponse.file.name);
      while (file.state === 'PROCESSING') {
        process.stdout.write('.');
        await new Promise((resolve) => setTimeout(resolve, 2000));
        file = await fileManager.getFile(uploadResponse.file.name);
      }

      if (file.state === 'FAILED') {
        throw new Error('Gemini File processing failed');
      }

      contentParts.push({
        fileData: {
          fileUri: fileUri,
          mimeType: mimeType,
        },
      });
    } else if (image) {
      // Use Inline Data for small images
      const base64Data = image.split(',')[1] || image;
      contentParts.push({
        inlineData: {
          data: base64Data,
          mimeType: mimeType,
        },
      });
    }

    const result = await model.generateContent(contentParts as any);
    const response = await result.response;
    const text = response.text();

    return NextResponse.json({ markdown: text });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    console.error('Vision API Error:', error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  } finally {
    // Cleanup temporary file
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (err) {
        console.error('Failed to cleanup temp file:', err);
      }
    }
    // We don't delete from Gemini File API here as they expire automatically after 48h,
    // and manual deletion might be redundant for this use case.
  }
}

