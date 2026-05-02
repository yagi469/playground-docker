import { NextRequest } from 'next/server';

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  const resolvedParams = await params;
  const path = resolvedParams.slug ? resolvedParams.slug.join('/') : '';
  const url = `http://demo:8080/api/${path}${request.nextUrl.search}`;
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
    console.error('API Proxy GET Error:', error);
    return new Response(JSON.stringify({ error: 'Internal Proxy Error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  const resolvedParams = await params;
  const path = resolvedParams.slug ? resolvedParams.slug.join('/') : '';
  const url = `http://demo:8080/api/${path}${request.nextUrl.search}`;
  try {
    const body = await request.text();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 
        'Content-Type': request.headers.get('Content-Type') || 'application/json',
        'Connection': 'close'
      },
      body,
      cache: 'no-store'
    });
    const data = await res.text();
    return new Response(data, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json' },
    });
  } catch (error) {
    console.error('API Proxy POST Error:', error);
    return new Response(JSON.stringify({ error: 'Internal Proxy Error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
