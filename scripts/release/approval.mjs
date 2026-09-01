export const REQUIRED_ACCEPTANCE_CHECKS = [
  "SOURCE_REVIEWED",
  "UI_ACCEPTED",
  "VISUAL_GATE_ACCEPTED",
  "CORE_FUNCTIONS_ACCEPTED",
  "PERSISTENCE_ACCEPTED",
  "SECURITY_ACCEPTED",
  "UPDATER_E2E_ACCEPTED",
  "KNOWN_ISSUES_REVIEWED",
  "STABLE_AUTHORIZED",
];

function fieldValue(body, heading) {
  const marker = `### ${heading}`;
  const start = body.indexOf(marker);
  if (start < 0) return "";
  return body.slice(start + marker.length).split(/^### /m, 1)[0].trim();
}

export function verifyReleaseApproval({ issue, repositoryOwner, tag, tagSha }) {
  if (issue.state?.toUpperCase() !== "CLOSED") throw new Error("acceptance issue must be closed");
  const authorLogin = issue.author?.login ?? issue.user?.login;
  const association = issue.authorAssociation ?? issue.author_association;
  if (authorLogin !== repositoryOwner || association !== "OWNER") {
    throw new Error("acceptance issue must be authored by the repository owner");
  }
  const labels = new Set(issue.labels?.map((label) => label.name) ?? []);
  for (const label of ["release-acceptance", "release-approved"]) {
    if (!labels.has(label)) throw new Error(`acceptance issue is missing label: ${label}`);
  }
  if (fieldValue(issue.body, "Release tag") !== tag) {
    throw new Error("acceptance issue does not match the release tag");
  }
  if (fieldValue(issue.body, "Exact candidate commit SHA") !== tagSha) {
    throw new Error("acceptance issue does not match the candidate commit");
  }
  const evidence = fieldValue(issue.body, "Acceptance evidence");
  if (!evidence || evidence.startsWith("_No response_")) {
    throw new Error("acceptance issue must include concrete test evidence");
  }
  for (const check of REQUIRED_ACCEPTANCE_CHECKS) {
    if (!issue.body.includes(`- [x] [${check}]`)) {
      throw new Error(`missing human acceptance check: ${check}`);
    }
  }
  return true;
}
