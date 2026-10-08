# Financial Modeling Playbook (v2.2)

Live map at https://mindtensorml.github.io/financial-modelling/

Building a financial model that holds up in review, from scoping and architecture through inputs, build, outputs and checks, to stress testing, independent review and release. Mapped against the ICAEW Financial Modelling Code and the FAST Standard 02c, with model audit practice from published EuSpRIG research.

- 6 phases and 2 subprocesses (circular references and change requests), with 87 tasks and 20 decision gates, each owned by a named person.
- Checks are built from the start, not at the end. Circular references are avoided or solved algebraically before iteration is considered. The model owner signs the scope and the assumptions, and a reviewer independent of the builder reviews the model in proportion to its risk.
- 42 tasks a model can run with the owner accountable, 43 a model drafts and the owner signs, and 2 stay with people. Project finance models get a cash flow waterfall with defined DSCR and LLCR, sensitivity grids must prove they are wired, and the independent reviewer recomputes IRR.
- The original playbook files (`Financial_Modeling_Playbook_v8.mermaid` and `.xlsx`) are kept for reference.

Built by Caesar Rana, CFA, APMG Certified PPP Professional (CP3P), at SpaceXAI and shared with permission. Revised in October 2026. The original map is archived in `v1/`. The map describes a general method and contains no client data. The tags are design estimates of what a frontier model could do with the owner accountable, not measured results. See all the maps at https://mindtensorml.github.io/
