export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      [
        "web",
        "api",
        "ingestion",
        "sentiment-worker",
        "report-worker",
        "shared-types",
        "db",
        "config",
        "llm",
        "messaging",
        "storage",
        "scoring",
        "source-adapters",
        "infra",
        "ci",
        "deps",
      ],
    ],
    "body-max-line-length": [0],
  },
};
