# Report Draft Template

Write this for the triager, not for internal notes. A human with zero prior
context should quickly understand the flaw, its concrete impact, and how to
reproduce it.

If the user, program, or platform provides a report template or custom
instructions, follow that structure first. Do not add extra sections that are
not in the template unless they are truly required for triage. Keep the same
substance, but fit it naturally into the provided fields.

Use natural, direct language. The report should not read like a legal document,
a checklist, or an AI-generated worksheet. Prefer objective simplicity over
heavy formatting: short paragraphs, only useful bullets, and no long sections
unless the evidence genuinely requires them.

Do not mention internal workspace paths, agent roles, memory files, Proteus, or
research workflow. When adjusting a draft, write the external report text
itself, not a response to the user or a note about local work.

Avoid common LLM report habits: em dashes, filler, generic hype, defensive
phrasing, unnecessary caveats, and reframing phrases such as "this is not about
X, it is about Y". Do not use headings or stock transitions like "Why this
matters", "This matters", or "This is security relevant because".

## Title

Use one concrete sentence that names the affected boundary and impact.

## CWE

Use the most accurate CWE. If uncertain, write the best candidate and keep the
uncertainty explicit.

## Summary

Start directly. In one or two short paragraphs, explain what breaks, who can
trigger it, the root cause at a high level, and the realistic security impact.
A reader with no prior context should understand the issue from this section.

Anticipate the triager's likely questions organically in the prose: why this is
not expected behavior, why the attacker boundary is realistic, why the target
owns the root cause, what the victim loses, and why the PoC is not a lab
artifact. Do not turn those points into a checklist unless the supplied template
asks for it.

## Root Cause

Include when it helps triage. Explain the target-owned mistake simply first,
then add only the technical detail needed to understand why the vulnerability
exists. If the root cause is already clear in the summary and reproduction
steps, keep this section short or omit it when the template allows.

## PoC Details

Include when there is PoC material beyond the reproduction steps. Prefer manual,
blackbox-style proof using browser actions, HTTP requests, `curl`, or normal CLI
commands. If a helper script is necessary, explain the manual flow it automates.
Include short snippets only when they make the proof easier to trust, and
explain what each snippet does and what output proves the issue. Avoid a large
script as the primary proof when a few readable requests or commands explain the
behavior better.

```bash
# curl or manual command here, if useful
```

## Steps To Reproduce

Keep each step terse: action title plus expected output. Do not put long,
redundant explanations inside the steps. Put output interpretation in PoC
Details or in a short note after the steps, without repeating the same proof.

1.

## Impact

Prefer bullet points. List concrete impacts: realistic attacker scenario, victim
resources affected, and security consequence. Do not use Impact to explain
caveats, prerequisites, reframing, or why the issue matters. Put necessary
requirements in Summary or PoC Details instead.

Add other sections only when the program template requires them or when the
triage context specifically needs them.
