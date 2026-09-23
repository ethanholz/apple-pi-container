import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
  configuredVolumeMount,
  dockerfileImageTag,
  isContainerSystemStoppedError,
  readConfig,
  selectVolumes,
} from "../index.ts";
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

function configWithVolumes(volumes: unknown) {
  const filePath = path.join(tmpdir(), `${randomUUID()}.json`);
  fs.writeFileSync(filePath, JSON.stringify({ volumes }));
  try {
    return readConfig(filePath);
  } finally {
    fs.unlinkSync(filePath);
  }
}

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
  test("rejects volume entries without a source", () => {
    assert.throws(
      () => configWithVolumes([{ target: "/workspace/data" }]),
      /volumes must contain a source/,
    );
  });
  test("rejects volume entries with a relative target", () => {
    assert.throws(
      () => configWithVolumes([{ source: "data", target: "workspace/data" }]),
      /volumes must contain a source/,
    );
  });
  test("rejects commas in volume sources and targets", () => {
    for (const volume of [
      { source: "data,other", target: "/workspace/data" },
      { source: "data", target: "/workspace/data,other" },
    ]) {
      assert.throws(
        () => configWithVolumes([volume]),
        /volumes must contain a source/,
      );
    }
  });
  test("rejects a non-boolean readonly setting", () => {
    assert.throws(
      () =>
        configWithVolumes([
          { source: "data", target: "/workspace/data", readonly: "true" },
        ]),
      /optional boolean readonly/,
    );
  });
});

describe("configuration precedence", () => {
  const global = configWithVolumes([{ source: "global", target: "/data" }]);

  test("inherits global volumes when project volumes are absent", () => {
    assert.deepEqual(selectVolumes(global, {}), global.volumes);
  });
  test("replaces global volumes when project volumes are present", () => {
    const project = configWithVolumes([
      { source: "project", target: "/workspace/data" },
    ]);
    assert.deepEqual(selectVolumes(global, project), project.volumes);
    assert.deepEqual(selectVolumes(global, configWithVolumes([])), []);
  });
});

test("Dockerfile image tags change with Dockerfile contents", () => {
  const dockerfile = path.join(tmpdir(), `${randomUUID()}.Dockerfile`);
  fs.writeFileSync(dockerfile, "FROM ubuntu:24.04\n");
  const first = dockerfileImageTag("/project", dockerfile);

  fs.writeFileSync(dockerfile, "FROM ubuntu:24.10\n");

  assert.notEqual(dockerfileImageTag("/project", dockerfile), first);
});

test("recognizes the stopped container system error", () => {
  assert.equal(
    isContainerSystemStoppedError(`Error: interrupted: "XPC connection error: Connection invalid"
Ensure container system service has been started with \`container system start\`.`),
    true,
  );
  assert.equal(isContainerSystemStoppedError("Error: image not found"), false);
});

describe("volume mount arguments", () => {
  test("serializes a writable named volume", () => {
    const volume = configWithVolumes([
      { source: "data", target: "/workspace/data" },
    ]).volumes?.[0];
    assert.ok(volume);
    assert.equal(
      configuredVolumeMount(volume),
      "type=volume,source=data,target=/workspace/data",
    );
  });
  test("serializes a read-only named volume", () => {
    const volume = configWithVolumes([
      { source: "data", target: "/workspace/data", readonly: true },
    ]).volumes?.[0];
    assert.ok(volume);
    assert.equal(
      configuredVolumeMount(volume),
      "type=volume,source=data,target=/workspace/data,readonly",
    );
  });
});
