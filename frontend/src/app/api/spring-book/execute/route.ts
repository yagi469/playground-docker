import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import path from 'path';

const ROOT_DIR = '/spring-book';

export async function POST(request: Request) {
  try {
    const { project, command } = await request.json();
    if (!project || !command) {
      return NextResponse.json({ error: 'Project and command are required' }, { status: 400 });
    }

    const projectPath = path.join(ROOT_DIR, project);

    return new Promise((resolve) => {
      // Set an environment variable to handle non-interactive mode if necessary
      // For example, MAVEN_OPTS or similar.
      exec(command, { cwd: projectPath }, (error, stdout, stderr) => {
        resolve(NextResponse.json({
          stdout,
          stderr,
          exitCode: error ? error.code : 0,
          error: error ? error.message : null,
        }));
      });
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
