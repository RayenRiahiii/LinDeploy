import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./form.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUnderTest = { exports: {} };
new Function("exports", "module", "require", compiled)(moduleUnderTest.exports, moduleUnderTest, () => ({}));
const form = moduleUnderTest.exports;

function validValues() {
  return {
    ...form.defaultOpenShiftValues,
    provisioningHostId: 7,
    pullSecret: JSON.stringify({ auths: { "cloud.redhat.com": { auth: "hidden" } } }),
    sshPublicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest",
    installConfirmation: "ERASE /dev/vda",
  };
}

test("default values match the supported SNO baseline", () => {
  assert.equal(form.defaultOpenShiftValues.openshiftVersion, "4.20.3");
  assert.equal(form.defaultOpenShiftValues.vcpu, 8);
  assert.equal(form.defaultOpenShiftValues.memoryGib, 16);
  assert.equal(form.defaultOpenShiftValues.diskGib, 120);
  assert.equal(form.defaultOpenShiftValues.clusterNetworkCidr, "10.128.0.0/14");
});

test("required fields and invalid pull secrets are rejected", () => {
  const missing = form.validateOpenShiftForm({ ...validValues(), clusterName: "", pullSecret: "not-json" });
  assert.ok(missing.clusterName);
  assert.ok(missing.pullSecret);
});

test("overlapping networks are rejected", () => {
  const errors = form.validateOpenShiftForm({ ...validValues(), serviceNetworkCidr: "10.128.0.0/16" });
  assert.ok(errors.serviceNetworkCidr);
});

test("network and broadcast addresses cannot be assigned to the SNO host", () => {
  const networkAddress = form.validateOpenShiftForm({
    ...validValues(),
    machineNetworkCidr: "192.168.131.0/24",
    machineIp: "192.168.131.0",
    rendezvousIp: "192.168.131.0",
    gateway: "192.168.131.1",
  });
  assert.ok(networkAddress.machineIp);
  assert.ok(networkAddress.rendezvousIp);

  const broadcastAddress = form.validateOpenShiftForm({
    ...validValues(),
    machineNetworkCidr: "192.168.131.0/24",
    machineIp: "192.168.131.255",
    rendezvousIp: "192.168.131.255",
    gateway: "192.168.131.1",
  });
  assert.ok(broadcastAddress.machineIp);
  assert.ok(broadcastAddress.rendezvousIp);
});

test("disconnected mirror URL is conditional", () => {
  assert.equal(form.validateOpenShiftForm({ ...validValues(), disconnected: false, mirrorRegistry: "" }).mirrorRegistry, undefined);
  assert.ok(form.validateOpenShiftForm({ ...validValues(), disconnected: true, mirrorRegistry: "" }).mirrorRegistry);
});

test("secret redaction is recursive", () => {
  assert.deepEqual(form.redactSecrets({ token: "x", nested: { password: "y", safe: "z" } }), { token: "<redacted>", nested: { password: "<redacted>", safe: "z" } });
});

test("payload contains one host, explicit approval, and no entered secret material", () => {
  const payload = form.buildOpenShiftPayload(validValues(), 9, "bundle-reference");
  const serialized = JSON.stringify(payload);
  assert.deepEqual(payload.host_ids, [7]);
  assert.equal(payload.template_id, 9);
  assert.equal(payload.deployment_mode, "manual");
  assert.equal(payload.cluster_config.install_confirmation, "ERASE /dev/vda");
  assert.equal(payload.cluster_config.secret_reference, "bundle-reference");
  assert.equal(serialized.includes("cloud.redhat.com"), false);
  assert.equal(serialized.includes("AAAAC3"), false);
});

test("disk erasure requires an exact path-bound confirmation", () => {
  assert.ok(form.validateOpenShiftForm({ ...validValues(), installConfirmation: "ERASE /dev/sda" }).installConfirmation);
  assert.equal(form.validateOpenShiftForm(validValues()).installConfirmation, undefined);
});

test("launch remains disabled without an OpenShift template", () => {
  assert.equal(form.canLaunchOpenShift({}, true, false), false);
  assert.equal(form.canLaunchOpenShift({}, true, true), true);
});

test("Kubernetes and K3s route contracts remain registered", () => {
  const router = readFileSync(new URL("../../router/AppRouter.tsx", import.meta.url), "utf8");
  assert.match(router, /installers\/kubernetes/);
  assert.match(router, /installers\/k3s/);
});
