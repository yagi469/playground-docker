export interface Clipping {
  title: string;
  author: string;
  type: 'Highlight' | 'Note' | 'Bookmark' | 'Unknown';
  location: string;
  date: string;
  content: string;
}

export interface BookClippings {
  title: string;
  author: string;
  clippings: Clipping[];
}

export function parseKindleClippings(text: string): BookClippings[] {
  const rawEntries = text.split('==========').map(e => e.trim()).filter(e => e.length > 0);
  const clippings: Clipping[] = [];

  for (const entry of rawEntries) {
    const lines = entry.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) continue;

    // Line 1: Title (Author)
    const titleLine = lines[0];
    const authorMatch = titleLine.match(/\(([^)]+)\)$/);
    const author = authorMatch ? authorMatch[1] : 'Unknown Author';
    const title = authorMatch ? titleLine.replace(authorMatch[0], '').trim() : titleLine;

    // Line 2: - Your Highlight on page 164 | Location 2504-2505 | Added on Monday, October 16, 2023 10:11:44 PM
    const metaLine = lines[1];
    let type: Clipping['type'] = 'Unknown';
    if (metaLine.includes('Highlight')) type = 'Highlight';
    else if (metaLine.includes('Note')) type = 'Note';
    else if (metaLine.includes('Bookmark')) type = 'Bookmark';

    const locationMatch = metaLine.match(/(Location [^|]+|page [^|]+)/);
    const location = locationMatch ? locationMatch[0].trim() : 'Unknown Location';

    const dateMatch = metaLine.match(/Added on (.+)$/);
    const date = dateMatch ? dateMatch[1].trim() : 'Unknown Date';

    // Remaining lines: Content
    const content = lines.slice(2).join('\n');

    clippings.push({ title, author, type, location, date, content });
  }

  // Group by title
  const grouped: Record<string, BookClippings> = {};
  for (const clipping of clippings) {
    if (!grouped[clipping.title]) {
      grouped[clipping.title] = {
        title: clipping.title,
        author: clipping.author,
        clippings: [],
      };
    }
    grouped[clipping.title].clippings.push(clipping);
  }

  return Object.values(grouped);
}

export function convertToMarkdown(book: BookClippings): string {
  let md = `# ${book.title}\n`;
  md += `**Author**: ${book.author}\n\n`;
  md += `--- \n\n`;

  for (const clipping of book.clippings) {
    if (clipping.type === 'Bookmark') continue;

    md += `### ${clipping.type} (${clipping.location})\n`;
    md += `*Added on ${clipping.date}*\n\n`;
    md += `${clipping.content}\n\n`;
    md += `---\n\n`;
  }

  return md;
}
