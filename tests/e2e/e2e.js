// Drive index.html in headless Chromium: load the sample BOD and OpenAPI spec,
// map fields (paths, merges, IF/CASE, nested repeats), generate the outbound
// and inbound ION scripts and run the in-app previews. verify.py then runs the
// same scripts with BODtoJSON 2.6.0 and compares.
// Usage: node tests/e2e/e2e.js index.html tests/e2e/out.json
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const FIX = path.join(__dirname, '..', 'parity', 'fixtures');
(async () => {
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => { errors.push('dialog: ' + d.message()); d.dismiss(); });
  await page.goto('file://' + path.resolve(process.argv[2]));
  await page.setInputFiles('#bodFile', path.join(FIX, 'sync_PO_lines.xml'));
  await page.waitForFunction(() => typeof bodXmlDoc !== 'undefined' && bodXmlDoc);
  await page.setInputFiles('#swaggerFile', path.join(__dirname, 'openapi_purchase_orders.json'));
  await page.waitForFunction(() => document.querySelectorAll('#mapperContainer .mapping-input').length > 0);
  const R = 'SyncPurchaseOrder.DataArea.';
  const result = await page.evaluate((R) => {
    const set = (t, v) => { const el = document.querySelector(`#mapperContainer .mapping-input[data-target="${t}"]`); if (!el) throw new Error('no input ' + t); el.value = v; };
    const arr = (a, v) => { document.querySelector(`#mapperContainer .array-repeat-input[data-array="${a}"]`).value = v; };
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
    // missing="" toggle
    document.getElementById('ionMissingMode').value = 'empty'; setIonMissingMode('empty');
    const scriptEmpty = document.getElementById('pythonInput').value;
    const previewEmpty = document.getElementById('pythonOutput').value;
    // Inbound
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
    // user's own RULES pasted into the script textarea
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
})();
