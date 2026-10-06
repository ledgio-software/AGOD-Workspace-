// Starter project templates every new company gets (Phase 22). The same list the first
// company received from the stage 2 migration. Outline format: src/modules/templates/outline.ts.

export const STARTER_TEMPLATES: { name: string; description: string; outline: string }[] = [
  {
    name: "Discovery / research",
    description: "Short research engagement ending in a recommendation.",
    outline: "# Understand\n- Kick-off meeting and goals | +2d | 2h\n- Stakeholder interviews | +7d | 12h\n- Review existing systems and data | +7d | 8h\n# Recommend\n- Findings and options document | +12d | 12h\n- Presentation to the client | +14d | 3h",
  },
  {
    name: "Website",
    description: "Marketing or company website from design to launch.",
    outline: "# Design\n- Sitemap and content plan | +5d | 6h\n- Wireframes | +10d | 12h\n- Visual design | +15d | 16h\n# Build\n- Page templates | +25d | 24h\n- Content entry | +28d | 8h\n- Contact form and analytics | +28d | 4h\n# Launch\n- Cross-browser and mobile testing | +32d | 6h\n- Domain, hosting and go-live | +35d | 3h\n- Handover and training | +37d | 2h | optional",
  },
  {
    name: "Mobile app",
    description: "iOS/Android app from requirements to store release.",
    outline: "# Plan\n- Requirements and user stories | +7d | 12h\n- UX flows and screens | +14d | 20h\n# Build\n- App shell, navigation and auth | +28d | 32h\n- Core features | +45d | 80h\n- API integration | +45d | 24h\n# Release\n- QA on real devices | +52d | 16h\n- Store listings and submission | +56d | 6h\n- Release monitoring | +63d | 4h | optional",
  },
  {
    name: "AI integration",
    description: "Adding an AI feature to an existing product.",
    outline: "# Explore\n- Use case and success criteria | +3d | 4h\n- Data and privacy review | +7d | 6h\n- Prototype and evaluation set | +14d | 20h\n# Build\n- Production integration | +28d | 32h\n- Guardrails, logging and cost limits | +30d | 12h\n# Launch\n- Evaluation against success criteria | +33d | 8h\n- Rollout and monitoring | +35d | 4h",
  },
  {
    name: "Internal product feature",
    description: "A feature for an AGOD product (e.g. Ledgio).",
    outline: "# Specify\n- Problem statement and acceptance criteria | +3d | 3h\n- Design review | +5d | 4h\n# Deliver\n- Implementation | +15d | 32h\n- Tests | +17d | 8h\n- Code review and fixes | +18d | 4h\n- Staging verification by PM | +19d | 2h\n- Release notes | +20d | 1h | optional",
  },
  {
    name: "Maintenance / support",
    description: "Recurring support period for an existing client system.",
    outline: "- Monthly health check | +7d | 3h\n- Dependency and security updates | +14d | 6h\n- Backups verified | +14d | 1h\n- Support tickets | +28d | 12h\n- Monthly report to the client | +30d | 2h",
  },
];
