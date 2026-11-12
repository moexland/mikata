# Mikata

## Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/).

When an AI model had any hand in a change, end the commit message with an
`Assisted-by` trailer for it, in the form `Name <email>`:

```
Assisted-by: Claude Fable 5.2 <noreply@anthropic.com>
```

- "Any hand" is meant widely: writing the change or part of it, and also
  reviewing, debugging, or suggesting it. It does not take having done most of
  the work.
- One trailer for each model that took part.
- This takes the place of `Co-Authored-By`. Do not add that trailer for a model.
