"""Run the scripts the app generated with the real BODtoJSON 2.6.0 and compare
them with the in-browser previews. Usage: python tests/e2e/verify.py tests/e2e/out.json"""
import json
import os
import re
import sys

import BODtoJSON

FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "parity", "fixtures")
r = json.load(open(sys.argv[1]))
xml = open(os.path.join(FIX, "sync_PO_lines.xml"), encoding="utf-8").read()
def run(script, input_var):
    ns = {'input_var': input_var}
    exec(compile(script, 'ion_script.py', 'exec'), ns)  # the generated ION script, as ION would run it
    return ns['output_var']
checks = []
for name, script, preview in [('outbound', r['script'], r['preview']), ('outbound missing=""', r['scriptEmpty'], r['previewEmpty']),
                              ("user's ion_script.py", open(os.path.join(FIX, 'ion_script.py')).read(), r['userPreview'])]:
    py = json.loads(run(script, xml))
    checks.append((name, py == json.loads(preview)))
stamp = lambda s: re.sub(r'<CreationDateTime>[^<]*</CreationDateTime>', '<CreationDateTime/>', s)
py_in = run(r['inScript'], json.dumps(r['sample']))
checks.append(('inbound json_to_bod', stamp(py_in) == stamp(r['inPreview'])))
bad = open(os.path.join(FIX, 'ion_script.py')).read().replace('"repeat": "CodingLine_*"', '"repeat": "CodingLine"')
try:
    run(bad, xml); msg = None
except Exception as e:  # noqa: BLE001
    msg = f"{type(e).__name__}: {e}"
HEAD2 = "# (pip install BODtoJSON==2.6.0). https://thekakodkar.github.io/BODtoJSON/"
def header_ok(script, direction):
    lines = script.splitlines()
    return lines[:2] == [f"# Infor ION Scripting: {direction} with BODtoJSON 2.6.0", HEAD2]
checks.append(('outbound header comment', header_ok(r['script'], 'BOD -> CoAMed JSON') and header_ok(r['scriptEmpty'], 'BOD -> CoAMed JSON')))
checks.append(('inbound header comment', header_ok(r['inScript'], 'CoAMed JSON -> BOD')))
checks.append(('error message with location', msg == r['badPreview']))
print('python error:', msg)
print('BODtoJSON', BODtoJSON.__version__)
for n, ok in checks: print(('MATCH ' if ok else 'DIFF  ') + n)
u = json.loads(r['userPreview']); print('user RULES lines:', len(u[0]['purchaseOrderLines']), u[0]['externalSystemId'])
if not all(ok for _, ok in checks) or BODtoJSON.__version__ != "2.6.0":
    sys.exit(1)
