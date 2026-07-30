/**
 * Tailored resume PDF — LLM rewrites structured JSON from resume + JD,
 * then a fixed PDFKit template renders the file (no LLM-authored code).
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import PDFDocument from 'pdfkit';
import { callLLM } from '../core/llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXPORT_DIR = path.join(__dirname, '..', 'tmp', 'resume-exports');
const TTL_MS = 24 * 60 * 60 * 1000;

/** @type {Map<string, { path: string, userId: string|null, createdAt: number, fileName: string }>} */
const registry = new Map();

function ensureExportDir() {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

function metaPathFor(pdfPath) {
  return `${pdfPath}.meta.json`;
}

function pruneExpired() {
  const now = Date.now();
  for (const [id, meta] of registry.entries()) {
    if (now - meta.createdAt > TTL_MS) {
      try {
        fs.unlinkSync(meta.path);
      } catch {
        /* ignore */
      }
      try {
        fs.unlinkSync(metaPathFor(meta.path));
      } catch {
        /* ignore */
      }
      registry.delete(id);
    }
  }

  try {
    if (!fs.existsSync(EXPORT_DIR)) return;
    for (const name of fs.readdirSync(EXPORT_DIR)) {
      if (!name.endsWith('.pdf') || name.startsWith('_build_')) continue;
      const pdfPath = path.join(EXPORT_DIR, name);
      const st = fs.statSync(pdfPath);
      if (now - st.mtimeMs > TTL_MS) {
        try {
          fs.unlinkSync(pdfPath);
        } catch {
          /* ignore */
        }
        try {
          fs.unlinkSync(metaPathFor(pdfPath));
        } catch {
          /* ignore */
        }
        registry.delete(name.replace(/\.pdf$/, ''));
      }
    }
  } catch {
    /* ignore */
  }
}

export function isResumePdfRequest(message) {
  const m = String(message || '').toLowerCase();
  if (!m.trim()) return false;

  const wantsPdf =
    /\b(pdf|docx?)\b/.test(m) ||
    /\b(export|download|generate|create|make|build|produce|render)\b/.test(m);
  const mentionsResume = /\b(resume|cv|curriculum\s*vitae)\b/.test(m);
  const tailor =
    /\b(tailor|customize|customise|rewrite|adapt|target)\b.{0,48}\b(resume|cv)\b/.test(m) ||
    /\b(resume|cv)\b.{0,48}\b(tailor|customize|customise|rewrite|adapt|for\s+(this|the)\s+(job|role|position|jd))\b/.test(
      m
    );
  const mentionsJd =
    /\b(job\s*description|job\s*posting|job\s*req|\bjd\b|role\s*description)\b/.test(m);

  if (mentionsResume && (wantsPdf || tailor)) return true;
  if (mentionsResume && mentionsJd && /\b(update|match|align|optimize|optimise)\b/.test(m)) {
    return true;
  }
  return false;
}

function resolveApiBase(options = {}) {
  const fromOpts = String(options.apiPublicUrl || '').replace(/\/+$/, '');
  if (fromOpts) return fromOpts;
  const env =
    process.env.API_PUBLIC_URL ||
    process.env.PUBLIC_API_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    '';
  return String(env).replace(/\/+$/, '');
}

function buildHistoryContext(history, limit = 16) {
  const rows = Array.isArray(history) ? history.slice(-limit) : [];
  return rows
    .map((h) => {
      const role = h.role === 'assistant' ? 'Assistant' : 'User';
      return `${role}: ${String(h.content || '').slice(0, 6000)}`;
    })
    .join('\n\n');
}

const SCHEMA_HINT = `{
  "name": "Full Name",
  "headline": "Target title aligned to the JD (optional)",
  "email": "",
  "phone": "",
  "location": "City, Region",
  "links": [{"label": "LinkedIn|GitHub|Portfolio", "url": "https://..."}],
  "summary": "3-5 sentence professional summary tailored to the JD. Truthful; emphasize matching strengths.",
  "skills": ["skill1", "skill2"],
  "experience": [{
    "title": "Job title",
    "company": "Company",
    "location": "City or Remote",
    "start": "Mon YYYY",
    "end": "Mon YYYY or Present",
    "bullets": ["Achievement with metrics when possible", "..."]
  }],
  "education": [{
    "school": "University",
    "degree": "Degree / major",
    "year": "YYYY",
    "details": "optional honors/coursework"
  }],
  "projects": [{
    "name": "Project",
    "description": "One line",
    "bullets": ["optional detail"]
  }],
  "notes": "Short plain-text note for chat: what changed for this JD (2-4 lines)."
}`;

async function extractResumeJson(message, history) {
  const historyBlock = buildHistoryContext(history);
  const system = `You are an expert resume writer. Return STRICT JSON only (no markdown fences, no commentary).

Rules:
- Use ONLY facts from the user's resume / background in the message or history. Never invent employers, degrees, dates, or metrics.
- Rephrase bullets and summary to mirror the job description's language and priorities.
- Prefer 3–6 strong bullets per role; drop weak/irrelevant ones.
- Keep skills relevant to the JD; order by relevance.
- If the job description is missing, still produce the best truthful resume JSON and explain that in notes.
- If the resume/background is missing, return JSON with empty name and notes asking for the resume + JD.

Schema:
${SCHEMA_HINT}`;

  const userContent = `Recent conversation (may contain resume and/or JD):
${historyBlock || '(none)'}

Latest user message:
${String(message || '').slice(0, 14000)}

Respond with JSON only.`;

  const raw = await callLLM([{ role: 'user', content: userContent }], system, {
    stream: false,
    includeBasePrompt: false,
  });
  const text = String(raw || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('Model did not return resume JSON');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function cleanStr(v) {
  return String(v || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeResume(data) {
  const d = data && typeof data === 'object' ? data : {};
  return {
    name: cleanStr(d.name),
    headline: cleanStr(d.headline),
    email: cleanStr(d.email),
    phone: cleanStr(d.phone),
    location: cleanStr(d.location),
    links: Array.isArray(d.links)
      ? d.links
          .map((l) => ({ label: cleanStr(l?.label), url: cleanStr(l?.url) }))
          .filter((l) => l.label || l.url)
      : [],
    summary: cleanStr(d.summary),
    skills: Array.isArray(d.skills)
      ? d.skills.map(cleanStr).filter(Boolean).slice(0, 24)
      : [],
    experience: Array.isArray(d.experience)
      ? d.experience
          .map((e) => ({
            title: cleanStr(e?.title),
            company: cleanStr(e?.company),
            location: cleanStr(e?.location),
            start: cleanStr(e?.start),
            end: cleanStr(e?.end),
            bullets: Array.isArray(e?.bullets)
              ? e.bullets.map(cleanStr).filter(Boolean).slice(0, 8)
              : [],
          }))
          .filter((e) => e.title || e.company)
      : [],
    education: Array.isArray(d.education)
      ? d.education
          .map((e) => ({
            school: cleanStr(e?.school),
            degree: cleanStr(e?.degree),
            year: cleanStr(e?.year),
            details: cleanStr(e?.details),
          }))
          .filter((e) => e.school || e.degree)
      : [],
    projects: Array.isArray(d.projects)
      ? d.projects
          .map((p) => ({
            name: cleanStr(p?.name),
            description: cleanStr(p?.description),
            bullets: Array.isArray(p?.bullets)
              ? p.bullets.map(cleanStr).filter(Boolean).slice(0, 5)
              : [],
          }))
          .filter((p) => p.name)
      : [],
    notes: cleanStr(d.notes),
  };
}

function hasEnoughContent(resume) {
  return Boolean(
    resume.name &&
      (resume.experience.length > 0 || resume.summary || resume.skills.length > 0)
  );
}

function drawSectionTitle(doc, title, margin, contentWidth) {
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor('#111111')
    .text(title.toUpperCase(), margin, doc.y, { width: contentWidth });
  const after = doc.y + 2;
  doc
    .moveTo(margin, after)
    .lineTo(margin + contentWidth, after)
    .strokeColor('#333333')
    .lineWidth(0.8)
    .stroke();
  doc.y = after + 8;
}

function ensureSpace(doc, needed, margin, bottom) {
  if (doc.y + needed > bottom) {
    doc.addPage();
    doc.y = margin;
  }
}

function writeBullets(doc, bullets, margin, contentWidth, bottom) {
  for (const b of bullets) {
    ensureSpace(doc, 28, margin, bottom);
    const startY = doc.y;
    doc.font('Helvetica').fontSize(9.5).fillColor('#1a1a1a');
    doc.text('•', margin + 2, startY, { width: 12, lineBreak: false });
    doc.text(b, margin + 16, startY, {
      width: contentWidth - 16,
      align: 'left',
    });
    doc.moveDown(0.12);
  }
}

/**
 * @param {object} resume
 * @param {string} outPath
 */
export function renderResumePdf(resume, outPath) {
  return new Promise((resolve, reject) => {
    ensureExportDir();
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 48, bottom: 48, left: 54, right: 54 },
      info: {
        Title: `${resume.name || 'Resume'} — Resume`,
        Author: resume.name || 'tinyjot',
        Creator: 'tinyjot resume builder',
      },
    });
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);

    const margin = 54;
    const pageWidth = 612;
    const contentWidth = pageWidth - margin * 2;
    const bottom = 792 - 48;

    doc
      .font('Helvetica-Bold')
      .fontSize(20)
      .fillColor('#0a0a0a')
      .text(resume.name || 'Resume', margin, margin, {
        width: contentWidth,
        align: 'center',
      });

    if (resume.headline) {
      doc
        .moveDown(0.15)
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#333333')
        .text(resume.headline, { align: 'center', width: contentWidth });
    }

    const contactBits = [
      resume.email,
      resume.phone,
      resume.location,
      ...resume.links.map((l) => {
        if (l.url && l.label) return `${l.label}: ${l.url}`;
        return l.url || l.label;
      }),
    ].filter(Boolean);

    if (contactBits.length) {
      doc
        .moveDown(0.25)
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor('#444444')
        .text(contactBits.join('  ·  '), { align: 'center', width: contentWidth });
    }

    doc.moveDown(0.85);

    if (resume.summary) {
      drawSectionTitle(doc, 'Summary', margin, contentWidth);
      doc
        .font('Helvetica')
        .fontSize(9.5)
        .fillColor('#1a1a1a')
        .text(resume.summary, { width: contentWidth, align: 'left' });
      doc.moveDown(0.55);
    }

    if (resume.skills.length) {
      ensureSpace(doc, 40, margin, bottom);
      drawSectionTitle(doc, 'Skills', margin, contentWidth);
      doc
        .font('Helvetica')
        .fontSize(9.5)
        .fillColor('#1a1a1a')
        .text(resume.skills.join('  ·  '), { width: contentWidth });
      doc.moveDown(0.55);
    }

    if (resume.experience.length) {
      ensureSpace(doc, 50, margin, bottom);
      drawSectionTitle(doc, 'Experience', margin, contentWidth);

      for (const exp of resume.experience) {
        ensureSpace(doc, 56, margin, bottom);
        const left = [exp.title, exp.company].filter(Boolean).join('  ·  ');
        const right = [exp.start, exp.end].filter(Boolean).join(' – ');
        const rowY = doc.y;

        doc.font('Helvetica-Bold').fontSize(10).fillColor('#111111');
        const leftHeight = doc.heightOfString(left, { width: contentWidth * 0.68 });
        doc.text(left, margin, rowY, { width: contentWidth * 0.68 });

        if (right) {
          doc
            .font('Helvetica')
            .fontSize(9)
            .fillColor('#333333')
            .text(right, margin, rowY, { width: contentWidth, align: 'right' });
        }

        doc.y = Math.max(doc.y, rowY + leftHeight);

        if (exp.location) {
          doc
            .font('Helvetica-Oblique')
            .fontSize(8.5)
            .fillColor('#555555')
            .text(exp.location, margin, doc.y + 1, { width: contentWidth });
        }

        doc.moveDown(0.2);
        writeBullets(doc, exp.bullets, margin, contentWidth, bottom);
        doc.moveDown(0.35);
      }
    }

    if (resume.projects.length) {
      ensureSpace(doc, 40, margin, bottom);
      drawSectionTitle(doc, 'Projects', margin, contentWidth);
      for (const proj of resume.projects) {
        ensureSpace(doc, 36, margin, bottom);
        doc
          .font('Helvetica-Bold')
          .fontSize(10)
          .fillColor('#111111')
          .text(proj.name, { width: contentWidth });
        if (proj.description) {
          doc
            .font('Helvetica')
            .fontSize(9.5)
            .fillColor('#1a1a1a')
            .text(proj.description, { width: contentWidth });
        }
        writeBullets(doc, proj.bullets, margin, contentWidth, bottom);
        doc.moveDown(0.25);
      }
    }

    if (resume.education.length) {
      ensureSpace(doc, 40, margin, bottom);
      drawSectionTitle(doc, 'Education', margin, contentWidth);
      for (const edu of resume.education) {
        ensureSpace(doc, 32, margin, bottom);
        const left = [edu.degree, edu.school].filter(Boolean).join('  ·  ');
        const rowY = doc.y;
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#111111');
        const leftHeight = doc.heightOfString(left, { width: contentWidth * 0.75 });
        doc.text(left, margin, rowY, { width: contentWidth * 0.75 });
        if (edu.year) {
          doc
            .font('Helvetica')
            .fontSize(9)
            .fillColor('#333333')
            .text(edu.year, margin, rowY, { width: contentWidth, align: 'right' });
        }
        doc.y = Math.max(doc.y, rowY + leftHeight);
        if (edu.details) {
          doc
            .font('Helvetica')
            .fontSize(9)
            .fillColor('#333333')
            .text(edu.details, margin, doc.y + 1, { width: contentWidth });
        }
        doc.moveDown(0.35);
      }
    }

    doc.end();
    stream.on('finish', () => resolve(outPath));
    stream.on('error', reject);
    doc.on('error', reject);
  });
}

/**
 * @param {string} pdfPath
 * @param {{ userId?: string|null, baseName?: string }} opts
 */
export function registerExport(pdfPath, opts = {}) {
  pruneExpired();
  ensureExportDir();
  const id = crypto.randomBytes(18).toString('hex');
  const safeBase = String(opts.baseName || 'resume')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 40);
  const fileName = `${safeBase || 'resume'}.pdf`;
  const dest = path.join(EXPORT_DIR, `${id}.pdf`);
  if (path.resolve(pdfPath) !== path.resolve(dest)) {
    fs.copyFileSync(pdfPath, dest);
    try {
      fs.unlinkSync(pdfPath);
    } catch {
      /* keep if unlink fails */
    }
  }
  const meta = {
    path: dest,
    userId: opts.userId || null,
    createdAt: Date.now(),
    fileName,
  };
  registry.set(id, meta);
  try {
    fs.writeFileSync(
      metaPathFor(dest),
      JSON.stringify({
        id,
        userId: meta.userId,
        createdAt: meta.createdAt,
        fileName: meta.fileName,
      })
    );
  } catch {
    /* ignore */
  }
  return { id, fileName };
}

