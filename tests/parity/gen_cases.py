"""Generate parity cases (BOD + rules) and the BODtoJSON 2.6.0 expected results.

Usage: python tests/parity/gen_cases.py N_FUZZ SEED OUT.json
Then:  node tests/parity/run_parity.js index.html OUT.json

The cases are the user's ION example template, hand-written templates for every
operator, invalid rules (error messages with locations), N_FUZZ random templates
(about a third mutated into invalid ones) and json_to_bod inputs. Expected
results come from the real BODtoJSON package from PyPI.
"""
import json
import os
import random
import sys
from BODtoJSON import bod_to_json, json_to_bod, __version__
from BODtoJSON.mapper import BODConverter

assert __version__ == "2.6.0", __version__
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures") + os.sep
XMLS = {n: open(D + n, encoding="utf-8").read() for n in ["sync_PO_lines.xml", "sync_PO_PSU000049.xml", "sync_PO_PSU000050.xml"]}
EXTRA = """<?xml version="1.0"?>
<ProcessSalesOrder xmlns="http://schema.infor.com/InforOAGIS/2" xmlns:x="urn:x">
 <ApplicationArea><Sender><LogicalID>lid://a</LogicalID></Sender><BODID>b-1</BODID></ApplicationArea>
 <DataArea>
  <Process><TenantID>T1</TenantID><ActionCriteria><ActionExpression actionCode="Add"/></ActionCriteria></Process>
  <SalesOrder x:kind="std">
   <SalesOrderHeader><DocumentID><ID variationID="3">SO-1</ID></DocumentID><Note>  hello  <!-- c --> world </Note>
    <Status><Code>Released</Code></Status><Amount currencyID="USD"> 12.50 </Amount><Empty/><Flag>true</Flag></SalesOrderHeader>
   <SalesOrderLine><LineNumber>1</LineNumber><Qty unitCode="EA">2</Qty><Price>5</Price><Tag>a</Tag><Tag>b</Tag>
     <Sched><Date>2026-01-01</Date></Sched><Sched><Date>2026-02-01</Date></Sched></SalesOrderLine>
   <SalesOrderLine><LineNumber>2</LineNumber><Qty unitCode="KG">1e3</Qty><Price>abc</Price><Text><![CDATA[x<y]]></Text></SalesOrderLine>
  </SalesOrder>
  <SalesOrder><SalesOrderHeader><DocumentID><ID>SO-2</ID></DocumentID><Status><Code>Open</Code></Status></SalesOrderHeader>
   <SalesOrderLine><LineNumber>9</LineNumber><Qty>-0.5</Qty></SalesOrderLine></SalesOrder>
 </DataArea>
</ProcessSalesOrder>"""
XMLS["extra.xml"] = EXTRA

USER_RULES = json.load(open(D + "ion_purchase_order_template.json"))

