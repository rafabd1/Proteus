# Report Draft Template

Write this for the triager, not for Proteus. Do not mention internal workspace
paths, agent roles, memory files, or research workflow. Use natural, concise
language. Avoid em dashes, filler, and phrases such as "this is not about X, it
is about Y".

## Title

Use a concrete title that names the affected boundary and impact.

## Summary

Explain the issue in plain language. A reader with no prior context should
understand what breaks, who can trigger it, and why it matters.

## Affected Component And Version

- Component:
- Tested version/commit:
- Likely introduced in:
- Fixed version or patch status, if known:

## Root Cause

Explain the bug simply first, then add the relevant technical detail. Focus on
the target-owned mistake, not the lab.

## Impact

Describe a realistic high-impact attacker scenario. Name attacker capabilities,
victim resources, and the security consequence.

## Attack Scenario

Write the scenario as a plausible blackbox attack flow using normal users,
tenants, projects, tokens, requests, or resources.

## Steps To Reproduce

Prefer manual reproduction with browser actions, HTTP requests, curl, or normal
CLI commands. If a helper script is needed, explain the manual flow it
automates.

1.

## PoC Details

Include only snippets that help triage trust the reproduction. Explain what each
snippet does and which output proves the issue.

```bash
# curl or manual command here
```

## Expected Result

Describe the safe behavior.

## Actual Result

Describe the vulnerable behavior and point to evidence.

## Negative Controls

Show at least one control that proves the result is not caused by lab setup,
unsafe configuration, or excessive privileges.

## Why This Is Not Expected Or Known

Summarize local dedupe, public intel, advisories, issues, changelog, docs/tests,
and timeline checks. Do not claim novelty unless those checks were actually
performed.

## Suggested Fix Or Mitigation

Keep it practical and tied to the root cause.

## Limitations

State any uncertainty, version limits, environmental assumptions, or untested
variants.