export function getExport(id) {
  pruneExpired();
  const key = String(id || '').replace(/[^a-f0-9]/gi, '');
  if (!key) return null;

  let meta = registry.get(key);
  if (!meta) {
    const pdfPath = path.join(EXPORT_DIR, `${key}.pdf`);
    if (!fs.existsSync(pdfPath)) return null;
    let fileName = 'resume.pdf';
    let userId = null;
    let createdAt = Date.now();
    try {
      const raw = JSON.parse(fs.readFileSync(metaPathFor(pdfPath), 'utf8'));
      fileName = raw.fileName || fileName;
      userId = raw.userId || null;
      createdAt = raw.createdAt || createdAt;
    } catch {
      /* disk-only fallback */
    }
    if (Date.now() - createdAt > TTL_MS) {
      try {
        fs.unlinkSync(pdfPath);
      } catch {
        /* ignore */
      }
      return null;
    }
    meta = { path: pdfPath, userId, createdAt, fileName };
    registry.set(key, meta);
  }

  if (!fs.existsSync(meta.path)) {
    registry.delete(key);
    return null;
  }
  return meta;
}

function removeExportFiles(id, meta) {
  registry.delete(id);
  try {
    if (meta?.path) fs.unlinkSync(meta.path);
  } catch {
    /* ignore */
  }
  try {
    if (meta?.path) fs.unlinkSync(metaPathFor(meta.path));
  } catch {
    /* ignore */
  }
  // Orphan meta / pdf by id
  try {
    const pdfPath = path.join(EXPORT_DIR, `${id}.pdf`);
    if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
  } catch {
    /* ignore */
  }
  try {
    const mp = path.join(EXPORT_DIR, `${id}.pdf.meta.json`);
    if (fs.existsSync(mp)) fs.unlinkSync(mp);
  } catch {
    /* ignore */
  }
}