HAND = [
    ("sync_PO_lines.xml", USER_RULES, {}),
    ("sync_PO_lines.xml", USER_RULES, {"single": True}),
    ("sync_PO_lines.xml", USER_RULES, {"missing": ""}),
    ("sync_PO_lines.xml", {
        "id": "{PurchaseOrder_PurchaseOrderHeader_DisplayID}",
        "status": {"case": "PurchaseOrder_PurchaseOrderHeader_Status_Code", "when": {"Open": "O", "Closed": "C"}, "default": "?"},
        "status2": {"case": [{"when": {"eq": ["PurchaseOrder_PurchaseOrderHeader_Status_Code", "Open"]}, "then": True}], "default": False},
        "big": {"if": {"path": "PurchaseOrder_PurchaseOrderHeader_ExtendedAmount", "op": "gt", "value": 1000}, "then": "high", "else": "low"},
        "label": {"concat": ["PO-", "PurchaseOrder_PurchaseOrderHeader_DisplayID", {"literal": "x_y"}], "sep": "/"},
        "sup": {"coalesce": ["PurchaseOrder_PurchaseOrderHeader_Nope", "PurchaseOrder_PurchaseOrderHeader_SupplierParty_Name"]},
        "up": {"upper": "PurchaseOrder_PurchaseOrderHeader_SupplierParty_Name"},
        "lo": {"lower": "PurchaseOrder_PurchaseOrderHeader_SupplierParty_Name"},
        "num": {"number": "PurchaseOrder_PurchaseOrderHeader_ExtendedAmount"},
        "rep": {"replace": "PurchaseOrder_PurchaseOrderHeader_DisplayID", "old": "PSU", "new": "X"},
        "sub": {"substr": "PurchaseOrder_PurchaseOrderHeader_DisplayID", "start": -3},
        "lit": {"literal": {"a": [1, 2]}},
        "p": {"path": "PurchaseOrder_Nope", "default": "dflt"},
        "esc": "{{literal}} {Sync_TenantID}",
        "lines": {"repeat": "PurchaseOrder_PurchaseOrderLine_*", "where": {"gt": ["ExtendedAmount", 200]},
                  "item": {"n": "LineNumber", "abs": "PurchaseOrder_PurchaseOrderLine_*_Item_ID", "hdr": "Sync_AccountingEntityID",
                           "coding": {"repeat": "CodingLine_*", "item": {"acct": "Account", "pct": {"number": "Percentage"}, "line": "PurchaseOrder_PurchaseOrderLine_*_LineNumber"}},
                           "coding2": {"repeat": "PurchaseOrder_PurchaseOrderLine_*_CodingLine_*", "item": "PurchaseOrder_PurchaseOrderLine_*_CodingLine_*_Account"}}},
        "first_line": "PurchaseOrder_PurchaseOrderLine_*_LineNumber",
        "all": {"if": {"all": [{"exists": "Sync_TenantID"}, {"not": {"empty": "Sync_TenantID"}}, {"any": [False, "Sync_TenantID"]}]}, "then": 1, "else": 0},
        "inop": {"if": {"in": ["PurchaseOrder_PurchaseOrderHeader_Status_Code", ["X", "open"]], "ignore_case": True}, "then": "yes", "else": "no"},
        "cmp2": {"if": {"eq": ["Sync_AccountingEntityID", "$PurchaseOrder_PurchaseOrderHeader_DocumentID_ID_@accountingEntity"]}, "then": "same", "else": "diff"},
        "ifl": {"if": [{"when": {"starts_with": ["PurchaseOrder_PurchaseOrderHeader_DisplayID", "XX"]}, "then": "a"},
                        {"when": {"path": "PurchaseOrder_PurchaseOrderHeader_DisplayID", "op": "ends_with", "value": "51"}, "then": "b"}], "else": "c"},
        "arr": [{}, "Sync_TenantID", 3, None, True],
    }, {}),
]
for name in XMLS:
    HAND.append((name, {"x": "ApplicationArea_BODID", "keys": {"literal": 1}}, {}))

def bad_rules():
    return [
        {"a": {"repeat": "Lines", "item": {}}},
        {"a": {"repeat": "Line_*x"}},
        {"a": {"if": {"eq": ["P"]}, "then": 1}},
        {"a": {"if": {"zz": ["P", 1]}, "then": 1}},
        {"a": {"if": {"eq": ["P", 1], "ne": ["Q", 2]}, "then": 1}},
        {"a": {"case": [], "default": 1}},
        {"a": {"case": "P", "default": 1}},
        {"a": {"case": [{"when": True}]}},
        {"a": {"concat": "x"}},
        {"a": {"replace": "P", "old": ""}},
        {"a": {"substr": "P", "start": "1"}},
        {"a": {"if": {"path": "P", "op": "in", "value": 1}, "then": 1}},
        {"a": {"if": {"path": "P", "op": "gt"}, "then": 1}},
        {"a": {"if": {"path": "P", "bogus": 1}, "then": 1}},
        {"a": {"if": [{"when": True, "then": 1}], "then": 2}},
        {"b": [{"c": {"template": 5}}]},
        {"a": {"if": {"exists": ["P", 1]}, "then": 1}},
        {"a": {"if": 5, "then": 1}},
        {"a": {"all": [{"eq": ["P", 1]}], "x": 1}},
        "not json",
        "{bad json",
        {"rules": {"a": "$Sync_TenantID", "b": {"template": "{Sync_TenantID}-x"}}, "mode": "only"},
        {"a": "$Sync_TenantID", "b": {"upper": "$Sync_TenantID"}},
        {"a": "$Sync_TenantID", "b": {"if": {"path": "Sync_TenantID", "op": "eq", "value": "TEST_TST"}, "then": "Y", "else": "N"}},
        {"rules": {"L_*_n": "$PurchaseOrder_PurchaseOrderLine_*_LineNumber"}, "mode": "only", "drop": []},
        {"rules": {"a": "$x"}, "mode": "bogus"},
    ]

