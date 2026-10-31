/* ═══════════════════════════════════════════════════════════════════
   xlsx.js — 手写最小 .xlsx 读取器（零依赖，不外传任何数据）

   为什么自己写：项目原则是不引第三方库（qr.js 同款理由）——离线可用、
   数据不出设备、面试时能讲清楚每一行。xlsx 本质是 zip 包 + XML：
     1. 解析 zip 中央目录，找到要的几个 XML
     2. deflate-raw 解压（浏览器原生 DecompressionStream）
     3. DOMParser 解析 XML，拼出行列
   只读不写，只支持本项目要的「行列文本值」，样式/公式/合并单元格不碰。

   用法：
     const buf = await file.arrayBuffer();
     const wb = await XGYXlsx.read(buf);        // { sheets: [{ name, rows }] }
     // rows 是二维数组（0-based），空格子是 ''，数字是 number
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── zip：从 ArrayBuffer 里掏出指定文件 ── */
  function u16(v, o) { return v.getUint16(o, true); }
  function u32(v, o) { return v.getUint32(o, true); }

  // 在尾部找 End of Central Directory（签名 0x06054b50），最多扫最后 64KB+22
  function findEOCD(view) {
    const min = Math.max(0, view.byteLength - (0xffff + 22));
    for (let o = view.byteLength - 22; o >= min; o--) {
      if (u32(view, o) === 0x06054b50) return o;
    }
    return -1;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('这台设备的浏览器太旧，解不了表格文件');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // 列出 zip 里所有条目：[{ name, method, data }]
  async function zipEntries(buf) {
    const view = new DataView(buf);
    const eocd = findEOCD(view);
    if (eocd < 0) throw new Error('不是有效的表格文件（zip 头不对）');
    const count = u16(view, eocd + 10);
    let ptr = u32(view, eocd + 16); // 中央目录起始偏移
    const u8 = new Uint8Array(buf);
    const out = [];
    for (let i = 0; i < count; i++) {
      if (u32(view, ptr) !== 0x02014b50) break; // 中央目录文件头
      const method = u16(view, ptr + 10);
      const compSize = u32(view, ptr + 20);
      const nameLen = u16(view, ptr + 28);
      const extraLen = u16(view, ptr + 30);
      const cmtLen = u16(view, ptr + 32);
      const localOff = u32(view, ptr + 42);
      const name = new TextDecoder().decode(u8.subarray(ptr + 46, ptr + 46 + nameLen));
      // local file header 里的名字/extra 长度可能与中央目录不同，按它自己的来
      const lNameLen = u16(view, localOff + 26);
      const lExtraLen = u16(view, localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const raw = u8.subarray(dataStart, dataStart + compSize);
      let data;
      if (method === 0) {
        data = raw;
      } else if (method === 8) {
        try { data = await inflateRaw(raw); } catch (e) { data = null; }
      } else {
        data = null;
      }
      out.push({ name, data });
      ptr += 46 + nameLen + extraLen + cmtLen;
    }
    return out;
  }

  /* ── XML 解析（浏览器自带 DOMParser，同步够用） ── */
  function parseXML(text) {
    return new DOMParser().parseFromString(text, 'text/xml');
  }

  // 'BC12' → 列号 54（0-based）；解析失败返回大数（当垃圾丢到行尾）
  function colFromRef(ref) {
    const m = /^([A-Z]+)/.exec(String(ref || ''));
    if (!m) return 9999;
    let n = 0;
    for (let i = 0; i < m[1].length; i++) n = n * 26 + (m[1].charCodeAt(i) - 64);
    return n - 1;
  }

  // sharedStrings：每个 <si> 拼接其中所有 <t>（富文本多段 run）
  function readSharedStrings(xml) {
    const arr = [];
    const sis = xml.getElementsByTagName('si');
    for (let i = 0; i < sis.length; i++) {
      const ts = sis[i].getElementsByTagName('t');
      let s = '';
      for (let j = 0; j < ts.length; j++) s += ts[j].textContent || '';
      arr.push(s);
    }
    return arr;
  }

  // sheet XML → 二维数组。按单元格 r 属性落位，跳过空格子
  function readSheet(xml, shared) {
    const rowsEl = xml.getElementsByTagName('row');
    const rows = [];
    for (let i = 0; i < rowsEl.length; i++) {
      const rAttr = parseInt(rowsEl[i].getAttribute('r'), 10);
      const ri = (isNaN(rAttr) ? rows.length : rAttr - 1);
      const cs = rowsEl[i].getElementsByTagName('c');
      for (let j = 0; j < cs.length; j++) {
        const c = cs[j];
        const col = colFromRef(c.getAttribute('r'));
        const t = c.getAttribute('t');
        let val = '';
        if (t === 'inlineStr') {
          const ts = c.getElementsByTagName('t');
          for (let k = 0; k < ts.length; k++) val += ts[k].textContent || '';
        } else {
          const vEl = c.getElementsByTagName('v')[0];
          if (!vEl) continue;
          const raw = vEl.textContent || '';
          if (t === 's') val = shared[parseInt(raw, 10)] ?? '';
          else if (t === 'b') val = raw === '1' ? 'TRUE' : 'FALSE';
          else if (t === 'e') val = '#ERR';
          else {
            const num = Number(raw);
            // 整数就去掉小数尾巴（Excel 把 25 存成 25），别让号码变成 "25"
            val = Number.isFinite(num) && /^-?\d+(\.0+)?$/.test(raw) ? String(Math.round(num)) : raw;
          }
        }
        while (rows.length <= ri) rows.push([]);
        rows[ri][col] = val;
      }
    }
    // 补齐空洞
    for (const r of rows) for (let k = 0; k < r.length; k++) if (r[k] === undefined) r[k] = '';
    return rows;
  }

  /* ── 主入口 ── */
  async function read(buf) {
    const entries = await zipEntries(buf);
    const byName = {};
    entries.forEach((e) => { byName[e.name.replace(/^\//, '')] = e; });

    const wbEntry = byName['xl/workbook.xml'];
    if (!wbEntry || !wbEntry.data) throw new Error('表格里没有工作表数据');
    const wb = parseXML(new TextDecoder().decode(wbEntry.data));

    // rId → 文件路径
    const rels = {};
    const relEntry = byName['xl/_rels/workbook.xml.rels'];
    if (relEntry && relEntry.data) {
      const relXml = parseXML(new TextDecoder().decode(relEntry.data));
      const rs = relXml.getElementsByTagName('Relationship');
      for (let i = 0; i < rs.length; i++) {
        rels[rs[i].getAttribute('Id')] = rs[i].getAttribute('Target');
      }
    }

    let shared = [];
    const ssEntry = byName['xl/sharedStrings.xml'];
    if (ssEntry && ssEntry.data) shared = readSharedStrings(parseXML(new TextDecoder().decode(ssEntry.data)));

    const sheets = [];
    const shEls = wb.getElementsByTagName('sheet');
    for (let i = 0; i < shEls.length; i++) {
      const name = shEls[i].getAttribute('name') || `表${i + 1}`;
      const rid = shEls[i].getAttribute('r:id') || shEls[i].getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      let target = rels[rid] || `worksheets/sheet${i + 1}.xml`;
      if (target.startsWith('/')) target = target.slice(1);
      else if (!target.startsWith('xl/')) target = 'xl/' + target;
      const entry = byName[target];
      if (!entry || !entry.data) { sheets.push({ name, rows: [] }); continue; }
      const xml = parseXML(new TextDecoder().decode(entry.data));
      sheets.push({ name, rows: readSheet(xml, shared) });
    }
    if (!sheets.length) throw new Error('表格里没有工作表');
    return { sheets };
  }

  window.XGYXlsx = { read };
})();
