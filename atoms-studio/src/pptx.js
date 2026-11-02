import fs from 'node:fs';
import path from 'node:path';
import PptxGenJS from 'pptxgenjs';
import { DATA_DIR } from './db.js';

const FONT = process.env.PPTX_FONT || 'PingFang SC';
const INK = '171614';
const PAPER = 'F8F5EF';
const MUTED = '6F6A61';

function hex(color, fallback = '5B5BD6') {
  const clean = String(color || '').replace('#', '').toUpperCase();
  return /^[0-9A-F]{6}$/.test(clean) ? clean : fallback;
}

function splitTitle(title, max = 16) {
  const text = String(title || '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export async function buildPptx({ artifact, project, shotFile = null }) {
  const deck = artifact.content?.deck || {};
  const slides = Array.isArray(deck.slides) ? deck.slides : [];
  const accent = hex(artifact.content?.accent || project.accent);
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Atoms Studio';
  pptx.company = 'Atoms Studio Demo';
  pptx.subject = `${project.name} · 演示幻灯片`;
  pptx.title = deck.title || project.name;
  pptx.lang = 'zh-CN';
  pptx.theme = {
    headFontFace: FONT,
    bodyFontFace: FONT,
    lang: 'zh-CN',
  };

  slides.forEach((slide, index) => {
    const s = pptx.addSlide();
    const layout = slide.layout || (index === 0 ? 'cover' : 'points');
    const kicker = String(slide.kicker || '').trim();
    const title = String(slide.title || '').trim();
    const bullets = Array.isArray(slide.bullets) ? slide.bullets.filter(Boolean) : [];

    if (layout === 'cover') {
      s.background = { color: INK };
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.28, h: 7.5, fill: { color: accent } });
      s.addText(kicker || 'ATOMS STUDIO', {
        x: 0.9,
        y: 0.72,
        w: 6.4,
        h: 0.4,
        fontFace: FONT,
        fontSize: 11,
        color: 'B9B3A8',
        charSpacing: 2,
      });
      s.addText(splitTitle(title || deck.title || project.name, 20), {
        x: 0.86,
        y: 2.2,
        w: 6.3,
        h: 2.1,
        fontFace: FONT,
        fontSize: 44,
        bold: true,
        color: 'FFFFFF',
        breakLine: false,
        valign: 'top',
      });
      s.addText(deck.subtitle || project.summary || '', {
        x: 0.9,
        y: 4.55,
        w: 5.8,
        h: 1.1,
        fontFace: FONT,
        fontSize: 16,
        color: 'CFC9BE',
        lineSpacingMultiple: 1.2,
      });
      if (shotFile && fs.existsSync(shotFile)) {
        s.addImage({
          path: shotFile,
          x: 7.55,
          y: 1.0,
          w: 5.1,
          h: 5.3,
          sizing: { type: 'cover', w: 5.1, h: 5.3 },
        });
        s.addShape(pptx.ShapeType.rect, {
          x: 7.55,
          y: 1.0,
          w: 5.1,
          h: 5.3,
          fill: { color: '000000', transparency: 100 },
          line: { color: '3A3732', width: 1 },
        });
      } else {
        s.addShape(pptx.ShapeType.ellipse, { x: 8.1, y: 1.65, w: 4.0, h: 4.0, fill: { color: accent, transparency: 22 }, line: { color: accent, transparency: 100 } });
        s.addText(artifact.content?.emoji || project.emoji || '✦', { x: 8.1, y: 2.6, w: 4.0, h: 2.0, align: 'center', fontSize: 72, color: 'FFFFFF' });
      }
      s.addText('Atoms Studio · 智能体驱动生成', {
        x: 0.9,
        y: 6.85,
        w: 5,
        h: 0.3,
        fontFace: FONT,
        fontSize: 9,
        color: '7D776D',
      });
    } else if (layout === 'quote') {
      s.background = { color: accent };
      s.addText(kicker || 'INSIGHT', {
        x: 0.9,
        y: 0.8,
        w: 8,
        h: 0.4,
        fontFace: FONT,
        fontSize: 11,
        color: 'FFFFFF',
        charSpacing: 2,
        transparency: 25,
      });
      s.addText(`“${title}”`, {
        x: 0.9,
        y: 2.0,
        w: 11.4,
        h: 2.8,
        fontFace: FONT,
        fontSize: 32,
        bold: true,
        color: 'FFFFFF',
        valign: 'mid',
        lineSpacingMultiple: 1.25,
      });
      s.addShape(pptx.ShapeType.rect, { x: 0.92, y: 5.25, w: 1.2, h: 0.06, fill: { color: 'FFFFFF' } });
      s.addText(project.name, {
        x: 0.92,
        y: 5.5,
        w: 6,
        h: 0.4,
        fontFace: FONT,
        fontSize: 13,
        color: 'FFFFFF',
      });
    } else if (layout === 'closing') {
      s.background = { color: INK };
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 7.1, w: 13.333, h: 0.4, fill: { color: accent } });
      s.addText(kicker || 'THANK YOU', {
        x: 0.9,
        y: 1.0,
        w: 8,
        h: 0.4,
        fontFace: FONT,
        fontSize: 11,
        color: accent,
        charSpacing: 2,
      });
      s.addText(title || '谢谢观看', {
        x: 0.86,
        y: 2.3,
        w: 11.2,
        h: 1.7,
        fontFace: FONT,
        fontSize: 40,
        bold: true,
        color: 'FFFFFF',
      });
      if (bullets.length) {
        s.addText(
          bullets.map((line) => ({ text: String(line), options: { bullet: { code: '25CF' }, color: 'CFC9BE', fontSize: 15, breakLine: true } })),
          { x: 0.95, y: 4.5, w: 9.5, h: 1.4, fontFace: FONT },
        );
      }
      s.addText('Atoms Studio', { x: 0.95, y: 6.6, w: 5, h: 0.3, fontFace: FONT, fontSize: 10, color: '7D776D' });
    } else {
      s.background = { color: PAPER };
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.22, h: 7.5, fill: { color: accent } });
      s.addText(kicker || `0${index}`, {
        x: 0.8,
        y: 0.55,
        w: 9,
        h: 0.35,
        fontFace: FONT,
        fontSize: 10,
        color: accent,
        charSpacing: 1.5,
      });
      s.addText(title, {
        x: 0.78,
        y: 1.05,
        w: 11.6,
        h: 1.15,
        fontFace: FONT,
        fontSize: 30,
        bold: true,
        color: INK,
        valign: 'top',
      });
      s.addShape(pptx.ShapeType.rect, { x: 0.8, y: 2.3, w: 1.1, h: 0.06, fill: { color: accent } });
      if (bullets.length) {
        s.addText(
          bullets.map((line) => ({
            text: String(line),
            options: { bullet: { code: '25CF' }, color: INK, fontSize: 18, breakLine: true, paraSpaceAfter: 14 },
          })),
          { x: 0.78, y: 2.7, w: 10.8, h: 3.7, fontFace: FONT, lineSpacingMultiple: 1.15, valign: 'top' },
        );
      }
      s.addText(`${String(index + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`, {
        x: 11.2,
        y: 6.95,
        w: 1.3,
        h: 0.3,
        fontFace: FONT,
        fontSize: 9,
        color: MUTED,
        align: 'right',
      });
      s.addText('Atoms Studio', {
        x: 0.8,
        y: 6.95,
        w: 5,
        h: 0.3,
        fontFace: FONT,
        fontSize: 9,
        color: MUTED,
      });
    }

    if (slide.note) s.addNotes(String(slide.note));
  });

  const exportDir = path.join(DATA_DIR, 'exports');
  fs.mkdirSync(exportDir, { recursive: true });
  const file = path.join(exportDir, `${artifact.id}.pptx`);
  await pptx.writeFile({ fileName: file });
  return file;
}