# ---------------- fuzz ----------------
def fuzz(rng, keys, depth=0):
    paths = keys + ["Nope_Path", "LineNumber", "Account", "Status_Code", "Line_*_X"]
    def path():
        p = rng.choice(paths)
        segs = p.split("_")
        if len(segs) > 2 and rng.random() < 0.3:
            i = rng.randrange(len(segs))
            if segs[i].isdigit():
                segs[i] = "*"
                p = "_".join(segs)
        return rng.choice([p, p, "{" + p + "}", "$" + p])
    def lit():
        return rng.choice(["Open", "high", "x y", "", " ", "10", 5, 2.5, True, False, None, "PSU", "a_b", "$$x", 0, -1, "1e3"])
    def cond(d):
        r = rng.random()
        if d > 2 or r < 0.45:
            op = rng.choice(["eq", "ne", "gt", "ge", "lt", "le", "contains", "not_contains", "starts_with", "ends_with", "==", ">", "<=", "startswith"])
            right = rng.choice([lit(), "$" + rng.choice(paths)])
            if rng.random() < 0.5:
                c = {op: [path(), right]}
            else:
                c = {"path": path(), "op": op, "value": right}
            if rng.random() < 0.2:
                c["ignore_case"] = True
            return c
        if r < 0.55:
            op = rng.choice(["exists", "missing", "empty", "not_empty"])
            return {op: path()} if rng.random() < 0.5 else {"path": path(), "op": op}
        if r < 0.62:
            return {rng.choice(["in", "not_in"]): [path(), [lit(), lit(), "$" + rng.choice(paths)]]}
        if r < 0.72:
            return {rng.choice(["all", "any", "and", "or"]): [cond(d + 1) for _ in range(rng.randint(1, 3))]}
        if r < 0.78:
            return {"not": cond(d + 1)}
        if r < 0.85:
            return path()
        if r < 0.9:
            return rng.choice([True, False])
        return {"eq": [{"upper": path()}, lit()]}
    def arg(d):
        r = rng.random()
        if r < 0.35:
            return path()
        if r < 0.6:
            return lit()
        return val(d + 1)
    def val(d):
        r = rng.random()
        if d > 3 or r < 0.3:
            return rng.choice([path(), path(), lit(), "{" + rng.choice(paths) + "}-{" + rng.choice(paths) + "}", "a{{b}}"])
        ops = ["template", "if", "ifl", "case", "casem", "concat", "coalesce", "upper", "lower", "trim", "number", "replace", "substr", "literal", "path", "repeat", "obj", "list"]
        op = rng.choice(ops)
        if op == "template": return {"template": rng.choice(["x{" + rng.choice(paths) + "}y", "const", "{" + rng.choice(paths) + "}"])}
        if op == "if": 
            n = {"if": cond(0), "then": arg(d)}
            if rng.random() < 0.7: n["else"] = arg(d)
            return n
        if op == "ifl": return {"if": [{"when": cond(0), "then": arg(d)} for _ in range(rng.randint(1, 3))], "else": arg(d)}
        if op == "case": 
            n = {"case": [{"when": cond(0), "then": arg(d)} for _ in range(rng.randint(1, 3))]}
            if rng.random() < 0.7: n["default"] = arg(d)
            return n
        if op == "casem":
            n = {"case": path(), "when": {str(lit()): arg(d) for _ in range(rng.randint(1, 3))}, "default": arg(d)}
            if rng.random() < 0.3: n["ignore_case"] = True
            return n
        if op == "concat":
            n = {"concat": [arg(d) for _ in range(rng.randint(1, 4))]}
            if rng.random() < 0.5: n["sep"] = rng.choice(["-", " ", ""])
            if rng.random() < 0.3: n["skip_empty"] = rng.choice([True, False])
            return n
        if op == "coalesce": return {"coalesce": [arg(d) for _ in range(rng.randint(1, 3))]}
        if op in ("upper", "lower", "trim"): return {op: arg(d)}
        if op == "number":
            n = {"number": arg(d)}
            if rng.random() < 0.5: n["default"] = arg(d)
            return n
        if op == "replace": return {"replace": arg(d), "old": rng.choice(["P", "0", " ", "a"]), "new": rng.choice(["", "Z"])}
        if op == "substr":
            n = {"substr": arg(d)}
            for k in ("start", "end"):
                if rng.random() < 0.6: n[k] = rng.randint(-4, 6)
            return n
        if op == "literal": return {"literal": rng.choice([lit(), [1, "a"], {"k": None}])}
        if op == "path":
            n = {"path": path()}
            if rng.random() < 0.5: n["default"] = arg(d)
            return n
        if op == "repeat":
            heads = sorted({"_".join(k.split("_")[: i + 1][:-1] + [k.split("_")[i - 1] if False else k.split("_")[: i + 1][-1]]) for k in keys for i, s in enumerate(k.split("_")) if i + 1 < len(k.split("_")) and k.split("_")[i + 1].isdigit()})
            pats = [h + "_*" for h in heads] + ["CodingLine_*", "PurchaseOrderLine_*", "Tag_*", "Sched_*", "SalesOrderLine_*", "Nope_*"]
            p = rng.choice(pats)
            segs = p.split("_")
            if rng.random() < 0.5:
                segs = [("*" if s.isdigit() else s) for s in segs]
            n = {"repeat": "_".join(segs), "item": val(d + 1) if rng.random() < 0.5 else {"a": arg(d), "b": val(d + 1)}}
            if rng.random() < 0.3: n["where"] = cond(0)
            return n
        if op == "obj": return {f"k{i}": val(d + 1) for i in range(rng.randint(1, 3))}
        return [val(d + 1) for _ in range(rng.randint(0, 2))]
    return {f"f{i}": val(depth) for i in range(rng.randint(1, 5))}

