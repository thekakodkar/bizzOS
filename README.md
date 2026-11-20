# BizzStudio Enterprise Integration OS

Single-file studio for Infor OS / ION mapping.

Open `index.html` (GitHub Pages: https://thekakodkar.github.io/bizzOS/) to run the app.

## BODtoJSON 2.6.0

The ION Python code the studio generates targets
[BODtoJSON 2.6.0](https://pypi.org/project/BODtoJSON/2.6.0/) (`pip install BODtoJSON==2.6.0`).
The scripts have no helper code of their own: the mapping is a `RULES` dictionary and
the rest is one library call.

### Outbound: BOD to API JSON (Agentic Engine tab)

The outbound mapper is written out as a BODtoJSON 2.6.0 output template. You write
the JSON you want and put a flattened BOD path wherever a value comes from the document:

```python
from BODtoJSON import bod_to_json

RULES = {
    "externalSystemId": {"template": "{Sync_AccountingEntityID}_{PurchaseOrder_PurchaseOrderHeader_DisplayID}"},
    "isActive": True,
    "amount": "PurchaseOrder_PurchaseOrderHeader_ExtendedAmount",
    "status": {"case": [{"when": {"eq": ["PurchaseOrder_PurchaseOrderHeader_Status_Code", "Open"]}, "then": "ACTIVE"}],
               "default": "INACTIVE"},
    "purchaseOrderLines": {
        "repeat": "PurchaseOrder_PurchaseOrderLine_*",
        "item": {
            "lineNumber": "PurchaseOrder_PurchaseOrderLine_*_LineNumber",
            "codingLines": {"repeat": "PurchaseOrder_PurchaseOrderLine_*_CodingLine_*",
                            "item": {"account": "PurchaseOrder_PurchaseOrderLine_*_CodingLine_*_Account"}},
        },
    },
}

output_var = bod_to_json(input_var, rules=RULES)
```

How the mapper maps to the template:

| Studio | RULES |
| --- | --- |
| A BOD node picked from the tree (`SyncPurchaseOrder.DataArea.PurchaseOrder.PurchaseOrderHeader.DisplayID`) | Its flattened path, `"PurchaseOrder_PurchaseOrderHeader_DisplayID"`. Attributes become `_@attr`, and header fields are `ApplicationArea_*` and `Sync_*` (or whichever verb the BOD has). |
| **+ Merge** (`{A}-{B}`) | `{"template": "{A}-{B}"}` |
| Constant text | `{"literal": "text"}`. Plain strings in output fields are always paths. |
| `true` / `false` | `True` / `False` |
| **+ IF / CASE** | `{"case": [{"when": {"eq": [path, value]}, "then": ...}], "default": ...}`. Supported operators are `eq ne contains starts_with gt lt empty not_empty`. A compare value written as `{path}` compares two fields. |
| Array with a *Repeating XML Node* | `{"repeat": "Noun_Line_*", "item": {...}}`. Inside the item, `*` is the current line. A repeat inside another repeat becomes `Noun_Line_*_Sub_*`. |
| Array without a repeating node | `[{...}]` (one item) |
| Object target schema | adds `single=True` |
| **Missing → ""** selector | adds `missing=""` (the default is `null`) |

The verb is detected from the BOD, so the script has no verb argument. The full
template language is in the BODtoJSON README. That includes `if` and `else`, both
forms of `case` (a list of branches, or a field with a `when` map), `concat`,
`coalesce`, `upper`, `lower`, `trim`, `number`, `replace`, `substr`, `literal`,
`path` with `default`, `repeat` with `where`, compact conditions
(`{"eq": [path, value]}`) and `{path, op, value}` conditions, and `all`/`any`/`not`.
You can edit `RULES` in the script box and press **Execute**.

### Inbound: API JSON to BOD (Inbound API ➔ ERP tab)

The inbound mapper is written out as BODtoJSON flat rules (BOD path ← `"$jsonField"`)
for `json_to_bod`:

```python
from BODtoJSON import json_to_bod

RULES = {
    "PurchaseOrder_PurchaseOrderHeader_DisplayID": "$orderIdentifier",
    "PurchaseOrder_PurchaseOrderHeader_ExtendedAmount_@currencyID": "$currencyCode",
    "PurchaseOrder_PurchaseOrderHeader_Status_Code": {
        "if": [{"when": {"path": "isActive", "op": "eq", "value": "true"}, "then": "Open"}], "else": "Closed"},
}

output_var = json_to_bod(input_var, verb="Sync", version_id="2.14.x", rules=RULES)
```

`json_to_bod` builds the BOD from the mapped fields. It adds the envelope and an
`ApplicationArea/CreationDateTime`. It does not fill in a copy of the sample BOD.

### Previews run BODtoJSON in the browser

**Execute** (outbound) and **Simulate API ➔ ERP** (inbound) read `RULES` and the call's
keyword arguments from the script box. They run them through an in-page JavaScript
port of BODtoJSON 2.6.0, kept in the `BODTOJSON_JS` block of `index.html`. That gives
the same flattening, verb detection, template evaluation, operators, `missing` and
`single` handling, and `json_to_bod` output as the Python package. Errors use the
same text, including the rule location:
`BODTransformError: Rule at '$.purchaseOrderLines.item.codingLines.repeat': repeat pattern must end with '_*' (got 'CodingLine').`

The **Export Integration .zip** package also includes the RULES as `*.rules.json`.

## Tests

`.github/workflows/bodtojson-parity.yml` runs on every push. It does two things:

* `tests/parity`: generates thousands of templates with BODtoJSON 2.6.0 from PyPI.
  These are the ION example template, every operator, invalid rules, and random
  and mutated templates over the sample BODs, plus `json_to_bod` inputs. The run
  checks that the port in `index.html` returns the same `bod_to_json` string or the
  same error type and message.
* `tests/e2e`: drives the studio in headless Chrome. It maps fields with merges,
  IF/CASE rules and nested repeats, then executes the generated outbound and inbound
  scripts with BODtoJSON 2.6.0 and checks that the output matches the in-app previews.

To run them locally:

```bash
pip install BODtoJSON==2.6.0
npm install --no-save @xmldom/xmldom@0.9.12 playwright-core@1.65.1
python tests/parity/gen_cases.py 5000 7 /tmp/cases.json && node tests/parity/run_parity.js index.html /tmp/cases.json
CHROME_PATH=/usr/bin/google-chrome node tests/e2e/e2e.js index.html /tmp/e2e.json && python tests/e2e/verify.py /tmp/e2e.json
```
