export type AccountSummary = {
  id: string;
  email: string;
  membership: string | null;
  signupType: string | null;
  tags: string[];
  source: "cursor" | "cockpit-tools";
  isActive: boolean;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
};

export type QuotaSnapshot = {
  autoPercentUsed: number | null;
  apiPercentUsed: number | null;
  totalPercentUsed: number | null;
  billingCycleStart: string;
  billingCycleEnd: string;
  usagePercent: number | null;
  hasAvailableUsage: boolean | null;
  hasNonZeroIncludedLimit: boolean | null;
  grokPlanLabel: string | null;
  currentPeriodStart: string | null;
  nextResetTimestampUtc: string | null;
  sandAccessGranted: boolean | null;
  sandAccessState: string | null;
  sandBlockReason: string | null;
  isPaidTrialPlan: boolean | null;
  proAndSuperGrokPlansGrantAccess: boolean | null;
};