/**
 * List temp resume PDF artifacts (newest first).
 * @param {{ userId?: string|null }} opts
 */
export function listExports(opts = {}) {
  pruneExpired();
  ensureExportDir();
  const userId = opts.userId || null;
  /** @type {Array<{ id: string, fileName: string, createdAt: number, size: number, url: string }>} */
  const items = [];
  const seen = new Set();

  try {
    for (const name of fs.readdirSync(EXPORT_DIR)) {
      if (!name.endsWith('.pdf') || name.startsWith('_')) continue;
      const id = name.replace(/\.pdf$/, '');
      if (!/^[a-f0-9]+$/i.test(id)) continue;
      const meta = getExport(id);
      if (!meta) continue;
      if (
        userId &&
        meta.userId &&
        String(meta.userId) !== String(userId)
      ) {
        continue;
      }
      let size = 0;
      try {
        size = fs.statSync(meta.path).size;
      } catch {
        size = 0;
      }
      seen.add(id);
      items.push({
        id,
        fileName: meta.fileName || 'resume.pdf',
        createdAt: meta.createdAt || Date.now(),
        size,
        url: `/api/exports/resume/${id}`,
      });
    }
  } catch {
    /* ignore */
  }

  for (const [id, meta] of registry.entries()) {
    if (seen.has(id)) continue;
    if (
      userId &&
      meta.userId &&
      String(meta.userId) !== String(userId)
    ) {
      continue;
    }
    if (!meta?.path || !fs.existsSync(meta.path)) continue;
    let size = 0;
    try {
      size = fs.statSync(meta.path).size;
    } catch {
      size = 0;
    }
    items.push({
      id,
      fileName: meta.fileName || 'resume.pdf',
      createdAt: meta.createdAt || Date.now(),
      size,
      url: `/api/exports/resume/${id}`,
    });
  }

  items.sort((a, b) => b.createdAt - a.createdAt);
  return items;
}

