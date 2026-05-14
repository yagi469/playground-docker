import { NextRequest } from 'next/server';

const PYTHON_BACKEND = 'http://python-env:8000';

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const resolvedParams = await params;
  const path = resolvedParams.path ? resolvedParams.path.join('/') : '';
  const url = `${PYTHON_BACKEND}/wooldridge/${path}${request.nextUrl.search}`;
  try {
    const res = await fetch(url, {
      headers: { 'Connection': 'close' },
      cache: 'no-store'
    });
    const data = await res.text();
    return new Response(data, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json' },
    });
  } catch (error) {
    console.error('Wooldridge API Proxy Error:', error);
    return new Response(JSON.stringify({ error: 'Failed to connect to Python backend' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
