'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import styles from './screen.module.css';

interface CaptureResult {
  id: string;
  image: string;
  markdown: string;
  status: 'loading' | 'done' | 'error';
  error?: string;
  progress?: number;
  statusMessage?: string;
}

type AutoMode = 'off' | 'timer' | 'smart';

export default function ScreenToMarkdown() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [captures, setCaptures] = useState<CaptureResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [autoMode, setAutoMode] = useState<AutoMode>('off');
  const [countdown, setCountdown] = useState(5);
  const [smartStatus, setSmartStatus] = useState<'監視中...' | '動きを検知...' | '静止待ち...' | 'キャプチャ実行!'>('監視中...');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [isTranslate, setIsTranslate] = useState(false);
  const [pdfPageRange, setPdfPageRange] = useState('');
  
  // Drag and Drop state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const autoCaptureRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const lastMarkdownRef = useRef<string>('');
  
  // Smart Capture Refs
  const lastImageDataRef = useRef<Uint8ClampedArray | null>(null);
  const settleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isTransitioningRef = useRef(false);
  const monitoringLoopRef = useRef<number | null>(null);
  const processingCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const fetchWithRetry = async (url: string, options: RequestInit, maxRetries = 3, initialDelay = 1000) => {
    let lastError: any;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const res = await fetch(url, options);
        if (res.ok) return res;
        
        const data = await res.json();
        if (res.status !== 503 && res.status !== 429) {
          throw new Error(data.error || `Request failed with status ${res.status}`);
        }
        
        lastError = new Error(data.error || `Service Unavailable (${res.status})`);
        console.warn(`Retry ${i + 1}/${maxRetries} due to ${res.status}. Waiting ${initialDelay * Math.pow(2, i)}ms...`);
        await new Promise(resolve => setTimeout(resolve, initialDelay * Math.pow(2, i)));
      } catch (err: any) {
        lastError = err;
        if (err.message && !err.message.includes('503') && !err.message.includes('429')) {
          throw err;
        }
        const delay = initialDelay * Math.pow(2, i);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw lastError;
  };

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
      const res = await fetchWithRetry('/api/vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          image: base64Image, 
          translate: isTranslate,
          previousContext: lastMarkdownRef.current
        }),
      });

      const data = await res.json();
      lastMarkdownRef.current = data.markdown;
      setCaptures(prev => prev.map(c => 
        c.id === newId ? { ...c, markdown: data.markdown, status: 'done' } : c
      ));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Conversion Error:", err);
      setCaptures(prev => prev.map(c => 
        c.id === newId ? { ...c, status: 'error', error: message } : c
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
            setSmartStatus('動きを検知...');
            if (settleTimerRef.current) {
              clearTimeout(settleTimerRef.current);
              settleTimerRef.current = null;
            }
          } else if (isTransitioningRef.current) {
            setSmartStatus('静止待ち...');
            if (!settleTimerRef.current) {
              settleTimerRef.current = setTimeout(() => {
                setSmartStatus('キャプチャ実行!');
                captureAndAppend();
                isTransitioningRef.current = false;
                settleTimerRef.current = null;
              }, 1200);
            }
          } else {
            setSmartStatus('監視中...');
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
    if (confirm('すべてのキャプチャを消去してもよろしいですか？')) {
      setCaptures([]);
      lastMarkdownRef.current = '';
    }
  };

  const retryCapture = useCallback(async (id: string) => {
    setCaptures(prev => {
      const capture = prev.find(c => c.id === id);
      if (!capture || capture.status === 'loading') return prev;

      // Find index and previous context
      const index = prev.findIndex(c => c.id === id);
      const previousMarkdown = index > 0 ? prev[index - 1].markdown : '';

      // Trigger the API call in the background
      (async () => {
        try {
          const res = await fetchWithRetry('/api/vision', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              image: capture.image, 
              translate: isTranslate,
              previousContext: previousMarkdown
            }),
          });

          const data = await res.json();
          setCaptures(current => {
            const updated = current.map(c => 
              c.id === id ? { ...c, markdown: data.markdown, status: 'done' } : c
            );
            // If this is the last one, update lastMarkdownRef
            if (index === updated.length - 1) {
              lastMarkdownRef.current = data.markdown;
            }
            return updated;
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("Retry Error:", err);
          setCaptures(current => current.map(c => 
            c.id === id ? { ...c, status: 'error', error: message } : c
          ));
        }
      })();

      // Return state with status 'loading'
      return prev.map(c => 
        c.id === id ? { ...c, status: 'loading', error: undefined } : c
      );
    });
  }, [isTranslate]);

  const copyToClipboard = () => {
    const combinedMarkdown = captures.filter(c => c.status === 'done').map(c => c.markdown).join('\n\n---\n\n');
    navigator.clipboard.writeText(combinedMarkdown);
    alert('クリップボードにコピーしました！');
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
        if (confirm('このキャプチャを削除しますか？')) deleteCapture(previewId);
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
      captureBtn.textContent = '📸 今すぐキャプチャ';
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
      translateLabel.textContent = '日本語に翻訳';
      translateRow.appendChild(translateCheck); translateRow.appendChild(translateLabel);
      container.appendChild(translateRow);

      const modesDiv = pipWindow.document.createElement('div');
      modesDiv.className = styles.modeButtonGroup; modesDiv.style.width = '100%';
      container.appendChild(modesDiv);

      ['timer', 'smart'].forEach((m) => {
        const btn = pipWindow.document.createElement('button');
        btn.textContent = m === 'timer' ? '⏱️ タイマー' : '🧠 スマート';
        btn.className = `${styles.modeBtn} ${autoMode === m ? styles.activeMode : ''}`;
        btn.style.flex = '1';
        btn.onclick = () => toggleAutoMode(m as AutoMode);
        modesDiv.appendChild(btn);
      });

      const stopBtn = pipWindow.document.createElement('button');
      stopBtn.textContent = '🛑 自動停止';
      stopBtn.className = `${styles.button} ${styles.danger}`; stopBtn.style.width = '100%';
      stopBtn.style.display = autoMode === 'off' ? 'none' : 'block';
      stopBtn.onclick = () => setAutoMode('off');
      container.appendChild(stopBtn);

      pipWindow.onunload = () => {};
    } catch (err: unknown) { 
      const message = err instanceof Error ? err.message : String(err);
      alert("PiP Error: " + message); 
    }
  };

  const combinedMarkdown = captures.filter(c => c.status === 'done').map(c => c.markdown).join('\n\n---\n\n');

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      alert('Please upload a PDF file.');
      return;
    }

    try {
      const newId = Math.random().toString(36).substr(2, 9);
      const newCapture: CaptureResult = {
        id: newId,
        image: '/file.svg',
        markdown: '',
        status: 'loading',
        progress: 5,
        statusMessage: 'PDFを読み込み中...'
      };
      setCaptures(prev => [...prev, newCapture]);

      // Generate a thumbnail for the history sidebar (only for small-ish files or just the first page)
      try {
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
        
        const arrayBuffer = await file.slice(0, 10 * 1024 * 1024).arrayBuffer(); // Just read first 10MB for thumb
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 0.5 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (context) {
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          await page.render({ canvasContext: context, viewport }).promise;
          const thumbnail = canvas.toDataURL('image/png');
          setCaptures(prev => prev.map(c => c.id === newId ? { ...c, image: thumbnail, progress: 20, statusMessage: '解析中...' } : c));
        }
      } catch (thumbErr) {
        console.warn("Failed to generate PDF thumbnail:", thumbErr);
      }

      setCaptures(prev => prev.map(c => c.id === newId ? { ...c, progress: 30, statusMessage: 'Geminiに送信中...' } : c));

      // Start a fake progress timer for the translation phase (30% to 90%)
      const progressInterval = setInterval(() => {
        setCaptures(prev => prev.map(c => {
          if (c.id === newId && c.status === 'loading' && c.progress && c.progress < 90) {
            return { ...c, progress: c.progress + 1, statusMessage: '処理中...' };
          }
          return c;
        }));
      }, 800);

      const formData = new FormData();
      formData.append('file', file);
      formData.append('translate', isTranslate.toString());
      formData.append('mimeType', 'application/pdf');
      formData.append('pageRange', pdfPageRange);
      formData.append('previousContext', lastMarkdownRef.current);

      const res = await fetchWithRetry('/api/vision', {
        method: 'POST',
        body: formData,
      });

      clearInterval(progressInterval);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      lastMarkdownRef.current = data.markdown;

      setCaptures(prev => prev.map(c => 
        c.id === newId ? { 
          ...c, 
          markdown: `## PDF: ${file.name}\n\n${data.markdown}`, 
          status: 'done', 
          progress: 100, 
          statusMessage: '完了' 
        } : c
      ));
    } catch (err: any) {
      console.error("PDF Processing Error:", err);
      setCaptures(prev => prev.map(c => 
        c.status === 'loading' ? { ...c, status: 'error', error: err.message, progress: 100, statusMessage: '失敗' } : c
      ));
      alert("PDFの処理に失敗しました: " + err.message);
    }
    
    // Reset file input
    e.target.value = '';
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Screen to Markdown</h1>
      <p className={styles.subtitle}>動きを検知するインテリジェント・キャプチャ</p>

      <div className={styles.captureSection}>
        <video ref={videoRef} autoPlay playsInline className={styles.videoPreview} style={{ display: stream ? 'block' : 'none' }} />
        {!stream && <div className={styles.videoPreview} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', background: '#eee' }}>画面が共有されていません</div>}

        {autoMode !== 'off' && (
          <div className={styles.autoCaptureIndicator}>
            <div className={styles.pulse} />
            {autoMode === 'timer' ? (
              <span>タイマー稼働中: 次回まで {countdown}秒</span>
            ) : (
              <span>スマート稼働中: <span className={styles.smartStatus}>{smartStatus}</span></span>
            )}
          </div>
        )}

        <div className={styles.controls}>
          {!stream ? (
            <button className={`${styles.button} ${styles.primary}`} onClick={startCapture}><span>📺</span> 画面共有を開始</button>
          ) : (
            <>
              <button className={`${styles.button} ${styles.secondary}`} onClick={stopCapture}>共有停止</button>
              <button className={`${styles.button} ${styles.primary}`} onClick={captureAndAppend}><span>📸</span> キャプチャして追加</button>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 10px', background: '#f3f4f6', borderRadius: '8px', fontSize: '0.85rem' }}>
                <input 
                  type="checkbox" 
                  id="translate" 
                  checked={isTranslate} 
                  onChange={(e) => setIsTranslate(e.target.checked)} 
                />
                <label htmlFor="translate" style={{ fontWeight: 'bold', cursor: 'pointer' }}>日本語に翻訳</label>
              </div>

              <div className={styles.modeButtonGroup}>
                <button className={`${styles.modeBtn} ${autoMode === 'timer' ? styles.activeMode : ''}`} onClick={() => toggleAutoMode('timer')}>⏱️ タイマー</button>
                <button className={`${styles.modeBtn} ${autoMode === 'smart' ? styles.activeMode : ''}`} onClick={() => toggleAutoMode('smart')}>🧠 スマート</button>
                {autoMode !== 'off' && <button className={`${styles.modeBtn}`} style={{color: '#ef4444'}} onClick={() => setAutoMode('off')}>✕</button>}
              </div>

              <button className={`${styles.button} ${styles.secondary}`} onClick={openPipControls}><span>🔲</span> 操作パネルを分離</button>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input 
                  type="file" 
                  accept=".pdf" 
                  onChange={handlePdfUpload} 
                  style={{ display: 'none' }} 
                  id="pdf-upload" 
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <label style={{ fontSize: '0.65rem', color: '#666', fontWeight: 'bold' }}>ページ範囲 (一部)</label>
                  <input 
                    type="text" 
                    placeholder="例: 1, 3-5" 
                    value={pdfPageRange}
                    onChange={(e) => setPdfPageRange(e.target.value)}
                    style={{ padding: '8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '0.8rem', width: '110px' }}
                  />
                </div>
                <button 
                  className={`${styles.button} ${styles.warning}`} 
                  onClick={() => document.getElementById('pdf-upload')?.click()}
                  title="PDFをアップロードして、指定したページを個別に和訳します"
                >
                  <span>📄</span> PDF和訳
                </button>
              </div>
            </>
          )}
          {captures.length > 0 && (
            <>
              <button className={`${styles.button} ${styles.danger}`} onClick={clearAll}>すべて消去</button>
              <button className={`${styles.button} ${styles.secondary}`} onClick={copyToClipboard} disabled={!combinedMarkdown}>Markdownをコピー</button>
            </>
          )}
        </div>
      </div>

      {error && <div style={{ color: 'red', textAlign: 'center', marginBottom: '20px', padding: '10px', background: '#fee2e2', borderRadius: '8px' }}>{error}</div>}

      <div className={styles.mainLayout}>
        <div className={styles.historySidebar}>
          <div className={styles.sidebarHeader}><span>履歴</span><span>{captures.length} 件</span></div>
          <div className={styles.historyList}>
            {captures.length === 0 ? <div className={styles.emptyState}>キャプチャがありません</div> : (
              captures.map((c, i) => (
                <div 
                  key={c.id} 
                  className={`${styles.captureItem} ${draggedIndex === i ? styles.dragging : ''} ${dragOverIndex === i ? styles.dragOver : ''} ${c.status === 'error' ? styles.hasError : ''}`}
                  draggable
                  onDragStart={() => handleDragStart(i)}
                  onDragEnter={() => handleDragEnter(i)}
                  onDragOver={handleDragOver}
                  onDrop={() => handleDrop(i)}
                  onDragEnd={handleDragEnd}
                >
                  <button className={styles.deleteBtn} onClick={(e) => { e.stopPropagation(); deleteCapture(c.id); }} title="このキャプチャを削除">×</button>
                  <button className={styles.reloadBtn} onClick={(e) => { e.stopPropagation(); retryCapture(c.id); }} title="再処理を実行">⟳</button>
                  <img src={c.image} alt={`Capture ${i+1}`} className={styles.thumbnail} onClick={() => setPreviewId(c.id)} style={{ cursor: 'zoom-in', opacity: 1 }} />
                  <div className={styles.statusOverlay} onClick={() => setPreviewId(c.id)} style={{ cursor: 'zoom-in', flexDirection: 'column' }}>
                    {c.status === 'loading' && (
                      <>
                        <div className={styles.spinner} />
                        <div className={styles.statusMessage}>{c.statusMessage}</div>
                        <div className={styles.progressBarContainer}>
                          <div className={styles.progressBar} style={{ width: `${c.progress || 0}%` }} />
                        </div>
                      </>
                    )}
                    {c.status === 'error' && (
                      <>
                        <span title={c.error}>⚠️</span>
                        <button 
                          className={styles.errorRetryBtn} 
                          onClick={(e) => { e.stopPropagation(); retryCapture(c.id); }}
                        >
                          再試行
                        </button>
                      </>
                    )}
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
            <span style={{ fontWeight: 'bold' }}>結合済み Markdown</span>
            <span style={{ fontSize: '0.8rem', color: '#666' }}>{combinedMarkdown.split(/\s+/).filter(Boolean).length} 単語</span>
          </div>
          <div className={styles.markdownBox}>
            {captures.length === 0 ? (
              <div className={styles.emptyState}><span>✨</span>ページをキャプチャするとここに結果が表示されます</div>
            ) : combinedMarkdown ? combinedMarkdown : captures.some(c => c.status === 'loading') ? (
              <div className={styles.emptyState}>AIが最初のページを処理中です...</div>
            ) : <div className={styles.emptyState}>処理中...</div>}
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
            <div className={styles.modalInfo}>キャプチャ #{previewIndex + 1} / {captures.length} — 状態: {selectedCapture.status}</div>
            <button className={styles.modalDelete} onClick={() => { if (confirm('このキャプチャを削除しますか？')) deleteCapture(selectedCapture.id); }}><span>🗑️</span> このキャプチャを削除</button>
          </div>
        </div>
      )}
    </div>
  );
}
