import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("ops page keeps admin token in component state only", () => {
  const source = readSource("src/app/ops/page.tsx");

  assert.match(source, /const \[adminToken, setAdminToken\] = useState\(""\)/);
  assert.match(source, /type="password"/);
  assert.match(source, /autoComplete="off"/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(source, /replaceState|pushState|URLSearchParams/);
});

test("ops api sends admin token header and keeps scan non-cascading", () => {
  const source = readSource("src/lib/opsApi.ts");

  assert.match(source, /"x-admin-token": adminToken/);
  assert.match(source, /path: "\/api\/admin\/readiness"/);
  assert.match(source, /path: "\/api\/admin\/automation\/backlog"/);
  assert.match(source, /path: "\/api\/deposits\/scan"/);
  assert.match(source, /path: "\/api\/provider-jobs\/process"/);
  assert.match(source, /path: "\/api\/exchange\/payout-jobs\/process"/);
  assert.match(
    source,
    /path: "\/api\/deposits\/scan"[\s\S]*?body: JSON\.stringify\(\{\}\)/
  );
  assert.doesNotMatch(source, /processProviderJobs:\s*true/);
  assert.doesNotMatch(source, /processExchangePayouts:\s*true/);
});

test("ops page renders summarized action results without raw payload dumping", () => {
  const source = readSource("src/app/ops/page.tsx");

  assert.match(source, /ActionSummaryView/);
  assert.match(source, /FRONTEND_TEST_IDS\.opsActionResult/);
  assert.doesNotMatch(source, /JSON\.stringify\(summary/);
  assert.doesNotMatch(source, /JSON\.stringify\(actionSummary/);
  assert.doesNotMatch(source, /\.map\(\(item\)|\.map\(\(row\)|Object\.entries\(summary\)/);
});