BAD = [
    {"repeat": "NoStar"}, {"repeat": "A_*x_*"}, {"repeat": "*"}, {"repeat": 5}, {"if": {"eq": ["P"]}, "then": 1},
    {"if": {"bogus": ["P", 1]}}, {"if": {"eq": ["P", 1], "ne": ["P", 1]}}, {"case": []}, {"case": "P"}, {"case": "P", "when": [1]},
    {"case": [{"when": True}]}, {"case": [{"when": True, "then": 1, "x": 2}]}, {"concat": "abc"}, {"concat": 5}, {"coalesce": {"a": 1}},
    {"concat": ["a"], "sep": 1}, {"template": 1}, {"replace": "P", "old": ""}, {"replace": "P", "old": "a", "new": 1},
    {"substr": "P", "start": "1"}, {"substr": "P", "end": True}, {"substr": "P", "end": 1.5}, {"if": {"path": "P", "op": "in", "value": 1}},
    {"if": {"path": "P", "op": "gt"}}, {"if": {"path": "P", "op": 5, "value": 1}}, {"if": {"path": "P", "zz": 1}}, {"if": {"path": "", "op": "eq", "value": 1}},
    {"if": [{"when": True, "then": 1}], "then": 2}, {"if": []}, {"if": {"exists": ["P", 1]}}, {"if": 5}, {"if": None},
    {"if": {"all": [], "x": 1}}, {"if": {"all": "x"}}, {"if": {"not": True, "x": 1}}, {"if": {"eq": []}}, {"if": {"eq": [{"bad": {"repeat": "x"}}, 1]}},
    {"if": {"eq": ["P", 1], "ignore_case": "yes"}}, "A_*b", "{A_x*}", {"path": ""}, {"path": 5}, {"number": "P", "default": {"repeat": "x"}},
    {"if": True, "then": {"repeat": "x"}}, {"case": "P", "when": {"a": {"repeat": 1}}},
    {"if": {"path": "P", "expr": "Q", "op": "eq", "value": 1}}, {"if": {"expr": {"upper": "P"}, "value": "X"}, "then": 1},
]

