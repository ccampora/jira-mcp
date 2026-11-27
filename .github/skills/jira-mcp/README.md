# Importing the Jira MCP skill

This folder contains a self-contained [SKILL.md](./SKILL.md) for agents connected
to this repository's Jira/Confluence MCP server. No secrets or site-specific IDs
are required in the file. Examples use placeholders.

## Copilot Studio

Microsoft documents skill upload for agents using the **GitHub Copilot harness**.
These instructions do not imply that every Copilot Studio agent experience has
the same Skills UI.

1. Connect the Jira MCP server and enable the tools needed by your agent.
   Importing this skill does not create or authenticate that connection.
2. Open your agent, then **Build > Skills > Add skill > Upload a skill**.
3. Upload `SKILL.md` directly. Alternatively upload a ZIP containing `SKILL.md`
   and this README. The skill instructions have no local file dependencies.
4. Test in **Preview** with read-only requests first, such as "Show my open work
   in project DEMO" or "Find issues updated in the last seven days in DEMO".
5. Verify tool selection, authenticated identity, pagination, and error handling.
   For write testing, use an approved test project/page and require confirmation.

If your agent experience does not support skill uploads, use its supported
instructions/knowledge mechanisms instead; do not assume it discovers this
repository's skill folder automatically.

Official documentation:

- [Add an existing skill](https://learn.microsoft.com/microsoft-copilot-studio/agents-experience/skills-add-existing)
- [Create and test skills](https://learn.microsoft.com/microsoft-copilot-studio/agents-experience/skills-create)

## VS Code / GitHub Copilot

The `.github/skills/jira-mcp/SKILL.md` location supports workspace skill discovery
in compatible GitHub Copilot clients. The description provides the Jira, JQL,
MCP and Confluence activation keywords.

## Scope and maintenance

The skill covers this repository's 22 Jira and 8 optional Confluence tools,
for Jira Cloud and Confluence Cloud only. Deploy the matching server version;
Data Center deployments and legacy PAT/password credentials are not supported.
Always follow the actual connected server's advertised tool schemas.

Examples are templates, not live-site validation. Recheck project keys, issue
types, custom fields, account IDs, workflow status names and option IDs on each
site. Content examples and JQL do not require granting broader permissions.
