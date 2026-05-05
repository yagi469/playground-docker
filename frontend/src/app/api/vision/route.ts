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
      rangeInstruction = `\nONLY process the following pages: ${pageRange}. Ignore all other pages.`;
    }

    let contextInstruction = '';
    if (previousContext) {
      contextInstruction = `\n\nCONTEXT FROM PREVIOUS PAGE:\n"""\n${previousContext}\n"""\nUse the context above to ensure continuity. If the previous page ended with an incomplete sentence, please complete it naturally at the beginning of this page's output. Avoid repeating content that was already translated in the context. Ensure the transition is seamless.`;
    }

    let prompt = `Please convert the content of this document into structured Markdown. ${rangeInstruction}${contextInstruction}
    1. Focus on extracting text, headings, and lists accurately.
    2. Provide ONLY the Markdown output.`;

    if (mimeType === 'image/png') {
       prompt += `\nIMPORTANT: This is part of a multi-page document capture. 
       If there is text at the top or bottom of this image that likely overlaps with the previous or next pages (i.e., repeated sentences), please OMIT the redundant parts so the final combined document flows naturally without duplication.`;
    }

    if (translate) {
      prompt = `Please convert the content of this document into structured Markdown and TRANSLATE it into Japanese. ${rangeInstruction}${contextInstruction}
      1. Focus on extracting text, headings, and lists accurately.
      2. Translate EVERYTHING into natural, high-quality Japanese.
      3. Provide ONLY the Japanese Markdown output. Do NOT include any English text unless it's a technical term that should remain in English.
      4. Ensure the output is exclusively in Japanese (日本語).
      5. If this is a PDF, preserve the document structure (headings, tables, etc.) in the translation.`;
      
      if (mimeType === 'image/png') {
        prompt += `\nIMPORTANT: This is part of a multi-page document capture. 
        If there is text at the top or bottom of this image that likely overlaps with the previous or next pages (i.e., repeated sentences), please OMIT the redundant parts so the final combined document flows naturally without duplication.
        6. If a sentence was cut off at the end of the previous page, complete it here based on the new image content.`;
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
