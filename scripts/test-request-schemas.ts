import assert from "node:assert/strict";
import { agentRequestSchema, applyRequestSchema } from "../lib/domain/request-schemas";

const base = {
  message: "What is on my calendar?",
  events: [],
  preferences: [],
  snapshotVersion: "snapshot-test",
};

assert.equal(agentRequestSchema.safeParse(base).success, true, "A valid empty calendar request should parse.");
assert.equal(agentRequestSchema.safeParse({ ...base, events: [{ id: "incomplete" }] }).success, false,
  "Events missing required nested fields must be rejected.");
assert.equal(agentRequestSchema.safeParse({ ...base, preferences: [{ id: "invalid", rule: { type: "BOGUS" } }] }).success, false,
  "Malformed preference rules must be rejected.");
assert.equal(agentRequestSchema.safeParse({ ...base, activeDraft: { commands: "not-an-array" } }).success, false,
  "Malformed nested drafts must be rejected.");
assert.equal(applyRequestSchema.safeParse({ events: [], preferences: [], snapshotVersion: "snapshot-test", draft: {} }).success, false,
  "An incomplete apply draft must be rejected.");

console.log("Request schema tests passed: valid agent request and invalid nested payloads.");
