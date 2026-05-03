import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const ROOT_DIR = '/spring-book';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const project = searchParams.get('project');
  const filePath = searchParams.get('path');
  
  if (!project || !filePath) {
    return NextResponse.json({ error: 'Project and path are required' }, { status: 400 });
  }

  const fullPath = path.join(ROOT_DIR, project, filePath);
  try {
    if (!fs.existsSync(fullPath)) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    const content = fs.readFileSync(fullPath, 'utf-8');
    return NextResponse.json({ content });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { project, path: filePath, content } = await request.json();
    if (!project || !filePath || content === undefined) {
      return NextResponse.json({ error: 'Project, path, and content are required' }, { status: 400 });
    }

    const fullPath = path.join(ROOT_DIR, project, filePath);
    fs.writeFileSync(fullPath, content, 'utf-8');
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
