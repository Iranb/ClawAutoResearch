# Claim Verification Protocol

Use this before declaring a section stable, especially for Abstract, Introduction, Results, and contribution bullets.

## What To Check

- Numerical claims
- Priority/firstness claims
- Trend claims
- Causal or mechanistic claims
- Comparative claims against baselines or prior work

## Verification Steps

1. Extract the exact claim sentence.
2. Identify the cited or experimental evidence.
3. Check whether the wording matches the evidence scope.
4. Downgrade or delete any claim whose wording is stronger than the evidence.

## Verdicts

- `VERIFIED`: wording matches the evidence.
- `MINOR_DISTORTION`: wording is a little loose, but still safe after softening.
- `MAJOR_DISTORTION`: wording overstates what the evidence shows.
- `UNVERIFIABLE`: no direct evidence or source supports the statement.

## Writing Rule

- `VERIFIED`: can stay as a headline claim.
- `MINOR_DISTORTION`: rewrite conservatively.
- `MAJOR_DISTORTION`: remove from the headline arc until repaired.
- `UNVERIFIABLE`: delete or move to limitation/future work.
