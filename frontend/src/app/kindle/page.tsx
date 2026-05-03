'use client';

import React, { useState, useCallback } from 'react';
import { parseKindleClippings, BookClippings, convertToMarkdown } from '@/utils/kindleParser';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import styles from './kindle.module.css'; // Using module for better scoping

export default function KindleToMarkdown() {
  const [books, setBooks] = useState<BookClippings[]>([]);
  const [previewBook, setPreviewBook] = useState<BookClippings | null>(null);

  const onFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsedBooks = parseKindleClippings(text);
      setBooks(parsedBooks);
    };
    reader.readAsText(file);
  };

  const downloadBook = (book: BookClippings) => {
    const md = convertToMarkdown(book);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    saveAs(blob, `${book.title.replace(/[\\/:"*?<>|]/g, '_')}.md`);
  };

  const downloadAll = async () => {
    const zip = new JSZip();
    for (const book of books) {
      const md = convertToMarkdown(book);
      zip.file(`${book.title.replace(/[\\/:"*?<>|]/g, '_')}.md`, md);
    }
    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, 'kindle_highlights.zip');
  };

  return (
    <div className={styles.kindleContainer}>
      <h1 className={styles.title}>Kindle to Markdown</h1>
      <p className={styles.subtitle}>Transform your highlights into organized notes</p>

      <div className={styles.dropzone} onClick={() => document.getElementById('fileInput')?.click()}>
        <input
          id="fileInput"
          type="file"
          accept=".txt"
          onChange={onFileUpload}
          style={{ display: 'none' }}
        />
        <p>Click to upload your <strong>My Clippings.txt</strong></p>
        <span style={{ fontSize: '0.8rem', color: '#999' }}>Found in your Kindle's documents folder</span>
      </div>

      {books.length > 0 && (
        <>
          <div className={styles.bookList}>
            {books.map((book) => (
              <div key={book.title} className={styles.bookCard}>
                <div className={styles.bookInfo}>
                  <h3>{book.title}</h3>
                  <p>{book.author} — {book.clippings.length} highlights</p>
                </div>
                <div className={styles.actions}>
                  <button 
                    className={`${styles.button} ${styles.secondary}`}
                    onClick={() => setPreviewBook(book)}
                  >
                    Preview
                  </button>
                  <button 
                    className={`${styles.button} ${styles.primary}`}
                    onClick={() => downloadBook(book)}
                  >
                    Download MD
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button className={`${styles.button} ${styles.downloadAll}`} onClick={downloadAll}>
            Download All as ZIP
          </button>
        </>
      )}

      {previewBook && (
        <div className={styles.previewOverlay} onClick={() => setPreviewBook(null)}>
          <div className={styles.previewModal} onClick={(e) => e.stopPropagation()}>
            <button className={styles.closeButton} onClick={() => setPreviewBook(null)}>×</button>
            <h2>Preview: {previewBook.title}</h2>
            <div className={styles.markdownPreview}>
              {convertToMarkdown(previewBook)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
