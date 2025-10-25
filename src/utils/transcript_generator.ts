import { EmbedBuilder } from "discord.js";
import { prisma } from "./prisma";
import Logger from "./logger";

const logger = new Logger('transcript-generator');

interface TicketTranscriptData {
  ticketId: number;
  categoryName: string;
  ticketName: string;
  channelId: string;
  userId: string;
  userUsername: string;
  userDisplayName: string;
  openedAt: Date;
  closedAt: Date | null;
}

interface TicketMessageData {
  id: number;
  authorId: string;
  displayName: string;
  avatar: string | null;
  content: string | null;
  editedAt: Date | null;
  sentAt: Date;
}

/**
 * Generates an HTML transcript for a ticket that mimics Discord's UI
 */
export async function generateTicketTranscript(ticketId: number): Promise<string> {
  try {
    // Fetch ticket data with related category
    const ticket = await prisma.tickets.findUnique({
      where: { id: ticketId },
      include: {
        ticketCategory: true,
        messages: {
          orderBy: {
            sentAt: 'asc'
          }
        }
      }
    });

    if (!ticket) {
      throw new Error(`Ticket with ID ${ticketId} not found`);
    }

    const ticketData: TicketTranscriptData = {
      ticketId: ticket.id,
      categoryName: ticket.ticketCategory.name,
      ticketName: ticket.ticketName,
      channelId: ticket.channelId,
      userId: ticket.userId,
      userUsername: ticket.userUsername,
      userDisplayName: ticket.userDisplayName,
      openedAt: ticket.openedAt,
      closedAt: ticket.closedAt,
    };


    const messages: TicketMessageData[] = ticket.messages.filter((msg, index, arr) => {
      if (index === 0 && msg.content?.includes('<EMBED:')) {
        return false;
      }
      if (index === arr.length - 1 && msg.content?.includes('<EMBED:')) {
        return false;
      }
      return true;
    });

    // Generate HTML
    const html = generateHTML(ticketData, messages);

    logger.success(`Generated transcript for ticket ${ticketId}`);
    return html;
  } catch (err) {
    logger.error(`Failed to generate transcript for ticket ${ticketId}:`, (err as Error).message);
    throw err;
  }
}

/**
 * Parses embed data from message content
 */
function parseEmbed(embedString: string): any {
  try {
    const embedData = embedString.replace('<EMBED:', '').replace('>', '');
    return JSON.parse(embedData);
  } catch {
    return null;
  }
}

/**
 * Formats a date to timestamp with date and time
 */
function formatTimestamp(date: Date): string {
  const messageDate = new Date(date);

  const dateString = messageDate.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric'
  });

  const timeString = messageDate.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });

  return `${dateString} ${timeString}`;
}

/**
 * Generates Discord-like embed HTML
 */
function generateEmbedHTML(embedData: any): string {
  const color = embedData.color ? `#${embedData.color.toString(16).padStart(6, '0')}` : '#202225';

  let embedHTML = `<div class="embed" style="border-left-color: ${color};">`;

  if (embedData.author) {
    embedHTML += `<div class="embed-author">`;
    if (embedData.author.icon_url) {
      embedHTML += `<img src="${embedData.author.icon_url}" class="embed-author-icon" alt="Author icon">`;
    }
    if (embedData.author.name) {
      embedHTML += `<span class="embed-author-name">${escapeHtml(embedData.author.name)}</span>`;
    }
    embedHTML += `</div>`;
  }

  // Title
  if (embedData.title) {
    embedHTML += `<div class="embed-title">${escapeHtml(embedData.title)}</div>`;
  }

  // Description
  if (embedData.description) {
    embedHTML += `<div class="embed-description">${formatDiscordMarkdown(embedData.description)}</div>`;
  }

  // Fields
  if (embedData.fields && embedData.fields.length > 0) {
    embedHTML += `<div class="embed-fields">`;
    embedData.fields.forEach((field: any) => {
      const inlineClass = field.inline ? 'embed-field-inline' : '';
      embedHTML += `
        <div class="embed-field ${inlineClass}">
          <div class="embed-field-name">${escapeHtml(field.name)}</div>
          <div class="embed-field-value">${formatDiscordMarkdown(field.value)}</div>
        </div>
      `;
    });
    embedHTML += `</div>`;
  }

  // Thumbnail
  if (embedData.thumbnail?.url) {
    embedHTML += `<img src="${embedData.thumbnail.url}" class="embed-thumbnail" alt="Thumbnail">`;
  }

  // Footer
  if (embedData.footer) {
    embedHTML += `<div class="embed-footer">`;
    if (embedData.footer.icon_url) {
      embedHTML += `<img src="${embedData.footer.icon_url}" class="embed-footer-icon" alt="Footer icon">`;
    }
    if (embedData.footer.text) {
      embedHTML += `<span>${escapeHtml(embedData.footer.text)}</span>`;
    }
    embedHTML += `</div>`;
  }

  embedHTML += `</div>`;
  return embedHTML;
}

