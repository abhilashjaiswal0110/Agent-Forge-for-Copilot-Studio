## Bring your agents into VS Code

Agent Forge works on Copilot Studio agents cloned to disk. Clone every agent of a solution
**side by side** in one folder so multi-agent checks can follow connected agents end to end.

```powershell
pac auth create --environment https://contoso-dev.crm.dynamics.com
pac copilot list
pac copilot clone --bot <agent-id-or-schema-name> --environment <environment-id>
```

You can also clone from the Copilot Studio extension. Both the **standard** harness
(`agent.mcs.yml`, `topics/`, `actions/`) and the **GitHub Copilot** harness (`settings.mcs.yml`,
`behaviors/`, `capabilities/`) are supported.

No agent yet? **Open Contoso Sample** copies a fictional IT help desk (an orchestrator, two
connected agents and a standard-harness agent) into a folder of your choice and opens it.
