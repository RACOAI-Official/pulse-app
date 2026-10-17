# Presswayy → Pulse reverse engineering

Observed on 14 October 2026 using the signed-in Free-plan account at [app.presswayy.com](https://app.presswayy.com/). This is a functional reference for Pulse, not a specification of Presswayy's private implementation. Pulse's own decisions remain in [Pulse-documentation.md](../../Pulse-documentation.md).

## Read in this order

1. [Feature and route inventory](inventory.md) — every visible dashboard section, child route, tab, and gate.
2. [Workflows and candidate contracts](workflows.md) — behavior visible from controls, plus explicitly marked design inferences.
3. [Evidence and limits](evidence.md) — source URLs, REA observations, and what the account could not reveal.
4. [Pulse parity matrix](pulse-parity.md) — existing v1, later phases, and decisions that differ from the reference.

## Evidence labels

| Label | Meaning |
| --- | --- |
| **Observed** | A rendered page, control, state, or interaction was seen in the browser. |
| **Stated** | Presswayy page copy, tutorial, or FAQ describes behavior that was not exercised. |
| **Inferred** | Plausible behavior proposed for planning; Presswayy did not reveal or prove it. |
| **Unknown** | No reliable evidence yet. |

UI controls can establish that a workflow exists without proving its persistence, server rules, or third-party integration. Candidate data contracts in this documentation are for Pulse planning; they are not claims about Presswayy's API.

## Current baseline

The workspace now has Phase 0–3 implementations; the shipped customer agent is recorded in [the Phase 3 implementation record](../implementation/phase-3-agent.md). This does not mean every feature in the broader Pulse brief is built. The reference account shows Free-plan limits of one connected channel and three products. A number of screens are previews or upgrade gates. Recheck this inventory after product changes or when a Standard account, connected channel, and sample conversations become available. The REA capture remains limited to the public login page until its separate debugging profile is authenticated.