/**
 * Escapes HTML special characters
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * Formats Discord markdown (basic implementation)
 */
function formatDiscordMarkdown(text: string): string {
  let formatted = escapeHtml(text);

  // Bold
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Italic
  formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');
  // Underline
  formatted = formatted.replace(/__(.*?)__/g, '<u>$1</u>');
  // Strikethrough
  formatted = formatted.replace(/~~(.*?)~~/g, '<s>$1</s>');
  // Code block
  formatted = formatted.replace(/```(.*?)```/gs, '<pre><code>$1</code></pre>');
  // Inline code
  formatted = formatted.replace(/`(.*?)`/g, '<code>$1</code>');
  // Quote
  formatted = formatted.replace(/^&gt; (.+)$/gm, '<div class="quote">$1</div>');
  // User mentions
  formatted = formatted.replace(/&lt;@(\d+)&gt;/g, '<span class="mention">@User</span>');
  // Channel mentions
  formatted = formatted.replace(/&lt;#(\d+)&gt;/g, '<span class="mention">#channel</span>');
  // Line breaks
  formatted = formatted.replace(/\n/g, '<br>');

  return formatted;
}

/**
 * Generates the complete HTML document
 */
function generateHTML(ticketData: TicketTranscriptData, messages: TicketMessageData[]): string {
  const messagesHTML = messages.map((msg) => {
    const avatar = msg.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png';
    const timestamp = formatTimestamp(msg.sentAt);
    const editedText = msg.editedAt ? ` <span class="edited">(edited)</span>` : '';

    // Parse content for embeds
    let contentHTML = '';
    let embedsHTML = '';

    if (msg.content) {
      const embedMatches = msg.content.match(/<EMBED:.*?>/gs);
      let textContent = msg.content;

      if (embedMatches) {
        // Remove embed tags from text content
        textContent = msg.content.replace(/<EMBED:.*?>/gs, '').trim();

        // Parse and generate embed HTML
        embedMatches.forEach((embedMatch) => {
          const embedData = parseEmbed(embedMatch);
          if (embedData) {
            embedsHTML += generateEmbedHTML(embedData);
          }
        });
      }

      if (textContent) {
        contentHTML = `<div class="message-content">${formatDiscordMarkdown(textContent)}</div>`;
      }
    }

    return `
      <div class="message">
        <img src="${avatar}" alt="${escapeHtml(msg.displayName)}" class="avatar">
        <div class="message-body">
          <div class="message-header">
            <span class="username">${escapeHtml(msg.displayName)}</span>
            <span class="timestamp">${timestamp}${editedText}</span>
          </div>
          ${contentHTML}
          ${embedsHTML}
        </div>
      </div>
    `;
  }).join('');

  const openedDate = formatTimestamp(ticketData.openedAt);
  const closedDate = ticketData.closedAt ? formatTimestamp(ticketData.closedAt) : 'Still Open';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ticket Transcript - ${escapeHtml(ticketData.ticketName)}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'gg sans', 'Noto Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif;
      background-color: #36393f;
      color: #dcddde;
      line-height: 1.375;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }

    .header {
      background-color: #2f3136;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      border-left: 4px solid #5865f2;
    }

    .header h1 {
      font-size: 24px;
      margin-bottom: 10px;
      color: #ffffff;
    }

    .header-info {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 10px;
      margin-top: 15px;
      font-size: 14px;
    }

    .header-info-item {
      background-color: #202225;
      padding: 8px 12px;
      border-radius: 4px;
    }

    .header-info-label {
      color: #b9bbbe;
      font-weight: 600;
      margin-right: 5px;
    }

    .messages {
      background-color: #2f3136;
      padding: 20px;
      border-radius: 8px;
    }

    .message {
      display: flex;
      padding: 10px 0;
      position: relative;
    }

    .message:hover {
      background-color: #32353b;
      margin: 0 -20px;
      padding-left: 20px;
      padding-right: 20px;
    }

    .avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      margin-right: 16px;
      flex-shrink: 0;
    }

    .message-body {
      flex: 1;
      min-width: 0;
    }

    .message-header {
      display: flex;
      align-items: baseline;
      margin-bottom: 4px;
    }

    .username {
      font-weight: 500;
      color: #ffffff;
      margin-right: 8px;
      cursor: pointer;
    }

    .username:hover {
      text-decoration: underline;
    }

    .timestamp {
      font-size: 12px;
      color: #72767d;
      font-weight: 400;
    }

    .edited {
      font-size: 10px;
      color: #72767d;
    }

    .message-content {
      color: #dcddde;
      word-wrap: break-word;
      font-size: 16px;
      line-height: 1.375;
    }

    .message-content code {
      background-color: #202225;
      padding: 2px 4px;
      border-radius: 3px;
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 14px;
    }

    .message-content pre {
      background-color: #202225;
      border: 1px solid #040405;
      border-radius: 4px;
      padding: 10px;
      margin: 6px 0;
      overflow-x: auto;
    }

    .message-content pre code {
      background-color: transparent;
      padding: 0;
    }

    .message-content .quote {
      border-left: 4px solid #4e5058;
      padding-left: 12px;
      margin: 4px 0;
      color: #b9bbbe;
    }

    .mention {
      background-color: rgba(88, 101, 242, 0.3);
      color: #dee0fc;
      padding: 0 2px;
      border-radius: 3px;
      font-weight: 500;
    }

    .mention:hover {
      background-color: rgba(88, 101, 242, 0.5);
      cursor: pointer;
    }

    .embed {
      display: grid;
      max-width: 520px;
      margin-top: 8px;
      background-color: #2f3136;
      border-left: 4px solid;
      border-radius: 4px;
      padding: 12px 16px;
      position: relative;
    }

    .embed-author {
      display: flex;
      align-items: center;
      margin-bottom: 8px;
    }

    .embed-author-icon {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      margin-right: 8px;
    }

    .embed-author-name {
      font-weight: 600;
      font-size: 14px;
      color: #ffffff;
    }

    .embed-title {
      font-weight: 600;
      font-size: 16px;
      color: #ffffff;
      margin-bottom: 8px;
    }

    .embed-description {
      color: #dcddde;
      font-size: 14px;
      line-height: 1.375;
      margin-bottom: 8px;
      white-space: pre-wrap;
    }

    .embed-fields {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 8px;
      margin-top: 8px;
    }

    .embed-field {
      grid-column: span 12;
      min-width: 0;
    }

    .embed-field-inline {
      grid-column: span 6;
    }

    .embed-field-name {
      font-weight: 600;
      font-size: 14px;
      color: #ffffff;
      margin-bottom: 2px;
    }

    .embed-field-value {
      font-size: 14px;
      color: #dcddde;
      line-height: 1.375;
      white-space: pre-wrap;
    }

    .embed-thumbnail {
      position: absolute;
      top: 12px;
      right: 16px;
      max-width: 80px;
      max-height: 80px;
      border-radius: 4px;
    }

    .embed-footer {
      display: flex;
      align-items: center;
      margin-top: 8px;
      font-size: 12px;
      color: #b9bbbe;
    }

    .embed-footer-icon {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      margin-right: 8px;
    }

    .divider {
      height: 1px;
      background-color: #40444b;
      margin: 20px 0;
    }

    @media (max-width: 768px) {
      .embed-field-inline {
        grid-column: span 12;
      }

      .header-info {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1># ${escapeHtml(ticketData.ticketName)}</h1>
      <div class="header-info">
        <div class="header-info-item">
          <span class="header-info-label">Category:</span>
          <span>${escapeHtml(ticketData.categoryName)}</span>
        </div>
        <div class="header-info-item">
          <span class="header-info-label">Ticket ID:</span>
          <span>#${ticketData.ticketId}</span>
        </div>
        <div class="header-info-item">
          <span class="header-info-label">Opened by:</span>
          <span>${escapeHtml(ticketData.userDisplayName)} (@${escapeHtml(ticketData.userUsername)})</span>
        </div>
        <div class="header-info-item">
          <span class="header-info-label">Opened:</span>
          <span>${openedDate}</span>
        </div>
        <div class="header-info-item">
          <span class="header-info-label">Closed:</span>
          <span>${closedDate}</span>
        </div>
        <div class="header-info-item">
          <span class="header-info-label">Total Messages:</span>
          <span>${messages.length}</span>
        </div>
      </div>
    </div>

    <div class="messages">
      ${messagesHTML}
    </div>
  </div>
</body>
</html>`;
}
