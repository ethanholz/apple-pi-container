# apple-pi-container

A simple tool for using an Apple [container](https://github.com/apple/container) to sandbox shell-based tool calls.
Based off the [example](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/gondolin) in Pi for using [gondolin](https://github.com/earendil-works/gondolin).

## Ethos
Configuration of `pi` should happen on the host system. File manipulation should happen in a container. It should be easy to use and fast.

## Installation
```sh
pi install gi:github.com/ethanholz/apple-pi-container@v0.1.1
```

## Usage
Container routing starts disabled. Use `/apple-container` to toggle between the
host and container, or `/apple-container on [image]|off|status` for an explicit
action. For example, `/apple-container on ubuntu:24.04` starts that image.
If you want to persist settings, see the [JSON Configuration](#JSON configuration) below.

When you start a container, your current directory will get mounted into the container.

### JSON configuration

Configuration is optional. Create either of these files:

- `~/.pi/agent/apple-container.json` for defaults shared by all projects
- `.pi/apple-container.json` for defaults belonging to the current project

```json
{
  "dockerfile": "../Dockerfile",
  "enabled": true,
  "volumes": [
    {
      "source": "my-project-pixi",
      "target": "/workspace/.pixi"
    }
  ]
}
```

| Setting | Type | Code default | Description |
|---------|------|--------------|-------------|
| `image` | string | `docker.io/library/ubuntu:24.04` | Image used when starting the container |
| `dockerfile` | string | none | Dockerfile path relative to the configuration file |
| `enabled` | boolean | `false` | Start container routing when the session launches |
| `volumes` | array | `[]` | Named volumes to mount in the container |

All settings are optional. For example, this keeps routing disabled while
changing the image used by the next `/apple-container on`:

```json
{
  "image": "ghcr.io/prefix-dev/pixi:latest"
}
```

Set either `image` or `dockerfile`, not both. Dockerfile paths are relative to
the JSON file containing the setting; builds use the project root as their
context and run when the container starts. An image passed to the slash command
or CLI flag skips the configured Dockerfile.

Project configuration overrides global configuration one setting at a time and
is only read for trusted projects. A project `volumes` array replaces the global
array rather than merging with it. Image precedence is:

1. Image passed to `/apple-container on <image>`
2. `--apple-container-image` CLI flag
3. Project `dockerfile` or `image` configuration
4. Global `dockerfile` or `image` configuration
5. Code default

Slash commands only change the current session; they never modify configuration
files. Invalid setting types are reported instead of silently ignored.

### Named volumes

Create named volumes with Apple Container, then list their source name and
absolute guest target in the JSON configuration:

```sh
container volume create my-project-pixi
```

```json
{
  "volumes": [
    {
      "source": "my-project-pixi",
      "target": "/workspace/.pixi"
    },
    {
      "source": "shared-data",
      "target": "/data",
      "readonly": true
    }
  ]
}
```

The extension only mounts configured volumes; it does not manage their lifecycle.

## TODOs
- [x] Add better toggle UX via Pi slash command
- [x] Make project configuration easier in `.pi` directory
- [x] Add support for Dockerfiles in configuration to build custom images for a project
- [ ] Support devcontainers
- [x] Make using project local dependency caching easier for Linux guest
