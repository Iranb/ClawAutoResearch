# Method / Approach

Use this file when drafting or revising Method / Approach.

## Section job

The Method section should make the mechanism believable and reproducible without overwhelming the reader.

## Recommended order

1. High-level intuition.
2. Pipeline / overview figure.
3. Key modules.
4. Design motivations.
5. Implementation details needed for reproduction.

## Module paragraph template

```text
We introduce [component] to address [specific issue].
The key design choice is ...
This choice matters because ...
We evaluate this design in Section [X], where we show ...
```

## Each module must answer

- What problem does this module solve?
- How does it work?
- Why is this design necessary?
- What later experiment validates it?

## Hard rules

- Define terms before using them repeatedly.
- Do not list components without motivation.
- Do not make implementation detail look like conceptual contribution.
- Do not describe a design choice as central if no later result validates it.

## Ready check

Method is ready only if:

- the overview gives the reader a map
- every key module has motivation and design
- notation is consistent
- the section links naturally to the Results section

