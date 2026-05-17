const { useMemo } = React;

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatInline(text) {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
}

function parseTableRow(line) {
  return line
    .split('|')
    .map((c) => c.trim())
    .filter((c, i, arr) => {
      if (i === 0 && !c) return false;
      if (i === arr.length - 1 && !c) return false;
      return Boolean(c);
    });
}

function isTableRow(line) {
  const t = line.trim();
  if (!t.includes('|')) return false;
  return parseTableRow(line).length >= 2;
}

function isTableSeparator(line) {
  const t = line.trim();
  if (!t.includes('-')) return false;
  if (/https?:\/\//.test(t)) return false;
  return /^[\|\s\-:–—]+$/.test(t);
}

function renderTable(lines) {
  const headers = parseTableRow(lines[0]);
  let dataStart = 1;
  if (lines[1] && isTableSeparator(lines[1])) dataStart = 2;

  const rows = lines.slice(dataStart).filter((l) => isTableRow(l)).map(parseTableRow);
  if (!headers.length || !rows.length) return null;

  let html = '<div class="msg-table-wrap"><table class="msg-table"><thead><tr>';
  headers.forEach((h) => {
    html += `<th>${formatInline(escapeHtml(h))}</th>`;
  });
  html += '</tr></thead><tbody>';
  rows.forEach((row) => {
    html += '<tr>';
    for (let c = 0; c < headers.length; c++) {
      html += `<td>${formatInline(escapeHtml(row[c] ?? ''))}</td>`;
    }
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

function isSectionLabel(line) {
  const t = line.trim();
  if (!t.endsWith(':') || t.length > 48) return false;
  return /^(output|stderr|result)/i.test(t) || (t.length < 32 && /^[A-Za-z][^:]*:$/.test(t));
}

function isNoteLine(line) {
  const t = line.trim();
  return (
    /^stored in mongodb/i.test(t) ||
    /^script path:/i.test(t) ||
    /^script saved on disk/i.test(t) ||
    /^removed state files:/i.test(t) ||
    /^active schedules:/i.test(t) ||
    /^script \"/i.test(t)
  );
}

function formatLineBlock(text) {
  const lines = text.split('\n');
  let html = '';
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (!trimmed) {
      i++;
      continue;
    }

    if (
      isTableRow(trimmed) &&
      (i + 1 >= lines.length ||
        isTableRow(lines[i + 1]?.trim()) ||
        isTableSeparator(lines[i + 1]?.trim()))
    ) {
      const tableLines = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        if (!t) break;
        if (isTableRow(t) || isTableSeparator(t)) {
          tableLines.push(t);
          i++;
        } else break;
      }
      const tableHtml = renderTable(tableLines);
      if (tableHtml) {
        html += tableHtml;
        continue;
      }
    }

    if (isSectionLabel(trimmed)) {
      html += `<div class="msg-heading">${formatInline(escapeHtml(trimmed))}</div>`;
      i++;
      continue;
    }

    if (isNoteLine(trimmed)) {
      html += `<p class="msg-note">${formatInline(escapeHtml(trimmed))}</p>`;
      i++;
      continue;
    }

    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isTableRow(lines[i].trim()) &&
      !isSectionLabel(lines[i].trim())
    ) {
      para.push(lines[i].trim());
      i++;
    }
    if (para.length) {
      html += `<p class="msg-p">${formatInline(escapeHtml(para.join(' ')))}</p>`;
    }
  }

  return html;
}

function formatCodeBlock(code, lang) {
  const label = lang ? `<span class="msg-code-lang">${escapeHtml(lang)}</span>` : '';
  return `<div class="msg-code-block">${label}<pre><code>${escapeHtml(code.trim())}</code></pre></div>`;
}

function formatContent(text) {
  if (!text) return '';

  const chunks = [];
  const re = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0;
  let match;

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      chunks.push({ type: 'text', value: text.slice(last, match.index) });
    }
    chunks.push({ type: 'code', lang: match[1], value: match[2] });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    chunks.push({ type: 'text', value: text.slice(last) });
  }
  if (!chunks.length) {
    chunks.push({ type: 'text', value: text });
  }

  return chunks
    .map((chunk) => {
      if (chunk.type === 'code') return formatCodeBlock(chunk.value, chunk.lang);
      return formatLineBlock(chunk.value);
    })
    .join('');
}

function MessageBubble({ message, grouped, groupStart, groupEnd }) {
  if (!message.content) return null;

  const html = useMemo(
    () => formatContent(message.content),
    [message.content]
  );

  const isRich = useMemo(
    () =>
      message.role === 'assistant' &&
      (html.includes('msg-table') || html.includes('msg-code-block')),
    [message.role, html]
  );

  const isUser = message.role === 'user';
  const intentIcon = message.intent ? INTENT_ICON[message.intent] : null;

  const rowClass = [
    'message-row',
    message.role,
    isRich ? 'message-row--rich' : '',
    grouped ? 'grouped' : '',
    groupStart ? 'group-start' : '',
    groupEnd ? 'group-end' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const body = (
    <div className="message-body">
      <div
        className={`message-bubble${isRich ? ' message-bubble--rich' : ''}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {!isUser && (message.intent || message.toolUsed) && (
        <div className="message-meta">
          {message.intent && (
            <span className="intent-pill">
              {intentIcon && <Icon name={intentIcon} size={12} />}
              {message.intent}
            </span>
          )}
          {message.toolUsed && (
            <span className="tool-pill">{message.toolUsed}</span>
          )}
        </div>
      )}
    </div>
  );

  if (isUser) {
    return <div className={rowClass}>{body}</div>;
  }

  const showAvatar = !grouped || groupEnd;
  const avatar = showAvatar ? (
    <div className="msg-avatar" aria-hidden="true">
      <Icon name="bot" size={14} />
    </div>
  ) : (
    <div className="msg-avatar-spacer" aria-hidden="true" />
  );

  return (
    <div className={rowClass}>
      {avatar}
      {body}
    </div>
  );
}

window.MessageBubble = MessageBubble;
