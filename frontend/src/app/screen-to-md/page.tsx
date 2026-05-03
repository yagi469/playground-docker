'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import styles from './screen.module.css';

interface CaptureResult {
  id: string;
  image: string;
  markdown: string;
  status: 'loading' | 'done' | 'error';
  error?: string;
}

type AutoMode = 'off' | 'timer' | 'smart';

export default function ScreenToMarkdown() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [captures, setCaptures] = useState<CaptureResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [autoMode, setAutoMode] = useState<AutoMode>('off');
  const [countdown, setCountdown] = useState(5);
  const [smartStatus, setSmartStatus] = useState<'Watching...' | 'Motion detected...' | 'Settling...' | 'Capturing!'>('Watching...');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [isTranslate, setIsTranslate] = useState(false);
  const [pdfPageRange, setPdfPageRange] = useState('');
  
  // Drag and Drop state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const autoCaptureRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  
  // Smart Capture Refs
  const lastImageDataRef = useRef<Uint8ClampedArray | null>(null);
  const settleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isTransitioningRef = useRef(false);
  const monitoringLoopRef = useRef<number | null>(null);
  const processingCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const startCapture = async () => {
    try {
      setError(null);
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        throw new Error("Screen capture is not supported in this environment. Please ensure you are using HTTPS and a compatible browser.");
      }
      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" } as any,
        audio: false
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
      
      mediaStream.getVideoTracks()[0].onended = () => {
        setStream(null);
        setAutoMode('off');
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Capture Error:", err);
      setError("Failed to start screen capture: " + message);
    }
  };

  const stopCapture = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
      setAutoMode('off');
    }
  };

  const captureAndAppend = useCallback(async () => {
    if (!videoRef.current) return;

    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const base64Image = canvas.toDataURL('image/png');
    
    const newId = Math.random().toString(36).substr(2, 9);
    const newCapture: CaptureResult = {
      id: newId,
      image: base64Image,
      markdown: '',
      status: 'loading'
    };

    setCaptures(prev => [...prev, newCapture]);

    try {
      const res = await fetch('/api/vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Image, translate: isTranslate }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Conversion failed');

      setCaptures(prev => prev.map(c => 
        c.id === newId ? { ...c, markdown: data.markdown, status: 'done' } : c
      ));
    } catch (err: any) {
      console.error("Conversion Error:", err);
      setCaptures(prev => prev.map(c => 
        c.id === newId ? { ...c, status: 'error', error: err.message } : c
      ));
    }
  }, [isTranslate]);

  // Helper: Calculate pixel difference between two frames
  const calculateDiff = (data1: Uint8ClampedArray, data2: Uint8ClampedArray) => {
    let diff = 0;
    for (let i = 0; i < data1.length; i += 4) {
      const r = Math.abs(data1[i] - data2[i]);
      const g = Math.abs(data1[i+1] - data2[i+1]);
      const b = Math.abs(data1[i+2] - data2[i+2]);
      if (r + g + b > 60) diff++;
    }
    return diff / (data1.length / 4);
  };

  // Timer Auto-Capture Effect
  useEffect(() => {
    if (autoMode === 'timer' && stream) {
      setCountdown(5);
      autoCaptureRef.current = setInterval(() => {
        captureAndAppend();
        setCountdown(5);
      }, 5000);

      countdownRef.current = setInterval(() => {
        setCountdown(prev => (prev > 1 ? prev - 1 : 5));
      }, 1000);
    } else {
      if (autoCaptureRef.current) clearInterval(autoCaptureRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    }
    return () => {
      if (autoCaptureRef.current) clearInterval(autoCaptureRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [autoMode, stream, captureAndAppend]);

  // Smart Auto-Capture Effect
  useEffect(() => {
    if (autoMode === 'smart' && stream && videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      processingCanvasRef.current = canvas;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      
      const monitor = () => {
        if (!videoRef.current || !ctx) return;
        
        ctx.drawImage(videoRef.current, 0, 0, 64, 64);
        const currentData = ctx.getImageData(0, 0, 64, 64).data;
        
        if (lastImageDataRef.current) {
          const changeRatio = calculateDiff(currentData, lastImageDataRef.current);
          
          if (changeRatio > 0.05) {
            isTransitioningRef.current = true;
            setSmartStatus('Motion detected...');
            if (settleTimerRef.current) {
              clearTimeout(settleTimerRef.current);
              settleTimerRef.current = null;
            }
          } else if (isTransitioningRef.current) {
            setSmartStatus('Settling...');
            if (!settleTimerRef.current) {
              settleTimerRef.current = setTimeout(() => {
                setSmartStatus('Capturing!');
                captureAndAppend();
                isTransitioningRef.current = false;
                settleTimerRef.current = null;
              }, 1200);
            }
          } else {
            setSmartStatus('Watching...');
          }
        }
        
        lastImageDataRef.current = currentData;
        monitoringLoopRef.current = requestAnimationFrame(monitor);
      };
      
      monitoringLoopRef.current = requestAnimationFrame(monitor);
    } else {
      if (monitoringLoopRef.current) cancelAnimationFrame(monitoringLoopRef.current);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      isTransitioningRef.current = false;
    }
    
    return () => {
      if (monitoringLoopRef.current) cancelAnimationFrame(monitoringLoopRef.current);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    };
  }, [autoMode, stream, captureAndAppend]);

  const toggleAutoMode = (mode: AutoMode) => {
    setAutoMode(prev => prev === mode ? 'off' : mode);
  };

  const deleteCapture = useCallback((id: string) => {
    setCaptures(prev => {
      const updated = prev.filter(c => c.id !== id);
      if (previewId === id) {
        const index = prev.findIndex(c => c.id === id);
        if (updated.length === 0) setPreviewId(null);
        else if (index < updated.length) setPreviewId(updated[index].id);
        else setPreviewId(updated[updated.length - 1].id);
      }
      return updated;
    });
  }, [previewId]);

  const clearAll = () => {
    if (confirm('Are you sure you want to clear all captures?')) setCaptures([]);
  };

  const copyToClipboard = () => {
    const combinedMarkdown = captures.filter(c => c.status === 'done').map(c => c.markdown).join('\n\n---\n\n');
    navigator.clipboard.writeText(combinedMarkdown);
    alert('Copied to clipboard!');
  };

  // Drag and Drop Handlers
  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragEnter = (index: number) => {
    setDragOverIndex(index);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (index: number) => {
    if (draggedIndex === null || draggedIndex === index) return;
    
    setCaptures(prev => {
      const newCaptures = [...prev];
      const [draggedItem] = newCaptures.splice(draggedIndex, 1);
      newCaptures.splice(index, 0, draggedItem);
      return newCaptures;
    });
    
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const previewIndex = captures.findIndex(c => c.id === previewId);
  const selectedCapture = captures[previewIndex];

  const navigatePreview = useCallback((direction: 'prev' | 'next') => {
    if (previewIndex === -1) return;
    const newIndex = direction === 'prev' ? previewIndex - 1 : previewIndex + 1;
    if (newIndex >= 0 && newIndex < captures.length) setPreviewId(captures[newIndex].id);
  }, [previewIndex, captures]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!previewId) return;
      if (e.key === 'ArrowLeft') navigatePreview('prev');
      if (e.key === 'ArrowRight') navigatePreview('next');
      if (e.key === 'Escape') setPreviewId(null);
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (confirm('Delete this capture?')) deleteCapture(previewId);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewId, navigatePreview, deleteCapture]);

  const openPipControls = async () => {
    if (!('documentPictureInPicture' in window)) {
      alert('Document Picture-in-Picture is not supported in your browser. (Try Chrome 116+)');
      return;
    }

    try {
      const pipWindow = await (window as any).documentPictureInPicture.requestWindow({ width: 320, height: 250 });

      [...document.styleSheets].forEach((styleSheet) => {
        try {
          const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
          const style = document.createElement('style');
          style.textContent = cssRules;
          pipWindow.document.head.appendChild(style);
        } catch (e) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          if (styleSheet.href) {
            link.href = styleSheet.href;
          }
          pipWindow.document.head.appendChild(link);
        }
      });

      const container = pipWindow.document.createElement('div');
      container.style.padding = '15px'; container.style.display = 'flex'; container.style.flexDirection = 'column'; container.style.gap = '8px';
      pipWindow.document.body.appendChild(container);

      const title = pipWindow.document.createElement('div');
      title.textContent = 'Screen to MD'; title.style.fontWeight = 'bold';
      container.appendChild(title);

      const captureBtn = pipWindow.document.createElement('button');
      captureBtn.textContent = '📸 Capture Now';
      captureBtn.className = `${styles.button} ${styles.primary}`; captureBtn.style.width = '100%';
      captureBtn.onclick = () => captureAndAppend();
      container.appendChild(captureBtn);

      const translateRow = pipWindow.document.createElement('div');
      translateRow.style.display = 'flex'; translateRow.style.alignItems = 'center'; translateRow.style.gap = '8px'; translateRow.style.fontSize = '0.8rem';
      const translateCheck = pipWindow.document.createElement('input');
      translateCheck.type = 'checkbox'; translateCheck.checked = isTranslate;
      translateCheck.onchange = (e: Event) => {
        const target = e.target as HTMLInputElement;
        setIsTranslate(target.checked);
      };
      const translateLabel = pipWindow.document.createElement('label');
      translateLabel.textContent = 'Translate to Japanese';
      translateRow.appendChild(translateCheck); translateRow.appendChild(translateLabel);
      container.appendChild(translateRow);

      const modesDiv = pipWindow.document.createElement('div');
      modesDiv.className = styles.modeButtonGroup; modesDiv.style.width = '100%';
      container.appendChild(modesDiv);

      ['timer', 'smart'].forEach((m) => {
        const btn = pipWindow.document.createElement('button');
        btn.textContent = m === 'timer' ? '⏱️ Timer' : '🧠 Smart';
        btn.className = `${styles.modeBtn} ${autoMode === m ? styles.activeMode : ''}`;
        btn.style.flex = '1';
        btn.onclick = () => toggleAutoMode(m as AutoMode);
        modesDiv.appendChild(btn);
      });

      const stopBtn = pipWindow.document.createElement('button');
      stopBtn.textContent = '🛑 Stop Auto';
      stopBtn.className = `${styles.button} ${styles.danger}`; stopBtn.style.width = '100%';
      stopBtn.style.display = autoMode === 'off' ? 'none' : 'block';
      stopBtn.onclick = () => setAutoMode('off');
      container.appendChild(stopBtn);

      pipWindow.onunload = () => {};
    } catch (err: any) { alert("PiP Error: " + err.message); }
  };

  const combinedMarkdown = captures.filter(c => c.status === 'done').map(c => c.markdown).join('\n\n---\n\n');

  const parsePageRange = (rangeStr: string, maxPages: number): number[] => {
    if (!rangeStr.trim()) return Array.from({ length: Math.min(maxPages, 10) }, (_, i) => i + 1); // Default to first 10 pages if empty to avoid overflow
    
    const pages = new Set<number>();
    const parts = rangeStr.split(',');
    
    for (const part of parts) {
      const range = part.trim().split('-');
      if (range.length === 1) {
        const p = parseInt(range[0]);
        if (!isNaN(p) && p >= 1 && p <= maxPages) pages.add(p);
      } else if (range.length === 2) {
        const start = parseInt(range[0]);
        const end = parseInt(range[1]);
        if (!isNaN(start) && !isNaN(end)) {
          for (let i = Math.max(1, start); i <= Math.min(maxPages, end); i++) {
            pages.add(i);
          }
        }
      }
    }
    return Array.from(pages).sort((a, b) => a - b);
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      alert('Please upload a PDF file.');
      return;
    }

    try {
      // Dynamic import to avoid SSR issues
      const pdfjsLib = await import('pdfjs-dist');
      
      // Set up worker
      pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

      // Polyfill for DOMMatrix if missing (needed by PDF.js in some environments)
      if (typeof window !== 'undefined' && !window.DOMMatrix) {
        if ((window as any).WebKitCSSMatrix) {
          (window as any).DOMMatrix = (window as any).WebKitCSSMatrix;
        } else {
          // Fallback if both are missing - PDF.js might still fail, but we try
          console.warn("DOMMatrix and WebKitCSSMatrix are both missing.");
        }
      }

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const targetPages = parsePageRange(pdfPageRange, pdf.numPages);
      
      if (targetPages.length === 0) {
        alert('No valid pages selected.');
        return;
      }

      if (targetPages.length > 20) {
        if (!confirm(`You are about to process ${targetPages.length} pages. This might take a while. Continue?`)) return;
      }

      for (const pageNum of targetPages) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 2.0 }); // High quality
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) continue;

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport }).promise;
        const base64Image = canvas.toDataURL('image/png');
        
        const newId = Math.random().toString(36).substr(2, 9);
        const newCapture: CaptureResult = {
          id: newId,
          image: base64Image,
          markdown: '',
          status: 'loading'
        };
        setCaptures(prev => [...prev, newCapture]);

        // Process this page
        (async () => {
          try {
            const res = await fetch('/api/vision', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                image: base64Image, 
                translate: isTranslate,
                mimeType: 'image/png' // We converted PDF page to PNG
              }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Conversion failed');

            setCaptures(prev => prev.map(c => 
              c.id === newId ? { ...c, markdown: `### Page ${pageNum}\n\n${data.markdown}`, status: 'done' } : c
            ));
          } catch (err: any) {
            console.error(`Error processing page ${pageNum}:`, err);
            setCaptures(prev => prev.map(c => 
              c.id === newId ? { ...c, status: 'error', error: err.message } : c
            ));
          }
        })();
      }
    } catch (err: any) {
      console.error("PDF Loading Error:", err);
      alert("Failed to load PDF: " + err.message);
    }
    
    // Reset file input
    e.target.value = '';
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Screen to Markdown</h1>
      <p className={styles.subtitle}>Intelligent capture with motion detection</p>

      <div className={styles.captureSection}>
        <video ref={videoRef} autoPlay playsInline className={styles.videoPreview} style={{ display: stream ? 'block' : 'none' }} />
        {!stream && <div className={styles.videoPreview} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', background: '#eee' }}>Screen not shared</div>}

        {autoMode !== 'off' && (
          <div className={styles.autoCaptureIndicator}>
            <div className={styles.pulse} />
            {autoMode === 'timer' ? (
              <span>TIMER ACTIVE: Next in {countdown}s</span>
            ) : (
              <span>SMART ACTIVE: <span className={styles.smartStatus}>{smartStatus}</span></span>
            )}
          </div>
        )}

        <div className={styles.controls}>
          {!stream ? (
            <button className={`${styles.button} ${styles.primary}`} onClick={startCapture}><span>📺</span> Start Screen Share</button>
          ) : (
            <>
              <button className={`${styles.button} ${styles.secondary}`} onClick={stopCapture}>Stop Share</button>
              <button className={`${styles.button} ${styles.primary}`} onClick={captureAndAppend}><span>📸</span> Capture & Append</button>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 10px', background: '#f3f4f6', borderRadius: '8px', fontSize: '0.85rem' }}>
                <input 
                  type="checkbox" 
                  id="translate" 
                  checked={isTranslate} 
                  onChange={(e) => setIsTranslate(e.target.checked)} 
                />
                <label htmlFor="translate" style={{ fontWeight: 'bold', cursor: 'pointer' }}>Translate to JP</label>
              </div>

              <div className={styles.modeButtonGroup}>
                <button className={`${styles.modeBtn} ${autoMode === 'timer' ? styles.activeMode : ''}`} onClick={() => toggleAutoMode('timer')}>⏱️ Timer</button>
                <button className={`${styles.modeBtn} ${autoMode === 'smart' ? styles.activeMode : ''}`} onClick={() => toggleAutoMode('smart')}>🧠 Smart</button>
                {autoMode !== 'off' && <button className={`${styles.modeBtn}`} style={{color: '#ef4444'}} onClick={() => setAutoMode('off')}>✕</button>}
              </div>

              <button className={`${styles.button} ${styles.secondary}`} onClick={openPipControls}><span>🔲</span> Pop out Controls</button>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input 
                  type="file" 
                  accept=".pdf" 
                  onChange={handlePdfUpload} 
                  style={{ display: 'none' }} 
                  id="pdf-upload" 
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <label style={{ fontSize: '0.65rem', color: '#666', fontWeight: 'bold' }}>Page Range (Partial)</label>
                  <input 
                    type="text" 
                    placeholder="e.g. 1, 3-5" 
                    value={pdfPageRange}
                    onChange={(e) => setPdfPageRange(e.target.value)}
                    style={{ padding: '8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '0.8rem', width: '110px' }}
                  />
                </div>
                <button 
                  className={`${styles.button} ${styles.warning}`} 
                  onClick={() => document.getElementById('pdf-upload')?.click()}
                  title="Upload PDF to translate specified pages individually"
                >
                  <span>📄</span> PDF和訳
                </button>
              </div>
            </>
          )}
          {captures.length > 0 && (
            <>
              <button className={`${styles.button} ${styles.danger}`} onClick={clearAll}>Clear All</button>
              <button className={`${styles.button} ${styles.secondary}`} onClick={copyToClipboard} disabled={!combinedMarkdown}>Copy Markdown</button>
            </>
          )}
        </div>
      </div>

      {error && <div style={{ color: 'red', textAlign: 'center', marginBottom: '20px', padding: '10px', background: '#fee2e2', borderRadius: '8px' }}>{error}</div>}

      <div className={styles.mainLayout}>
        <div className={styles.historySidebar}>
          <div className={styles.sidebarHeader}><span>History</span><span>{captures.length} captures</span></div>
          <div className={styles.historyList}>
            {captures.length === 0 ? <div className={styles.emptyState}>No captures yet</div> : (
              captures.map((c, i) => (
                <div 
                  key={c.id} 
                  className={`${styles.captureItem} ${draggedIndex === i ? styles.dragging : ''} ${dragOverIndex === i ? styles.dragOver : ''}`}
                  draggable
                  onDragStart={() => handleDragStart(i)}
                  onDragEnter={() => handleDragEnter(i)}
                  onDragOver={handleDragOver}
                  onDrop={() => handleDrop(i)}
                  onDragEnd={handleDragEnd}
                >
                  <button className={styles.deleteBtn} onClick={(e) => { e.stopPropagation(); deleteCapture(c.id); }} title="Remove this capture">×</button>
                  <img src={c.image} alt={`Capture ${i+1}`} className={styles.thumbnail} onClick={() => setPreviewId(c.id)} style={{ cursor: 'zoom-in', opacity: 1 }} />
                  <div className={styles.statusOverlay} onClick={() => setPreviewId(c.id)} style={{ cursor: 'zoom-in' }}>
                    {c.status === 'loading' && <div className={styles.spinner} />}
                    {c.status === 'error' && <span title={c.error}>⚠️</span>}
                    {c.status === 'done' && <span>✅</span>}
                  </div>
                  <div className={`${styles.badge} ${c.status === 'loading' ? styles.badgeLoading : c.status === 'done' ? styles.badgeDone : styles.badgeError}`}>{i + 1}</div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className={styles.resultArea}>
          <div className={styles.resultHeader}>
            <span style={{ fontWeight: 'bold' }}>Combined Markdown</span>
            <span style={{ fontSize: '0.8rem', color: '#666' }}>{combinedMarkdown.split(/\s+/).filter(Boolean).length} words</span>
          </div>
          <div className={styles.markdownBox}>
            {captures.length === 0 ? (
              <div className={styles.emptyState}><span>✨</span>Results will appear here as you capture pages</div>
            ) : combinedMarkdown ? combinedMarkdown : captures.some(c => c.status === 'loading') ? (
              <div className={styles.emptyState}>AI is processing your first page...</div>
            ) : <div className={styles.emptyState}>Processing...</div>}
          </div>
        </div>
      </div>

      {selectedCapture && (
        <div className={styles.modalOverlay} onClick={() => setPreviewId(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={() => setPreviewId(null)}>×</button>
            <button className={`${styles.navBtn} ${styles.prevBtn}`} onClick={() => navigatePreview('prev')} disabled={previewIndex === 0}>‹</button>
            <img src={selectedCapture.image} alt="Enlarged capture" className={styles.modalImage} />
            <button className={`${styles.navBtn} ${styles.nextBtn}`} onClick={() => navigatePreview('next')} disabled={previewIndex === captures.length - 1}>›</button>
            <div className={styles.modalInfo}>Capture #{previewIndex + 1} of {captures.length} — Status: {selectedCapture.status}</div>
            <button className={styles.modalDelete} onClick={() => { if (confirm('Delete this capture?')) deleteCapture(selectedCapture.id); }}><span>🗑️</span> Delete This Capture</button>
          </div>
        </div>
      )}
    </div>
  );
}
