// Drive index.html in headless Chromium: load the sample BOD and OpenAPI spec,
// map fields (paths, merges, IF/CASE, nested repeats), generate the outbound
// and inbound ION scripts and run the in-app previews. verify.py then runs the
// same scripts with BODtoJSON 2.6.0 and compares.
// Usage: node tests/e2e/e2e.js index.html tests/e2e/out.json
//
// If index.html is a bootstrap loader (CDN / chunk parts), resolve the real
// studio to a temp file first so Playwright is not blocked by file:// fetch CORS.
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const os = require('os');
const FIX = path.join(__dirname, '..', 'parity', 'fixtures');

async function resolveStudioHtml(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  if (html.includes('id="mapperContainer"') || html.includes("id='mapperContainer'") || html.includes('id="bodFile"')) {
    return path.resolve(htmlPath);
  }
  const cdnMatch = html.match(/https?:\/\/cdn\.jsdelivr\.net\/gh\/[^\s'"`]+/);
  if (cdnMatch) {
    const url = cdnMatch[0].replace(/['"]+$/, '');
    console.log('e2e: fetching studio from', url);
    const r = await fetch(url);
    if (!r.ok) throw new Error('CDN fetch failed HTTP ' + r.status);
    const full = await r.text();
    const tmp = path.join(os.tmpdir(), 'bizzOS-studio-e2e.html');
    fs.writeFileSync(tmp, full);
    return tmp;
  }
  const partNames = [...html.matchAll(/['"](part\d+\.txt)['"]/g)].map(m => m[1]);
  if (partNames.length) {
    const dir = path.dirname(path.resolve(htmlPath));
    const full = partNames.map(p => fs.readFileSync(path.join(dir, p), 'utf8')).join('');
    const tmp = path.join(os.tmpdir(), 'bizzOS-studio-e2e.html');
    fs.writeFileSync(tmp, full);
    return tmp;
  }
  return path.resolve(htmlPath);
}

(async () => {
  const studioPath = await resolveStudioHtml(process.argv[2]);
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => { errors.push('dialog: ' + d.message()); d.dismiss(); });
  await page.goto('file://' + studioPath);

  await page.waitForFunction(() => {
    return !!(
      document.getElementById('mapperContainer') ||
      document.getElementById('bodFile') ||
      document.querySelector('#tab-outbound, .mapper-split-container, #mainWorkspace')
    );
  }, { timeout: 60000 });

  await page.setInputFiles('#bodFile', path.join(FIX, 'sync_PO_lines.xml'));
  await page.waitForFunction(() => typeof bodXmlDoc !== 'undefined' && bodXmlDoc);
  await page.setInputFiles('#swaggerFile', path.join(__dirname, 'openapi_purchase_orders.json'));
  await page.waitForFunction(() => document.querySelectorAll('#mapperContainer .mapping-input').length > 0);
  const R = 'SyncPurchaseOrder.DataArea.';
  const result = await page.evaluate((R) => {
    const set = (t, v) => { const el = document.querySelector(`#mapperContainer .mapping-input[data-target="${t}"]`); if (!el) throw new Error('no input ' + t); el.value = v; };
    const arr = (a, v) => { document.querySelector(`#mapperContainer .array-repeat-input[data-array="${a}"]`).value = v; };
    document.getElementById('objectName').value = 'CoAMed';
    set('externalSystemId', `{${R}Sync.AccountingEntityID}_{${R}PurchaseOrder.PurchaseOrderHeader.DisplayID}`);
    set('isActive', 'true');
    set('companyId', `company[{${R}Sync.AccountingEntityID}]`);
    set('amount', `${R}PurchaseOrder.PurchaseOrderHeader.ExtendedAmount`);
    set('currencyCode', `${R}PurchaseOrder.PurchaseOrderHeader.ExtendedAmount.@currencyID`);
    set('orderIdentifier', `{${R}PurchaseOrder.PurchaseOrderHeader.DisplayID}`);
    set('registerDate', `${R}PurchaseOrder.PurchaseOrderHeader.OrderDateTime`);
    set('supplier', `${R}PurchaseOrder.PurchaseOrderHeader.SupplierParty.PartyIDs.ID`);
    outboundRules['status'] = { branches: [
      { field: `${R}PurchaseOrder.PurchaseOrderHeader.Status.Code`, op: '==', compareVal: 'Open', resultVal: 'ACTIVE' },
      { field: `${R}PurchaseOrder.PurchaseOrderHeader.ExtendedAmount`, op: '>', compareVal: '1000', resultVal: `{${R}PurchaseOrder.PurchaseOrderHeader.DisplayID}` } ], elseVal: 'INACTIVE_x' };
    arr('purchaseOrderLines', 'PurchaseOrderLine');
    set('purchaseOrderLines[].externalSystemId', `{${R}Sync.AccountingEntityID}_{${R}PurchaseOrder.PurchaseOrderHeader.DisplayID}_{${R}PurchaseOrder.PurchaseOrderLine.LineNumber}`);
    set('purchaseOrderLines[].lineNumber', `${R}PurchaseOrder.PurchaseOrderLine.LineNumber`);
    set('purchaseOrderLines[].quantity', `${R}PurchaseOrder.PurchaseOrderLine.Quantity`);
    set('purchaseOrderLines[].unit', `${R}PurchaseOrder.PurchaseOrderLine.Quantity.@unitCode`);
    outboundRules['purchaseOrderLines[].size'] = { branches: [
      { field: `${R}PurchaseOrder.PurchaseOrderLine.ExtendedAmount`, op: '>', compareVal: '400', resultVal: 'big' },
      { field: `${R}PurchaseOrder.PurchaseOrderLine.Item.ID`, op: 'startsWith', compareVal: 'ITEM-C', resultVal: 'c-item' },
      { field: `${R}PurchaseOrder.PurchaseOrderLine.Note`, op: 'isEmpty', compareVal: '', resultVal: 'small' } ], elseVal: '' };
    arr('purchaseOrderLines[].codingLines', 'CodingLine');
    set('purchaseOrderLines[].codingLines[].account', `${R}PurchaseOrder.PurchaseOrderLine.CodingLine.Account`);
    set('purchaseOrderLines[].codingLines[].percentage', `${R}PurchaseOrder.PurchaseOrderLine.CodingLine.Percentage`);
    set('purchaseOrderLines[].codingLines[].line', `{${R}PurchaseOrder.PurchaseOrderLine.LineNumber}`);
    updateGenerators();
    const script = document.getElementById('pythonInput').value;
    simulatePython();
    const preview = document.getElementById('pythonOutput').value;
    document.getElementById('ionMissingMode').value = 'empty'; setIonMissingMode('empty');
    const scriptEmpty = document.getElementById('pythonInput').value;
    const previewEmpty = document.getElementById('pythonOutput').value;
    const inSet = (path, v) => { const els = document.querySelectorAll(`.inbound-mapping-input[data-inbound-target="${path}"]`); if (!els.length) throw new Error('no inbound ' + path); els[0].value = v; };
    inSet(`SyncPurchaseOrder.DataArea.PurchaseOrder.PurchaseOrderHeader.DisplayID`, '{orderIdentifier}');
    inSet(`SyncPurchaseOrder.DataArea.PurchaseOrder.PurchaseOrderHeader.ExtendedAmount`, '{amount}');
    inSet(`SyncPurchaseOrder.DataArea.PurchaseOrder.PurchaseOrderHeader.ExtendedAmount.@currencyID`, '{currencyCode}');
    inSet(`SyncPurchaseOrder.DataArea.Sync.AccountingEntityID`, '{companyId}');
    inSet(`SyncPurchaseOrder.DataArea.PurchaseOrder.PurchaseOrderHeader.SupplierParty.Name`, 'Supplier {supplier} & <co>');
    inboundRules['SyncPurchaseOrder.DataArea.PurchaseOrder.PurchaseOrderHeader.Status.Code'] = { branches: [
      { field: '{isActive}', op: '==', compareVal: 'Mock_ISACTIVE', resultVal: 'Open' } ], elseVal: 'Closed' };
    updateInboundGenerators();
    const inScript = document.getElementById('inboundPythonInput').value;
    simulateInbound();
    const inPreview = document.getElementById('inboundPythonOutput').value;
    const sample = buildInboundSampleJson();
    return { script, preview, scriptEmpty, previewEmpty, inScript, inPreview, sample };
  }, R);
  const userScript = fs.readFileSync(path.join(FIX, 'ion_script.py'), 'utf8');
  const userPreview = await page.evaluate((s) => { document.getElementById('pythonInput').value = s; simulatePython(); return document.getElementById('pythonOutput').value; }, userScript);
  const badPreview = await page.evaluate(() => { const t = document.getElementById('pythonInput'); t.value = t.value.replace('"repeat": "CodingLine_*"', '"repeat": "CodingLine"'); simulatePython(); return document.getElementById('pythonOutput').value; });
  result.userPreview = userPreview; result.badPreview = badPreview; result.errors = errors;
  fs.writeFileSync(process.argv[3], JSON.stringify(result, null, 2));
  await browser.close();
  console.log('page errors:', errors.length ? errors : 'none');
  if (errors.length) process.exit(1);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
