// Run the in-browser BODtoJSON port on the cases from gen_cases.py and compare
// with BODtoJSON 2.6.0 from PyPI. bod_to_json output strings must be identical;
// errors must have the same type and message (including the rule location).
//
// Usage: node tests/parity/run_parity.js index.html cases.json [path/to/@xmldom/xmldom]
//
// Resolves the engine block from, in order:
//   1) tests/parity/bodtojson_port.js (committed port, preferred for CI)
//   2) /*BODTOJSON_JS_START*/.../*BODTOJSON_JS_END*/ inside the given HTML
//   3) CDN / chunk URL referenced by a bootstrap loader index.html
const fs = require('fs');
const path = require('path');

const [, , htmlPath, casesPath, xmldomPath] = process.argv;
global.DOMParser = require(xmldomPath || '@xmldom/xmldom').DOMParser;

// Avoid regex-literal escaping issues in this file; markers are fixed strings.
const ENGINE_RE = new RegExp(
  '/\\*BODTOJSON_JS_START\\*/([\\s\\S]*?)/\\*BODTOJSON_JS_END\\*/'
);

function extractEngine(text, label) {
  const m = text.match(ENGINE_RE);
  if (!m) {
    console.error('engine block not found in ' + label);
    process.exit(2);
  }
  return m[1];
}

async function loadEngineSource(htmlPath) {
  const portFile = path.join(path.dirname(htmlPath), 'tests', 'parity', 'bodtojson_port.js');
  const portBeside = path.join(__dirname, 'bodtojson_port.js');
  for (const candidate of [portBeside, portFile]) {
    if (fs.existsSync(candidate)) {
      console.log('engine: ' + candidate);
      return extractEngine(fs.readFileSync(candidate, 'utf8'), candidate);
    }
  }

  let html = fs.readFileSync(htmlPath, 'utf8');
  if (ENGINE_RE.test(html)) {
    console.log('engine: embedded in ' + htmlPath);
    return extractEngine(html, htmlPath);
  }

  // Bootstrap loader: fetch the real studio from CDN or local part files
  const cdnMatch = html.match(/https?:\/\/cdn\.jsdelivr\.net\/gh\/[^\s'"`]+/);
  if (cdnMatch) {
    const url = cdnMatch[0].replace(/['"]+$/, '');
    console.log('engine: fetching ' + url);
    const r = await fetch(url);
    if (!r.ok) {
      console.error('CDN fetch failed HTTP ' + r.status);
      process.exit(2);
    }
    return extractEngine(await r.text(), url);
  }

  const partNames = [...html.matchAll(/['"](part\d+\.txt)['"]/g)].map(m => m[1]);
  if (partNames.length) {
    const dir = path.dirname(path.resolve(htmlPath));
    console.log('engine: joining chunk parts from ' + dir);
    const chunks = partNames.map(p => {
      const fp = path.join(dir, p);
      if (!fs.existsSync(fp)) {
        console.error('missing chunk ' + fp);
        process.exit(2);
      }
      return fs.readFileSync(fp, 'utf8');
    });
    return extractEngine(chunks.join(''), 'chunk parts');
  }

  console.error('engine block not found (index.html is a loader with no CDN/parts and no bodtojson_port.js)');
  process.exit(2);
}

(async () => {
  const engineSrc = await loadEngineSource(htmlPath);
  const B = new Function(engineSrc + '\nreturn BODtoJSONjs;')();
  const { xmls, cases, reverse } = JSON.parse(fs.readFileSync(casesPath, 'utf8'));

  function same(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a === b || (Number.isNaN(a) && Number.isNaN(b));
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    if (!Array.isArray(a) && ka.join('\u0000') !== kb.join('\u0000')) return false;
    return ka.every(k => same(a[k], b[k]));
  }
  function normErr(msg) { return String(msg).replace(/^(Rules are not valid JSON:).*$/s, '$1'); }
  function result(fn) {
    try { return { ok: fn() }; } catch (e) { return { err: e.name, msg: e.message }; }
  }
  function check(exp, got) {
    if ('ok' in exp) return 'ok' in got && same(exp.ok, got.ok);
    return 'err' in got && got.err === exp.err && normErr(got.msg) === normErr(exp.msg);
  }
  let fail = 0, okCount = 0, errCount = 0, crash = 0;
  // Python-internal crashes (TypeError/AttributeError/...) on malformed rules are
  // not part of the documented behaviour; the port raises a clean error instead.
  const PY_CRASH = new Set(['TypeError', 'AttributeError', 'KeyError', 'IndexError']);
  cases.forEach((c, i) => {
    const o = c.opts;
    const got = result(() => B.bodToJson(xmls[c.xml], c.rules, null, { single: !!o.single, missing: 'missing' in o ? o.missing : null }));
    if (PY_CRASH.has(c.expected.err)) { crash++; return; }
    if (check(c.expected, got)) { if ('ok' in c.expected) okCount++; else errCount++; return; }
    if (fail++ < 8) console.log('MISMATCH case', i, JSON.stringify(c.rules).slice(0, 600), '\n  expected', JSON.stringify(c.expected).slice(0, 600), '\n  got     ', JSON.stringify(got).slice(0, 600));
  });
  const stamp = s => String(s).replace(/<CreationDateTime>[^<]*<\/CreationDateTime>/g, '<CreationDateTime/>');
  reverse.forEach((r, i) => {
    const kw = r.kw, opts = {};
    const map = { rules: 'rules', release_id: 'releaseId', version_id: 'versionId', action_code: 'actionCode', namespace: 'namespace', pretty: 'pretty', xml_declaration: 'xmlDeclaration', include_application_area: 'includeApplicationArea' };
    for (const k of Object.keys(kw)) if (map[k]) opts[map[k]] = kw[k];
    const got = result(() => B.jsonToBod(r.data, kw.verb || 'Sync', kw.noun || null, opts));
    const exp = r.expected;
    const good = 'ok' in exp ? ('ok' in got && stamp(got.ok) === stamp(exp.ok)) : ('err' in got && got.err === exp.err && got.msg === exp.msg);
    if (good) { okCount++; return; }
    if (fail++ < 12) console.log('MISMATCH reverse', i, '\n  expected', JSON.stringify(exp).slice(0, 900), '\n  got     ', JSON.stringify(got).slice(0, 900));
  });
  console.log(`parity: ${cases.length + reverse.length} cases, ${okCount} matching results, ${errCount} matching errors, ${crash} skipped (Python internal crash on malformed rules), ${fail} mismatches`);
  process.exit(fail ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(2);
});
