import { NextResponse } from 'next/server';
import fs from 'fs';

export async function GET() {
  const rootDir = '/spring-book';
  try {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    const projects = entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => entry.name)
      .sort();
    return NextResponse.json(projects);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
