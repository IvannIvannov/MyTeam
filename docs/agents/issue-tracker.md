# Issue tracker: GitHub

Issues and specs live in GitHub Issues for moozuk22/MyTeam.

Use the gh CLI from this repository:
- Create: gh issue create --title "..." --body-file <file>
- Read: gh issue view <number> --json number,title,body,labels,comments
- List: gh issue list --state open --json number,title,body,labels
- Comment: gh issue comment <number> --body-file <file>
- Label: gh issue edit <number> --add-label "..."
- Remove label: gh issue edit <number> --remove-label "..."
- Close: gh issue close <number> --comment "..."

Use UTF-8 files for multiline issue bodies and comments.
When gh is unavailable, use the connected GitHub tools.

Publishing to the issue tracker means creating a GitHub issue.
Fetching a relevant ticket means reading its issue and comments.

## Pull requests as a triage surface

PRs as a request surface: no.
