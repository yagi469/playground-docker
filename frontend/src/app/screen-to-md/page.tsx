'use client';

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
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
type ResultView = 'combined' | 'selected';

interface VisionErrorResponse {
  error?: string;
}

interface VisionSuccessResponse {
  markdown: string;
  error?: string;
}

interface DocumentPictureInPictureWindow extends Window {
  documentPictureInPicture?: {
    requestWindow: (options: { width: number; height: number }) => Promise<Window>;
  };
}

const getErrorMessage = (err: unknown) => err instanceof Error ? err.message : String(err);

export default function ScreenToMarkdown() {
  const [activeTab, setActiveTab] = useState<'screen' | 'pdf'>('screen');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [captures, setCaptures] = useState<CaptureResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [autoMode, setAutoMode] = useState<AutoMode>('off');
  const [countdown, setCountdown] = useState(5);
  const [smartStatus, setSmartStatus] = useState<'監視中...' | '動きを検知...' | '静止待ち...' | 'キャプチャ実行!'>('監視中...');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [resultView, setResultView] = useState<ResultView>('combined');
  const [viewMode, setViewMode] = useState<'grid' | 'slider'>('grid');
  const [isTranslate, setIsTranslate] = useState(false);
  const [isHoverCapture, setIsHoverCapture] = useState(false);
  const [isModalZoomed, setIsModalZoomed] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomPos, setZoomPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [pdfPageRange, setPdfPageRange] = useState('');
  
  // Drag and Drop state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  
  const hoverCooldownRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const modalImageRef = useRef<HTMLImageElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const autoCaptureRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const lastMarkdownRef = useRef<string>('');
  
  // Smart Capture Refs
  const lastImageDataRef = useRef<Uint8ClampedArray | null>(null);
  const settleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isTransitioningRef = useRef(false);
  const monitoringLoopRef = useRef<number | null>(null);
  const processingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastCaptureRef = useRef<CaptureResult | null>(null);
  const pipWindowRef = useRef<Window | null>(null);

  // Robust Scroll Lock
  useEffect(() => {
    if (previewId) {
      document.documentElement.classList.add('lock-scroll');
      document.body.classList.add('lock-scroll');
    } else {
      document.documentElement.classList.remove('lock-scroll');
      document.body.classList.remove('lock-scroll');
    }
    return () => {
      document.documentElement.classList.remove('lock-scroll');
      document.body.classList.remove('lock-scroll');
    };
  }, [previewId]);

  // Combined Blocker and Zoomer
  useEffect(() => {
    if (!previewId) return;

    const handleWindowWheel = (e: WheelEvent) => {
      // Force block any scrolling while modal is open
      e.preventDefault();

      // Perform zoom
      const delta = -e.deltaY;
      const factor = delta > 0 ? 1.12 : 0.88;
      setZoomScale(prev => {
        const next = Math.min(Math.max(1, prev * factor), 12);
        if (next <= 1.02) {
          setIsModalZoomed(false);
          setZoomPos({ x: 0, y: 0 });
          return 1;
        }
        setIsModalZoomed(true);
        return next;
      });
    };

    window.addEventListener('wheel', handleWindowWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWindowWheel);
  }, [previewId]);

  useEffect(() => {
    if (captures.length > 0) {
      lastCaptureRef.current = captures[captures.length - 1];
      
      // If PiP is open, trigger its update
      if (pipWindowRef.current) {
        const event = new CustomEvent('captureUpdated', { detail: lastCaptureRef.current });
        pipWindowRef.current.dispatchEvent(event);
      }
    }
  }, [captures]);

  const fetchWithRetry = async (url: string, options: RequestInit, maxRetries = 3, initialDelay = 1000) => {
    let lastError: unknown;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const res = await fetch(url, options);
        if (res.ok) return res;
        
        const data = await res.json() as VisionErrorResponse;
        if (res.status !== 503 && res.status !== 429) {
          throw new Error(data.error || `Request failed with status ${res.status}`);
        }
        
        lastError = new Error(data.error || `Service Unavailable (${res.status})`);
        console.warn(`Retry ${i + 1}/${maxRetries} due to ${res.status}. Waiting ${initialDelay * Math.pow(2, i)}ms...`);
        await new Promise(resolve => setTimeout(resolve, initialDelay * Math.pow(2, i)));
      } catch (err: unknown) {
        lastError = err;
        const message = getErrorMessage(err);
        if (!message.includes('503') && !message.includes('429')) {
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
      const displayMediaOptions: DisplayMediaStreamOptions = {
        video: { cursor: "always" } as MediaTrackConstraints,
        audio: false
      };
      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        ...displayMediaOptions,
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
      
      // Automatically open PiP remote when sharing starts
      setTimeout(() => {
        openPipControls();
      }, 500);
      
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

    // Perform AI processing in the background
    (async () => {
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

        const data = await res.json() as VisionSuccessResponse;
        lastMarkdownRef.current = data.markdown;
        setCaptures(prev => prev.map(c => 
          c.id === newId ? { ...c, markdown: data.markdown, status: 'done' } : c
        ));
        setSelectedResultId(prev => prev ?? newId);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("Conversion Error:", err);
        setCaptures(prev => prev.map(c => 
          c.id === newId ? { ...c, status: 'error', error: message } : c
        ));
      }
    })();
  }, [isTranslate]);

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

  useEffect(() => {
    if (autoMode === 'timer' && stream) {
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
    if (mode === 'timer' && autoMode !== 'timer') {
      setCountdown(5);
    }
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
      if (selectedResultId === id) {
        const index = prev.findIndex(c => c.id === id);
        if (updated.length === 0) setSelectedResultId(null);
        else if (index < updated.length) setSelectedResultId(updated[index].id);
        else setSelectedResultId(updated[updated.length - 1].id);
      }
      return updated;
    });
  }, [previewId, selectedResultId]);

  const clearAll = () => {
    if (confirm('すべてのキャプチャを消去してもよろしいですか？')) {
      setCaptures([]);
      setSelectedResultId(null);
      lastMarkdownRef.current = '';
    }
  };

  const retryCapture = useCallback(async (id: string) => {
    setCaptures(prev => {
      const capture = prev.find(c => c.id === id);
      if (!capture || capture.status === 'loading') return prev;
      const index = prev.findIndex(c => c.id === id);
      const previousMarkdown = index > 0 ? prev[index - 1].markdown : '';

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
          const data = await res.json() as VisionSuccessResponse;
          setCaptures(current => {
            const updated = current.map(c => c.id === id ? { ...c, markdown: data.markdown, status: 'done' as const } : c);
            if (index === updated.length - 1) lastMarkdownRef.current = data.markdown;
            return updated;
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          setCaptures(current => current.map(c => c.id === id ? { ...c, status: 'error', error: message } : c));
        }
      })();
      return prev.map(c => c.id === id ? { ...c, status: 'loading', error: undefined } : c);
    });
  }, [isTranslate]);

  const copyToClipboard = () => {
    const combinedMarkdown = captures.filter(c => c.status === 'done').map(c => c.markdown).join('\n\n---\n\n');
    navigator.clipboard.writeText(combinedMarkdown);
    alert('クリップボードにコピーしました！');
  };

  const copySelectedToClipboard = () => {
    const selected = captures.find(c => c.id === selectedResultId);
    if (!selected?.markdown) return;
    navigator.clipboard.writeText(selected.markdown);
    alert('選択中のMarkdownをコピーしました！');
  };

  const downloadMarkdown = () => {
    const markdown = captures.filter(c => c.status === 'done').map(c => c.markdown).join('\n\n---\n\n');
    if (!markdown) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `screen-to-md-${timestamp}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const updateCaptureMarkdown = (id: string, markdown: string) => {
    setCaptures(prev => {
      const updated = prev.map(c => c.id === id ? { ...c, markdown } : c);
      const lastDone = [...updated].reverse().find(c => c.status === 'done');
      if (lastDone) lastMarkdownRef.current = lastDone.markdown;
      return updated;
    });
  };

  const selectResult = (id: string) => {
    setSelectedResultId(id);
    setResultView('selected');
  };

  const handleDragStart = (index: number) => setDraggedIndex(index);
  const handleDragEnter = (index: number) => setDragOverIndex(index);
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();
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
  const handleDragEnd = () => { setDraggedIndex(null); setDragOverIndex(null); };

  const previewIndex = captures.findIndex(c => c.id === previewId);
  const selectedCapture = captures[previewIndex];

  const navigatePreview = useCallback((direction: 'prev' | 'next') => {
    const currentIdx = captures.findIndex(c => c.id === (previewId || selectedResultId));
    if (currentIdx === -1) return;
    const newIndex = direction === 'prev' ? currentIdx - 1 : currentIdx + 1;
    if (newIndex >= 0 && newIndex < captures.length) {
      if (previewId) setPreviewId(captures[newIndex].id);
      if (selectedResultId) setSelectedResultId(captures[newIndex].id);
    }
  }, [previewId, selectedResultId, captures]);

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
    const pipCapableWindow = window as DocumentPictureInPictureWindow;
    if (!pipCapableWindow.documentPictureInPicture) {
      alert('Document Picture-in-Picture is not supported in your browser. (Try Chrome 116+)');
      return;
    }

    try {
      const pipWindow = await pipCapableWindow.documentPictureInPicture.requestWindow({ width: 340, height: 380 });
      pipWindowRef.current = pipWindow;

      [...document.styleSheets].forEach((styleSheet) => {
        try {
          const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
          const style = document.createElement('style');
          style.textContent = cssRules;
          pipWindow.document.head.appendChild(style);
        } catch {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          if (styleSheet.href) link.href = styleSheet.href;
          pipWindow.document.head.appendChild(link);
        }
      });

      const container = pipWindow.document.createElement('div');
      container.style.padding = '16px';
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.gap = '12px';
      container.style.height = '100%';
      container.style.background = '#f9fafb';
      pipWindow.document.body.appendChild(container);

      const header = pipWindow.document.createElement('div');
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'center';
      header.style.marginBottom = '4px';

      const title = pipWindow.document.createElement('div');
      title.textContent = '📸 Capture Bar';
      title.style.fontWeight = 'bold';
      title.style.fontSize = '0.9rem';
      title.style.color = '#374151';
      header.appendChild(title);

      const closeBtn = pipWindow.document.createElement('button');
      closeBtn.textContent = '✕';
      closeBtn.style.border = 'none';
      closeBtn.style.background = 'none';
      closeBtn.style.fontSize = '1.2rem';
      closeBtn.style.cursor = 'pointer';
      closeBtn.style.color = '#9ca3af';
      closeBtn.onclick = () => pipWindow.close();
      header.appendChild(closeBtn);

      container.appendChild(header);

      const previewArea = pipWindow.document.createElement('div');
      previewArea.style.width = '100%';
      previewArea.style.height = '140px';
      previewArea.style.background = '#000';
      previewArea.style.borderRadius = '8px';
      previewArea.style.overflow = 'hidden';
      previewArea.style.position = 'relative';
      previewArea.style.display = 'flex';
      previewArea.style.alignItems = 'center';
      previewArea.style.justifyContent = 'center';
      
      const updatePreview = () => {
        const last = lastCaptureRef.current;
        previewArea.innerHTML = '';
        if (last) {
          const img = pipWindow.document.createElement('img');
          img.src = last.image;
          img.style.maxWidth = '100%';
          img.style.maxHeight = '100%';
          img.style.objectFit = 'contain';
          previewArea.appendChild(img);
          
          const badge = pipWindow.document.createElement('div');
          badge.textContent = `PAGE #${captures.length}`;
          badge.style.position = 'absolute'; badge.style.top = '8px'; badge.style.left = '8px';
          badge.style.background = 'rgba(124, 58, 237, 0.9)'; badge.style.color = 'white';
          badge.style.padding = '2px 8px'; badge.style.borderRadius = '10px'; badge.style.fontSize = '0.7rem';
          previewArea.appendChild(badge);

          if (last.status === 'loading') {
            const spin = pipWindow.document.createElement('div');
            spin.className = styles.spinner;
            previewArea.appendChild(spin);
          } else if (last.status === 'done') {
            const check = pipWindow.document.createElement('div');
            check.textContent = '✅';
            check.style.position = 'absolute'; check.style.bottom = '8px'; check.style.right = '8px';
            previewArea.appendChild(check);
          }
        } else {
          previewArea.innerHTML = '<span style="color: #666; font-size: 0.8rem;">No captures yet</span>';
        }
      };

      pipWindow.addEventListener('captureUpdated', () => updatePreview());
      updatePreview();
      container.appendChild(previewArea);

      const captureBtn = pipWindow.document.createElement('button');
      captureBtn.textContent = '📸 キャプチャ';
      captureBtn.style.padding = '14px';
      captureBtn.style.fontSize = '1.1rem';
      captureBtn.className = `${styles.button} ${styles.primary}`;
      captureBtn.style.width = '100%';
      
      const triggerCapture = () => {
        if (hoverCooldownRef.current) return;
        hoverCooldownRef.current = true;
        
        captureBtn.style.transform = 'scale(0.95)';
        captureBtn.style.background = '#4c1d95';
        
        captureAndAppend();
        
        setTimeout(() => {
          captureBtn.style.transform = 'scale(1)';
          captureBtn.style.background = '';
          // Cooldown for 1.5 seconds to prevent accidental double capture
          setTimeout(() => { hoverCooldownRef.current = false; }, 1500);
        }, 200);
      };

      captureBtn.onclick = () => {
        triggerCapture();
      };

      captureBtn.onmouseenter = () => {
        const check = pipWindow.document.getElementById('hover-cap-check') as HTMLInputElement;
        if (check?.checked) {
          triggerCapture();
        }
      };

      container.appendChild(captureBtn);

      const optionsRow = pipWindow.document.createElement('div');
      optionsRow.style.display = 'flex'; 
      optionsRow.style.flexDirection = 'column';
      optionsRow.style.gap = '8px';
      
      const translateGrp = pipWindow.document.createElement('div');
      translateGrp.style.display = 'flex'; translateGrp.style.alignItems = 'center'; translateGrp.style.gap = '6px';
      const translateCheck = pipWindow.document.createElement('input');
      translateCheck.type = 'checkbox'; translateCheck.checked = isTranslate;
      translateCheck.onchange = (e) => setIsTranslate((e.target as HTMLInputElement).checked);
      const translateLabel = pipWindow.document.createElement('label');
      translateLabel.textContent = '和訳する'; translateLabel.style.fontSize = '0.8rem';
      translateGrp.appendChild(translateCheck); translateGrp.appendChild(translateLabel);
      optionsRow.appendChild(translateGrp);

      const hoverGrp = pipWindow.document.createElement('div');
      hoverGrp.style.display = 'flex'; hoverGrp.style.alignItems = 'center'; hoverGrp.style.gap = '6px';
      const hoverCheck = pipWindow.document.createElement('input');
      hoverCheck.type = 'checkbox'; hoverCheck.id = 'hover-cap-check'; hoverCheck.checked = isHoverCapture;
      hoverCheck.onchange = (e) => setIsHoverCapture((e.target as HTMLInputElement).checked);
      const hoverLabel = pipWindow.document.createElement('label');
      hoverLabel.textContent = 'マウス乗せで撮影 (推奨)'; 
      hoverLabel.style.fontSize = '0.8rem'; hoverLabel.style.fontWeight = 'bold'; hoverLabel.style.color = '#7c3aed';
      hoverGrp.appendChild(hoverCheck); hoverGrp.appendChild(hoverLabel);
      optionsRow.appendChild(hoverGrp);

      container.appendChild(optionsRow);

      const modesDiv = pipWindow.document.createElement('div');
      modesDiv.className = styles.modeButtonGroup; modesDiv.style.width = '100%';
      ['timer', 'smart'].forEach((m) => {
        const btn = pipWindow.document.createElement('button');
        btn.textContent = m === 'timer' ? '⏱️ タイマー' : '🧠 スマート';
        btn.className = `${styles.modeBtn} ${autoMode === m ? styles.activeMode : ''}`;
        btn.style.flex = '1';
        btn.onclick = () => {
          toggleAutoMode(m as AutoMode);
          pipWindow.close(); 
        };
        modesDiv.appendChild(btn);
      });
      container.appendChild(modesDiv);

      if (autoMode !== 'off') {
        const stopBtn = pipWindow.document.createElement('button');
        stopBtn.textContent = '🛑 自動停止';
        stopBtn.className = `${styles.button} ${styles.danger}`; stopBtn.style.width = '100%';
        stopBtn.style.marginTop = 'auto';
        stopBtn.onclick = () => {
          setAutoMode('off');
          pipWindow.close();
        };
        container.appendChild(stopBtn);
      }

      pipWindow.onunload = () => { pipWindowRef.current = null; };
    } catch (err: unknown) { 
      const message = err instanceof Error ? err.message : String(err);
      alert("PiP Error: " + message); 
    }
  };

  const combinedMarkdown = useMemo(
    () => captures.filter(c => c.status === 'done').map(c => c.markdown).join('\n\n---\n\n'),
    [captures]
  );
  const selectedResultCapture = captures.find(c => c.id === selectedResultId) ?? null;

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
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

      const data = await res.json() as VisionSuccessResponse;
      if (data.error) throw new Error(data.error);
      lastMarkdownRef.current = data.markdown;
      setCaptures(prev => prev.map(c => c.id === newId ? { ...c, markdown: data.markdown, status: 'done', progress: 100 } : c));
      setSelectedResultId(prev => prev ?? newId);
    } catch (err: unknown) {
      alert("PDF Error: " + getErrorMessage(err));
    }
    e.target.value = '';
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Screen to Markdown</h1>
      <p className={styles.subtitle}>画面やPDFを解析して、構造化されたMarkdownに変換</p>

      <div className={styles.tabs}>
        <button className={`${styles.tabButton} ${activeTab === 'screen' ? styles.tabActive : ''}`} onClick={() => setActiveTab('screen')}>📺 画面キャプチャ</button>
        <button className={`${styles.tabButton} ${activeTab === 'pdf' ? styles.tabActive : ''}`} onClick={() => setActiveTab('pdf')}>📄 PDF解析</button>
      </div>

      <div className={styles.captureSection}>
        {activeTab === 'screen' ? (
          <>
            <video ref={videoRef} autoPlay playsInline className={styles.videoPreview} style={{ display: stream ? 'block' : 'none' }} />
            {!stream && <div className={styles.videoPreview} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', background: '#eee' }}>画面共有を開始してキャプチャを開始します</div>}
            {autoMode !== 'off' && (
              <div className={styles.autoCaptureIndicator}>
                <div className={styles.pulse} />
                {autoMode === 'timer' ? <span>タイマー稼働中: 次回まで {countdown}秒</span> : <span>スマート稼働中: <span className={styles.smartStatus}>{smartStatus}</span></span>}
              </div>
            )}
            <div className={styles.controls}>
              {!stream ? (
                <button className={`${styles.button} ${styles.primary}`} onClick={startCapture}><span>📺</span> 画面共有を開始</button>
              ) : (
                <>
                  <button className={`${styles.button} ${styles.secondary}`} onClick={stopCapture}>共有停止</button>
                  <button className={`${styles.button} ${styles.primary}`} onClick={captureAndAppend}><span>📸</span> キャプチャ</button>
                  <div className={styles.modeButtonGroup}>
                    <button className={`${styles.modeBtn} ${autoMode === 'timer' ? styles.activeMode : ''}`} onClick={() => toggleAutoMode('timer')}>⏱️</button>
                    <button className={`${styles.modeBtn} ${autoMode === 'smart' ? styles.activeMode : ''}`} onClick={() => toggleAutoMode('smart')}>🧠</button>
                    {autoMode !== 'off' && <button className={styles.modeBtn} style={{color: '#ef4444'}} onClick={() => setAutoMode('off')}>✕</button>}
                  </div>
                  <button className={`${styles.button} ${styles.secondary}`} onClick={openPipControls}>🔲</button>
                </>
              )}
              <div className={styles.optionGroup}>
                <input type="checkbox" id="translate-screen" checked={isTranslate} onChange={(e) => setIsTranslate(e.target.checked)} />
                <label htmlFor="translate-screen">和訳</label>
              </div>
            </div>
          </>
        ) : (
          <div className={styles.pdfUploadArea}>
            <div className={styles.pdfIcon}>📄</div>
            <h3>PDFファイルをアップロード</h3>
            <div className={styles.pdfOptions}>
              <div className={styles.optionField}><label>ページ範囲</label><input type="text" placeholder="例: 1, 3-5" value={pdfPageRange} onChange={(e) => setPdfPageRange(e.target.value)} /></div>
              <div className={styles.optionGroup}><input type="checkbox" id="translate-pdf" checked={isTranslate} onChange={(e) => setIsTranslate(e.target.checked)} /><label htmlFor="translate-pdf">和訳</label></div>
            </div>
            <input type="file" accept=".pdf" onChange={handlePdfUpload} style={{ display: 'none' }} id="pdf-upload-tab" />
            <button className={`${styles.button} ${styles.warning}`} onClick={() => document.getElementById('pdf-upload-tab')?.click()}>PDFを選択</button>
          </div>
        )}
        {captures.length > 0 && (
          <div className={styles.globalActions}>
            <button className={`${styles.button} ${styles.danger} ${styles.mini}`} onClick={clearAll}>消去</button>
            <button className={`${styles.button} ${styles.secondary} ${styles.mini}`} onClick={copyToClipboard}>コピー</button>
            <button className={`${styles.button} ${styles.secondary} ${styles.mini}`} onClick={downloadMarkdown}>保存</button>
          </div>
        )}
      </div>

      {error && <div style={{ color: 'red', textAlign: 'center', marginBottom: '20px', padding: '10px', background: '#fee2e2', borderRadius: '8px' }}>{error}</div>}

      <div className={styles.mainLayout}>
        <div className={styles.historySidebar}>
          <div className={styles.sidebarHeader}>
            <span>履歴 ({captures.length})</span>
            <div className={styles.viewModeToggle}>
              <button className={viewMode === 'grid' ? styles.activeMode : ''} onClick={() => setViewMode('grid')}>⊞</button>
              <button className={viewMode === 'slider' ? styles.activeMode : ''} onClick={() => setViewMode('slider')}>↔</button>
            </div>
          </div>
          <div className={styles.historyList}>
            {captures.length === 0 ? <div className={styles.emptyState}>なし</div> : (
              viewMode === 'grid' ? (
                captures.map((c, i) => (
                  <div key={c.id} className={`${styles.captureItem} ${selectedResultId === c.id ? styles.selectedItem : ''}`} onClick={() => selectResult(c.id)}>
                    <button className={styles.deleteBtn} onClick={(e) => { e.stopPropagation(); deleteCapture(c.id); }} title="削除">×</button>
                    <button className={styles.reloadBtn} onClick={(e) => { e.stopPropagation(); retryCapture(c.id); }} title="再試行">⟳</button>
                    <button className={styles.previewBtn} onClick={(e) => { e.stopPropagation(); setPreviewId(c.id); }} title="拡大表示">□</button>
                    <img src={c.image} alt="" className={styles.thumbnail} />
                    <div className={styles.statusOverlay} style={{ background: c.status === 'done' ? 'transparent' : 'rgba(0,0,0,0.4)' }}>
                      {c.status === 'loading' && <div className={styles.spinner} />}
                      {c.status === 'done' && <span style={{ position: 'absolute', bottom: '4px', right: '4px' }}>✅</span>}
                    </div>
                  </div>
                ))
              ) : (
                <div className={styles.miniSlider}>
                  {captures.map((c, i) => (
                    <div key={c.id} className={`${styles.miniSliderItem} ${selectedResultId === c.id ? styles.activeMiniItem : ''}`} onClick={() => selectResult(c.id)}>
                      <img src={c.image} alt="" />
                      {c.status === 'done' && <span style={{ position: 'absolute', bottom: '2px', right: '2px', fontSize: '0.7rem' }}>✅</span>}
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </div>

        <div className={styles.resultArea}>
          <div className={styles.resultHeader}>
            <div className={styles.resultHeaderLeft}>
              <span style={{ fontWeight: 'bold' }}>
                {viewMode === 'slider' ? `ページ ${captures.findIndex(c => c.id === selectedResultId) + 1} / ${captures.length}` : (resultView === 'combined' ? '結合済み Markdown' : '選択中の Markdown')}
              </span>
              {viewMode === 'grid' && (
                <div className={styles.viewToggle}>
                  <button className={resultView === 'combined' ? styles.viewToggleActive : ''} onClick={() => setResultView('combined')}>結合</button>
                  <button className={resultView === 'selected' ? styles.viewToggleActive : ''} onClick={() => setResultView('selected')} disabled={!selectedResultCapture}>選択</button>
                </div>
              )}
            </div>
            {viewMode === 'slider' && captures.length > 1 && (
              <div className={styles.sliderNav}>
                <button onClick={() => navigatePreview('prev')} disabled={captures.findIndex(c => c.id === selectedResultId) <= 0}>前へ</button>
                <button onClick={() => navigatePreview('next')} disabled={captures.findIndex(c => c.id === selectedResultId) >= captures.length - 1}>次へ</button>
              </div>
            )}
            <div className={styles.resultActions}>
              <span style={{ fontSize: '0.8rem', color: '#666' }}>
                {(viewMode === 'slider' || resultView === 'selected' ? selectedResultCapture?.markdown ?? '' : combinedMarkdown).split(/\s+/).filter(Boolean).length} 単語
              </span>
            </div>
          </div>
          
          {viewMode === 'slider' && selectedResultCapture ? (
            <div className={styles.sliderContainer}>
              <div className={styles.sliderImageFrame}>
                <img src={selectedResultCapture.image} alt="Capture" className={styles.sliderImage} />
                <div className={styles.sliderOverlay}>
                  {selectedResultCapture.status === 'loading' && <div className={styles.spinner} />}
                  {selectedResultCapture.status === 'error' && <span title={selectedResultCapture.error}>⚠️</span>}
                </div>
              </div>
              <textarea
                className={styles.markdownEditor}
                value={selectedResultCapture.markdown}
                onChange={(e) => updateCaptureMarkdown(selectedResultCapture.id, e.target.value)}
                placeholder="Markdownを編集..."
                disabled={selectedResultCapture.status === 'loading'}
              />
            </div>
          ) : resultView === 'selected' && selectedResultCapture ? (
            <textarea
              className={styles.markdownEditor}
              value={selectedResultCapture.markdown}
              onChange={(e) => updateCaptureMarkdown(selectedResultCapture.id, e.target.value)}
              placeholder="Markdownを編集..."
              disabled={selectedResultCapture.status === 'loading'}
            />
          ) : (
            <div className={styles.markdownBox}>
              {captures.length === 0 ? (
                <div className={styles.emptyState}><span>✨</span>ページをキャプチャするとここに結果が表示されます</div>
              ) : combinedMarkdown ? combinedMarkdown : captures.some(c => c.status === 'loading') ? (
                <div className={styles.emptyState}>AIが最初のページを処理中です...</div>
              ) : <div className={styles.emptyState}>処理中...</div>}
            </div>
          )}
        </div>
      </div>

      {selectedCapture && (
        <div className={styles.modalOverlay} onClick={() => { setPreviewId(null); setIsModalZoomed(false); setZoomScale(1); setZoomPos({ x: 0, y: 0 }); }}>
          <div
            className={`${styles.modalContent} ${isModalZoomed ? styles.modalContentZoomed : ''}`}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => {
              if (!isModalZoomed) return;
              e.preventDefault();
              setIsDragging(true);
              dragStartRef.current = { x: e.clientX - zoomPos.x, y: e.clientY - zoomPos.y };
            }}
            onMouseMove={(e) => {
              if (!isDragging || !isModalZoomed) return;
              setZoomPos({
                x: e.clientX - dragStartRef.current.x,
                y: e.clientY - dragStartRef.current.y,
              });
            }}
            onMouseUp={() => setIsDragging(false)}
            onMouseLeave={() => setIsDragging(false)}
          >
            <img 
              src={selectedCapture.image} 
              alt="" 
              ref={modalImageRef}
              className={`${styles.modalImage} ${isModalZoomed ? styles.modalImageZoomed : ''}`}
              style={{
                transform: `translate(${zoomPos.x}px, ${zoomPos.y}px) scale(${zoomScale})`,
                cursor: isModalZoomed ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in',
              }}
              onClick={() => {
                if (!isModalZoomed) {
                  setIsModalZoomed(true);
                  setZoomScale(2.5);
                } else {
                  setIsModalZoomed(false);
                  setZoomScale(1);
                  setZoomPos({ x: 0, y: 0 });
                }
              }}
              title={isModalZoomed ? "縮小する（スクロールでもズーム可能）" : "クリックまたはスクロールで拡大"}
              draggable={false}
            />
            {isModalZoomed && (
              <div className={styles.zoomIndicator}>
                {Math.round(zoomScale * 100)}%
              </div>
            )}
            <button className={styles.modalClose} onClick={() => { setPreviewId(null); setIsModalZoomed(false); setZoomScale(1); setZoomPos({ x: 0, y: 0 }); }}>×</button>
            {!isModalZoomed && (
              <>
                <button className={`${styles.navBtn} ${styles.prevBtn}`} onClick={() => navigatePreview('prev')} disabled={previewIndex === 0}>‹</button>
                <button className={`${styles.navBtn} ${styles.nextBtn}`} onClick={() => navigatePreview('next')} disabled={previewIndex === captures.length - 1}>›</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