def mutate(rng, node):
    if isinstance(node, dict) and node:
        k = rng.choice(list(node))
        if rng.random() < 0.4:
            node = dict(node); node[k] = rng.choice(BAD); return node
        node = dict(node); node[k] = mutate(rng, node[k]); return node
    if isinstance(node, list) and node:
        i = rng.randrange(len(node)); node = list(node); node[i] = mutate(rng, node[i]); return node
    return rng.choice(BAD)

def run(xml, rules, opts):
    try:
        return {"ok": bod_to_json(xml, rules, **opts)}
    except Exception as e:  # noqa: BLE001
        return {"err": type(e).__name__, "msg": str(e)}

def main(n_fuzz, seed):
    rng = random.Random(seed)
    cases = []
    for name, rules, opts in HAND:
        cases.append({"xml": name, "rules": rules, "opts": opts})
    for r in bad_rules():
        cases.append({"xml": "sync_PO_lines.xml", "rules": r, "opts": {}})
    conv = BODConverter()
    keysets = {n: sorted({k for rec in conv.to_records(x, None, include_header=True) for k in rec}) for n, x in XMLS.items()}
    for i in range(n_fuzz):
        name = rng.choice(list(XMLS))
        rules = fuzz(rng, keysets[name])
        opts = {}
        if rng.random() < 0.2: opts["single"] = True
        if rng.random() < 0.2: opts["missing"] = rng.choice(["", "N/A", 0])
        if rng.random() < 0.3:
            rules = mutate(rng, rules)
        cases.append({"xml": name, "rules": rules, "opts": opts})
    for c in cases:
        c["expected"] = run(XMLS[c["xml"]], c["rules"], c["opts"])
    # json_to_bod cases
    rev = []
    order = json.load(open(D + "order.json"))
    rj = json.load(open(D + "rules_json_to_bod.json"))
    flat_rec = conv.to_records(XMLS["sync_PO_lines.xml"], None, include_header=True)
    for data, kw in [
        (order, {"rules": rj}),
        (order, {"rules": rj, "verb": "Process", "release_id": None, "version_id": "2.14"}),
        (flat_rec, {}),
        ([{"PurchaseOrder_PurchaseOrderHeader_DisplayID": "A&B<>\"", "Sync_TenantID": "T", "ApplicationArea_BODID": "x"}], {"action_code": "Add"}),
        ({"PurchaseOrder": {"Header": {"ID": {"@schemeID": "s", "#text": "1"}}, "Line": [{"No": 1}, {"No": 2}]}}, {"namespace": None}),
        ({"ID": 1, "Lines": [{"A": True}]}, {"noun": "Item", "rules": {"rules": {"Item_ID": "$ID", "Item_Line_*_A": "$Lines_*_A", "Item_Name": {"if": {"path": "ID", "op": "gt", "value": 0}, "then": "pos", "else": "neg"}}, "mode": "only"}}),
        ('{"a": 1}', {"noun": "N", "pretty": False, "xml_declaration": False, "include_application_area": False}),
        ({"bad name": 1}, {"noun": "N"}),
    ]:
        try:
            out = {"ok": json_to_bod(data, **kw)}
        except Exception as e:  # noqa: BLE001
            out = {"err": type(e).__name__, "msg": str(e)}
        rev.append({"data": data, "kw": kw, "expected": out})
    json.dump({"xmls": XMLS, "cases": cases, "reverse": rev}, open(sys.argv[3], "w"), ensure_ascii=False)
    print("cases", len(cases), "reverse", len(rev))

if __name__ == "__main__":
    main(int(sys.argv[1]), int(sys.argv[2]))