/**
 * @param {string} id
 * @param {{ userId?: string|null }} opts
 */
export function deleteExport(id, opts = {}) {
  const meta = getExport(id);
  if (!meta) return { ok: false, reason: 'not_found' };
  if (
    opts.userId &&
    meta.userId &&
    String(meta.userId) !== String(opts.userId)
  ) {
    return { ok: false, reason: 'forbidden' };
  }
  removeExportFiles(String(id).replace(/[^a-f0-9]/gi, ''), meta);
  return { ok: true };
}

/**
 * Clear temp resume PDFs (optionally scoped to a user).
 * @param {{ userId?: string|null }} opts
 */
export function clearExports(opts = {}) {
  const items = listExports(opts);
  let deleted = 0;
  for (const item of items) {
    const result = deleteExport(item.id, opts);
    if (result.ok) deleted += 1;
  }
  // Also wipe leftover build temps
  try {
    if (fs.existsSync(EXPORT_DIR)) {
      for (const name of fs.readdirSync(EXPORT_DIR)) {
        if (!name.startsWith('_build_')) continue;
        try {
          fs.unlinkSync(path.join(EXPORT_DIR, name));
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  return { ok: true, deleted };
}

/**
 * Full pipeline: extract → render → register.
 */
export async function buildTailoredResumePdf(message, history, options = {}) {
  const extracted = await extractResumeJson(message, history);
  const resume = normalizeResume(extracted);

  if (!hasEnoughContent(resume)) {
    return {
      ok: false,
      reply:
        "I can build a tailored resume PDF, but I need your current resume (or background) plus the job description in the chat.\n\nPaste both, then say something like: **make a tailored resume PDF**.",
    };
  }

  ensureExportDir();
  const tmpId = crypto.randomBytes(8).toString('hex');
  const tmpPath = path.join(EXPORT_DIR, `_build_${tmpId}.pdf`);
  await renderResumePdf(resume, tmpPath);

  const baseName = `${(resume.name || 'resume').split(/\s+/)[0]}_resume`.toLowerCase();
  const { id, fileName } = registerExport(tmpPath, {
    userId: options.userId || null,
    baseName,
  });

  const relativePath = `/api/exports/resume/${id}`;
  const apiBase = resolveApiBase(options);
  const downloadUrl = apiBase ? `${apiBase}${relativePath}` : relativePath;

  const notes = resume.notes
    ? resume.notes
        .split(/\n+/)
        .map((l) => l.replace(/^[-*•]\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 6)
        .map((l) => `- ${l}`)
        .join('\n')
    : '- Summary, skills, and bullets aligned to the job description\n- Only used facts from your provided background';

  const reply = [
    `Here's your tailored resume PDF for **${resume.name}**.`,
    '',
    '**What I adjusted**',
    notes,
    '',
    `[Download resume PDF](${downloadUrl})`,
    '',
    '_Link expires in 24 hours._',
  ].join('\n');

  return {
    ok: true,
    reply,
    downloadUrl,
    downloadPath: relativePath,
    fileName,
    exportId: id,
    resume,
  };
}

export async function handleResumePdf(message, history = [], options = {}) {
  try {
    const result = await buildTailoredResumePdf(message, history, options);
    if (options.onToken && result.reply) options.onToken(result.reply);
    return {
      intent: 'TASK',
      reply: result.reply,
      toolUsed: 'resume-pdf',
      downloadUrl: result.downloadUrl || null,
      downloadPath: result.downloadPath || null,
      fileName: result.fileName || null,
    };
  } catch (err) {
    console.error('[resume-pdf]', err?.message || err);
    const reply =
      "I couldn't generate the resume PDF this time. Please paste your resume and the job description again, then ask me to make a tailored resume PDF.";
    if (options.onToken) options.onToken(reply);
    return {
      intent: 'TASK',
      reply,
      toolUsed: 'resume-pdf',
      downloadUrl: null,
    };
  }
}

export default {
  name: 'resume-pdf',
  description:
    'Tailor a resume to a job description and export a clean ATS-friendly PDF',
  async run(input, ctx = {}) {
    const result = await buildTailoredResumePdf(String(input || ''), ctx.history || [], ctx);
    return {
      answer: result.reply,
      downloadUrl: result.downloadUrl || null,
      fileName: result.fileName || null,
      ok: result.ok !== false,
    };
  },
};
