import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST(req: NextRequest) {
  try {
    const { image, translate, mimeType = 'image/png', pageRange, previousContext } = await req.json(); // image is base64 string
    if (!image) {
      return NextResponse.json({ error: 'No content provided' }, { status: 400 });
    }

    console.log('Vision API Request: translate =', translate, 'mimeType =', mimeType);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY is not configured' }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // Remove the data:...;base64, prefix if it exists
    const base64Data = image.split(',')[1] || image;

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
       この画像の上部または下部に、前後のページと重複する可能性のあるテキスト（繰り返されている文など）がある場合は、最終的に結合されたドキュメントが重複なく自然に繋がるように、重複部分を除外してください。`;
    }

    if (translate) {
      prompt = `このドキュメントの内容を構造化されたMarkdownに変換し、日本語に翻訳してください。${rangeInstruction}${contextInstruction}
      1. テキスト、見出し、リストを正確に抽出することに注力してください。
      2. すべてを自然で高品質な日本語に翻訳してください。
      3. 日本語のMarkdown出力のみを提供してください。英語のままにするべき専門用語を除き、英語のテキストを含めないでください。
      4. 出力が完全に日本語であることを確実にしてください。
      5. PDFの場合は、翻訳においてもドキュメントの構造（見出し、表など）を維持してください。`;
      
      if (mimeType === 'image/png') {
        prompt += `\n重要: これは複数ページのドキュメントキャプチャの一部です。
        画像の上部または下部に、前後のページと重複する可能性のあるテキストがある場合は、重複部分を除外して自然に繋がるようにしてください。
        6. 前のページの最後で文が途切れていた場合は、新しい画像の内容に基づいてここで完成させてください。`;
      }
    }

    console.log('Sending prompt to Gemini:', prompt);

    const result = await model.generateContent([
      {
        inlineData: {
          data: base64Data,
          mimeType: mimeType,
        },
      },
      prompt,
    ]);

    const response = await result.response;
    if (!response) {
      throw new Error('No response received from Gemini API');
    }
    const text = response.text();

    return NextResponse.json({ markdown: text });
  } catch (error: any) {
    console.error('Vision API Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
