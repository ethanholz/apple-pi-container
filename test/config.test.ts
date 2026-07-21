import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { readConfig } from "../index.ts";
import fs from "node:fs";

const baseExample = `
{
  "image": "ubuntu:24.04",
  "enabled": true,
  "volumes": [
    {
      "source": "my-project-pixi",
      "target": "/workspace/.pixi"
    }
  ]
}
`;

const volumeExample = `
{
  "image": "ubuntu:24.04",
  "enabled": true,
  "volumes": [
    {
      "source": "my-project-pixi",
      "target": "/workspace/.pixi",
      "readonly": true
    },
    {
      "source": "my-other-pixi",
      "target": "/workspace/other"
    }
  ]
}
`;

describe("configuration", () => {
  test("returns an empty configuration when the file does not exist", () => {
    const filePath = path.join(tmpdir(), `${randomUUID()}.json`);

    assert.deepEqual(readConfig(filePath), {});
  });
  test("reads image, enabled, and named volume settings", () => {
    const filePath = path.join(tmpdir(), `${randomUUID()}.json`);
    fs.writeFileSync(filePath, baseExample);

    assert.deepEqual(readConfig(filePath), {
      image: "ubuntu:24.04",
      enabled: true,
      volumes: [
        {
          source: "my-project-pixi",
          target: "/workspace/.pixi",
          readonly: false,
        },
      ],
    });
  });
  test("reads a config-relative Dockerfile", () => {
    const filePath = path.join(tmpdir(), `${randomUUID()}.json`);
    fs.writeFileSync(filePath, '{"dockerfile":"../Dockerfile"}');

    assert.equal(readConfig(filePath).dockerfile, "../Dockerfile");
  });
  test("rejects absolute Dockerfile paths", () => {
    const filePath = path.join(tmpdir(), `${randomUUID()}.json`);
    fs.writeFileSync(filePath, '{"dockerfile":"/tmp/Dockerfile"}');

    assert.throws(() => readConfig(filePath), /relative to the configuration/);
  });
  test("rejects configuring both an image and Dockerfile", () => {
    const filePath = path.join(tmpdir(), `${randomUUID()}.json`);
    fs.writeFileSync(
      filePath,
      '{"image":"ubuntu:24.04","dockerfile":"Dockerfile"}',
    );

    assert.throws(() => readConfig(filePath), /cannot both be set/);
  });
  test("accepts writable and read-only named volumes", () => {
    const filePath = path.join(tmpdir(), `${randomUUID()}.json`);
    fs.writeFileSync(filePath, volumeExample);

    const out = readConfig(filePath);
    const volumes = out.volumes;
    assert.notEqual(volumes, undefined);
    assert.deepEqual(volumes, [
      { source: "my-project-pixi", target: "/workspace/.pixi", readonly: true },
      { source: "my-other-pixi", target: "/workspace/other", readonly: false },
    ]);
  });
  test.todo("rejects volume entries without a source");
  test.todo("rejects volume entries with a relative target");
  test.todo("rejects commas in volume sources and targets");
  test.todo("rejects a non-boolean readonly setting");
});

describe("configuration precedence", () => {
  test.todo("inherits global volumes when project volumes are absent");
  test.todo("replaces global volumes when project volumes are present");
});

describe("volume mount arguments", () => {
  test.todo("serializes a writable named volume");
  test.todo("serializes a read-only named volume");
});
