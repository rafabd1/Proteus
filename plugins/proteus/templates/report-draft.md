# Report Draft Template

Write this for the triager, not for internal notes. Do not mention internal workspace
paths, agent roles, memory files, or research workflow. Use natural, concise
language. Avoid em dashes, filler, and phrases such as "this is not about X, it
is about Y".

## Title

Use one concrete sentence that names the affected boundary and impact.

## CWE

Use the most accurate CWE. If uncertain, write the best candidate and keep the
uncertainty explicit.

## Summary

Start directly. In one or two short paragraphs, explain what breaks, who can
trigger it, the root cause at a high level, and the realistic security impact.
A reader with no prior context should understand the issue from this section.

## Root Cause

Include when it helps triage. Explain the target-owned mistake simply first,
then add only the technical detail needed to understand why the vulnerability
exists.

## PoC Details

Include when there is PoC material beyond the reproduction steps. Prefer manual,
blackbox-style proof using browser actions, HTTP requests, `curl`, or normal CLI
commands. If a helper script is necessary, explain the manual flow it automates.
Include short snippets only when they make the proof easier to trust, and
explain what each snippet does and what output proves the issue.

```bash
# curl or manual command here, if useful
```

## Steps To Reproduce

1.

## Impact

Describe the realistic attacker scenario, the victim resources affected, and the
security consequence. Avoid abstract severity language unless the program asks
for it.

Add other sections only when the program template requires them or when the
triage context specifically needs them.
