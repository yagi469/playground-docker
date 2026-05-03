import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

function getFileTree(dir: string, baseDir: string): FileNode[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter(entry => !entry.name.startsWith('.') && entry.name !== 'target')
    .map(entry => {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);
      return {
        name: entry.name,
        path: relativePath,
        isDirectory: entry.isDirectory(),
        children: entry.isDirectory() ? getFileTree(fullPath, baseDir) : undefined,
      };
    })
    .sort((a, b) => {
      if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
      return a.isDirectory ? -1 : 1;
    });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const project = searchParams.get('project');
  if (!project) return NextResponse.json({ error: 'Project name is required' }, { status: 400 });

  const rootDir = '/spring-book';
  const projectPath = path.join(rootDir, project);

  try {
    if (!fs.existsSync(projectPath)) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    const tree = getFileTree(projectPath, projectPath);
    return NextResponse.json(tree);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
