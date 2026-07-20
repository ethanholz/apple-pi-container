import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { readConfig } from "../index.ts";

describe("configuration", () => {
  test("returns an empty configuration when the file does not exist", () => {
    const filePath = path.join(tmpdir(), `${randomUUID()}.json`);

    assert.deepEqual(readConfig(filePath), {});
  });
  test.todo("reads image, enabled, and named volume settings");
  test.todo("accepts writable and read-only named volumes");
  test.todo("rejects a volumes setting that is not an array");
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
