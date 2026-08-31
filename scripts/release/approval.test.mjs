import test from "node:test";
import assert from "node:assert/strict";
import { verifyReleaseApproval } from "./approval.mjs";

const tag = "v0.1.0";
const tagSha = "a".repeat(40);
const checks = [
  "SOURCE_REVIEWED",
  "UI_ACCEPTED",
  "CORE_FUNCTIONS_ACCEPTED",
  "PERSISTENCE_ACCEPTED",
  "SECURITY_ACCEPTED",
  "UPDATER_E2E_ACCEPTED",
  "KNOWN_ISSUES_REVIEWED",
  "STABLE_AUTHORIZED",
];

function approvalIssue(overrides = {}) {
  return {
    number: 42,
    state: "CLOSED",
    title: `[Release acceptance] ${tag}`,
    author: { login: "owner" },
    authorAssociation: "OWNER",
    labels: [{ name: "release-acceptance" }, { name: "release-approved" }],
    body: [
      "### Release tag",
      "",
      tag,
      "",
      "### Exact candidate commit SHA",
      "",
      tagSha,
      "",
      "### Acceptance evidence",
      "",
      "Reviewed source UI and isolated updater evidence in run 123.",
      "",
      ...checks.map((check) => `- [x] [${check}]`),
    ].join("\n"),
    ...overrides,
  };
}

test("closed owner acceptance for the exact tag and commit is publishable", () => {
  assert.equal(
    verifyReleaseApproval({ issue: approvalIssue(), repositoryOwner: "owner", tag, tagSha }),
    true,
  );
});

test("an unchecked human acceptance item blocks publication", () => {
  const issue = approvalIssue();
  issue.body = issue.body.replace("- [x] [UI_ACCEPTED]", "- [ ] [UI_ACCEPTED]");
  assert.throws(
    () => verifyReleaseApproval({ issue, repositoryOwner: "owner", tag, tagSha }),
    /UI_ACCEPTED/,
  );
});

test("acceptance evidence for a different commit cannot publish the tag", () => {
  const issue = approvalIssue();
  issue.body = issue.body.replace(tagSha, "b".repeat(40));
  assert.throws(
    () => verifyReleaseApproval({ issue, repositoryOwner: "owner", tag, tagSha }),
    /commit/i,
  );
});

test("an open acceptance issue cannot authorize publication", () => {
  assert.throws(
    () => verifyReleaseApproval({ issue: approvalIssue({ state: "OPEN" }), repositoryOwner: "owner", tag, tagSha }),
    /closed/i,
  );
});

test("an acceptance issue from someone other than the repository owner is rejected", () => {
  const issue = approvalIssue({ author: { login: "contributor" }, authorAssociation: "CONTRIBUTOR" });
  assert.throws(
    () => verifyReleaseApproval({ issue, repositoryOwner: "owner", tag, tagSha }),
    /owner/i,
  );
});

test("the owner must apply the explicit release-approved label", () => {
  const issue = approvalIssue({ labels: [{ name: "release-acceptance" }] });
  assert.throws(
    () => verifyReleaseApproval({ issue, repositoryOwner: "owner", tag, tagSha }),
    /release-approved/,
  );
});

test("acceptance for a different release tag is rejected", () => {
  const issue = approvalIssue();
  issue.body = issue.body.replace(tag, "v0.2.0");
  assert.throws(
    () => verifyReleaseApproval({ issue, repositoryOwner: "owner", tag, tagSha }),
    /tag/i,
  );
});

test("human acceptance must include concrete test evidence", () => {
  const issue = approvalIssue();
  issue.body = issue.body.replace("Reviewed source UI and isolated updater evidence in run 123.", "_No response_");
  assert.throws(
    () => verifyReleaseApproval({ issue, repositoryOwner: "owner", tag, tagSha }),
    /evidence/i,
  );
});

test("GitHub REST issue fields are accepted without weakening owner checks", () => {
  const issue = approvalIssue({
    author: undefined,
    authorAssociation: undefined,
    user: { login: "owner" },
    author_association: "OWNER",
  });
  assert.equal(verifyReleaseApproval({ issue, repositoryOwner: "owner", tag, tagSha }), true);
});
